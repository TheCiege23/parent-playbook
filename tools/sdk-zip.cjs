#!/usr/bin/env node
'use strict';

/**
 * Write the buyer archive, with entry names an extractor outside Windows understands.
 *
 *   node tools/sdk-zip.cjs <bundle directory> <archive.zip>
 *
 * WHY THIS EXISTS. Every archive up to and including v44 was zipped by hand with PowerShell's
 * Compress-Archive. Windows PowerShell 5.1 runs on .NET Framework, whose ZipFile writes entry names
 * with BACKSLASH separators: `js\body-sdk.mjs`. The ZIP specification (APPNOTE 4.4.17) says the
 * separator is a forward slash and that backslashes must not be used. Windows extracts either form,
 * so `Expand-Archive` round-tripped, `node tools/acceptance.cjs` passed here, and the defect was
 * invisible from this machine. Elsewhere it depends on the tool: Info-ZIP `unzip` notices and
 * converts the separators with a warning, but Python's zipfile on macOS or Linux keeps the backslash
 * as part of the file name, so the package extracts as a flat pile of files named `js\body-sdk.mjs`
 * instead of a tree, and the first command HANDOVER.md tells a buyer to run fails. The claim this
 * package exists to support is that an acquirer can stand it up alone, on whatever they unpack it
 * with, and an archive they cannot open is the one defect that claim cannot survive.
 *
 * It writes file entries only. Directories are implied by the paths in the names, which is what every
 * extractor expects; the lone `supabase\functions\` entry in earlier archives was Compress-Archive's
 * own addition and carried nothing — the package has no empty directory to preserve.
 *
 * Entries are written in byte order of their names, so the same payload lays out the same way twice.
 * The archive is still not byte-reproducible, because each entry carries its file's modification
 * time, which is why the payload digest in tools/sdk-bundle.cjs remains the thing that says whether
 * the CONTENT moved. Nothing here reads or writes anything outside the two paths it is given.
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

// zlib.crc32 arrived in Node 22.2. The table is the fallback, so this builds on an older runtime
// rather than writing an archive with a wrong checksum in it.
let CRC_TABLE = null;
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// MS-DOS date and time, which is what a ZIP entry carries: local time, two-second resolution,
// nothing before 1980.
function dosStamp(mtimeMs) {
  const d = new Date(mtimeMs);
  const year = d.getFullYear() < 1980 ? 1980 : d.getFullYear();
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() >> 1) & 0x1f);
  const date = (((year - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

// Every file under `dir`, named relative to it with forward slashes, in byte order. A symlink or a
// special file is refused rather than followed: the manifest verifier rejects both, so one reaching
// an archive would mean the archive and the manifest disagree.
function collect(dir) {
  const out = [];
  (function walk(current, prefix) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const name = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.isSymbolicLink()) throw new Error('refusing to archive a symlink: ' + name);
      else if (entry.isDirectory()) walk(full, name);
      else if (entry.isFile()) out.push({ name, full });
      else throw new Error('refusing to archive a special file: ' + name);
    }
  })(dir, '');
  return out.sort((a, b) => Buffer.compare(Buffer.from(a.name, 'utf8'), Buffer.from(b.name, 'utf8')));
}

function build(directory, archivePath) {
  const dir = path.resolve(directory);
  const out = path.resolve(archivePath);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error('Not a directory: ' + dir);
  if (fs.existsSync(out)) throw new Error('Destination already exists; choose a new path. Nothing was overwritten.');

  const files = collect(dir);
  if (files.length === 0) throw new Error('Refusing to write an empty archive from ' + dir);
  if (files.length > 0xffff) throw new Error('More than 65535 entries needs ZIP64, which this writer does not emit');

  const parts = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const data = fs.readFileSync(file.full);
    const stat = fs.statSync(file.full);
    if (data.length >= 0xffffffff) throw new Error('An entry of 4GB or more needs ZIP64: ' + file.name);
    const nameBytes = Buffer.from(file.name, 'utf8');
    if (nameBytes.includes(0x5c)) throw new Error('A backslash in an entry name is exactly the defect this file exists to prevent: ' + file.name);
    // Bit 11 says the name is UTF-8. Set it only when the name needs it, so an ASCII-named archive
    // reads identically to every other tool's output.
    const flags = /^[\x20-\x7e]*$/.test(file.name) ? 0 : 0x0800;
    const crc = crc32(data);
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const method = stored ? 0 : 8;
    const { time, date } = dosStamp(stat.mtimeMs);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);

    central.push({ nameBytes, flags, method, time, date, crc, compressed: body.length, size: data.length, offset });
    parts.push(local, nameBytes, body);
    offset += local.length + nameBytes.length + body.length;
  }

  const centralOffset = offset;
  for (const e of central) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);   // version made by: 2.0, MS-DOS, so no unix mode is implied
    header.writeUInt16LE(20, 6);   // version needed
    header.writeUInt16LE(e.flags, 8);
    header.writeUInt16LE(e.method, 10);
    header.writeUInt16LE(e.time, 12);
    header.writeUInt16LE(e.date, 14);
    header.writeUInt32LE(e.crc, 16);
    header.writeUInt32LE(e.compressed, 20);
    header.writeUInt32LE(e.size, 24);
    header.writeUInt16LE(e.nameBytes.length, 28);
    header.writeUInt16LE(0, 30);   // extra
    header.writeUInt16LE(0, 32);   // comment
    header.writeUInt16LE(0, 34);   // disk
    header.writeUInt16LE(0, 36);   // internal attributes
    header.writeUInt32LE(0, 38);   // external attributes
    header.writeUInt32LE(e.offset, 42);
    parts.push(header, e.nameBytes);
    offset += header.length + e.nameBytes.length;
  }
  const centralSize = offset - centralOffset;
  if (offset >= 0xffffffff) throw new Error('An archive of 4GB or more needs ZIP64, which this writer does not emit');

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);
  parts.push(end);

  const bytes = Buffer.concat(parts);
  fs.writeFileSync(out, bytes, { flag: 'wx' });
  return {
    archive: out,
    entries: central.length,
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase(),
  };
}

// ---------------------------------------------------------------------------------------- reading
// Enough of a reader to check what was written, used by tests/sdk-archive.test.cjs. It reads the
// central directory, which is the index an extractor uses, rather than the local headers.
function readEntries(archivePath) {
  const buf = fs.readFileSync(archivePath);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 0xffff; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('No end-of-central-directory record in ' + archivePath);
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error('Central directory entry ' + i + ' is malformed');
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLength = buf.readUInt16LE(at + 32);
    entries.push({
      name: buf.slice(at + 46, at + 46 + nameLength).toString('utf8'),
      method: buf.readUInt16LE(at + 10),
      crc: buf.readUInt32LE(at + 16) >>> 0,
      compressed: buf.readUInt32LE(at + 20),
      size: buf.readUInt32LE(at + 24),
      offset: buf.readUInt32LE(at + 42),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

// The bytes of one entry, inflated and checked against the CRC the archive recorded.
function readFile(archivePath, name) {
  const buf = fs.readFileSync(archivePath);
  const entry = readEntries(archivePath).find(e => e.name === name);
  if (!entry) throw new Error('No such entry: ' + name);
  const nameLength = buf.readUInt16LE(entry.offset + 26);
  const extraLength = buf.readUInt16LE(entry.offset + 28);
  const start = entry.offset + 30 + nameLength + extraLength;
  const body = buf.slice(start, start + entry.compressed);
  const data = entry.method === 0 ? body : zlib.inflateRawSync(body);
  if (crc32(data) !== entry.crc) throw new Error('Checksum mismatch reading ' + name);
  return data;
}

module.exports = { build, readEntries, readFile };

if (require.main === module) {
  const [directory, archive] = process.argv.slice(2);
  if (!directory || !archive) {
    console.error('Usage: node tools/sdk-zip.cjs <bundle directory> <archive.zip>');
    process.exitCode = 2;
  } else {
    try {
      console.log(JSON.stringify(build(directory, archive), null, 2));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
