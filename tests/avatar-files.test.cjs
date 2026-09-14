// Avatar files (FM02): the lab's experimental silhouette surface written as USD text and as a USDZ package. These read
// the files back independently of the writer: the USD numbers against the mesh, and the package against the zip format
// and the USDZ rules (stored, unencrypted, the layer first, data on a 64-byte boundary). The surface is synthetic.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const Hull = require('../tools/reconstruction/visual-hull.js');
const Avatar = require('../tools/reconstruction/avatar-files.js');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
function mask(x0 = 25, x1 = 55) {
  const width = 80, height = 120, data = new Float32Array(width * height);
  for (let y = 10; y < 110; y++) for (let x = x0; x < x1; x++) data[y * width + x] = 1;
  return Hull.prepareMask({ width, height, data, centerX: 39.5 });
}
const surface = () => Hull.reconstruct(Object.fromEntries(Hull.VIEWS.map(v => [v, mask()])), { heightM: 1.8, resolution: 48 });
const array = (text, type, name) => {
  const m = text.match(new RegExp(`${type.replace(/[[\]]/g, '\\$&')} ${name} = \\[([^\\]]*)\\]`));
  assert.ok(m, name + ' is written');
  return m[1];
};
// CRC-32 computed here, not by the writer, unless this Node has zlib's own.
const crc = bytes => (typeof zlib.crc32 === 'function' ? zlib.crc32(bytes) : (() => {
  let c = ~0; for (const b of bytes) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1; } return (~c) >>> 0;
})());

test('the USD layer is Y up in metres, carries the warnings, and holds exactly the mesh', () => {
  const mesh = surface();
  const usda = Avatar.toUSDA(mesh);
  assert.match(usda, /^#usda 1\.0\n\(\n    defaultPrim = "Avatar"\n/);
  assert.match(usda, /\n    metersPerUnit = 1\n    upAxis = "Y"\n/);
  assert.match(usda, /doc = "EXPERIMENTAL silhouette intersection; clothed outer surface, not anatomical reconstruction\. Units: m; scale assumes silhouette height equals recorded stature; NOT independently calibrated\. Protocol: orthographic-four-silhouette-v1"/);
  assert.match(usda, /bool experimental = 1\n        string protocol = "orthographic-four-silhouette-v1"\n        string scaleStatus = "assumed-stature-not-validated"/);
  assert.match(usda, /def Xform "Avatar" \(\n    kind = "component"\n\)\n\{\n    def Mesh "Surface"/);

  const counts = array(usda, 'int[]', 'faceVertexCounts').split(', ');
  assert.equal(counts.length, mesh.faces.length);
  assert.ok(counts.every(n => n === '3'));
  assert.deepEqual(array(usda, 'int[]', 'faceVertexIndices').split(', ').map(Number), mesh.faces.flat());
  const points = [...array(usda, 'point3f[]', 'points').matchAll(/\(([^)]*)\)/g)].map(m => m[1].split(', ').map(Number));
  assert.equal(points.length, mesh.vertices.length);
  points.forEach((p, i) => p.forEach((n, k) => assert.ok(Math.abs(n - mesh.vertices[i][k]) <= 5e-8, `point ${i}`)));
  const extent = [...array(usda, 'float3[]', 'extent').matchAll(/\(([^)]*)\)/g)].map(m => m[1].split(', ').map(Number));
  const axis = k => mesh.vertices.map(v => v[k]);
  assert.deepEqual(extent, [[0, 1, 2].map(k => Math.min(...axis(k))), [0, 1, 2].map(k => Math.max(...axis(k)))].map(v => v.map(n => Number(n.toFixed(7)))));
  assert.ok(Math.abs(extent[1][1] - 1.8) < 1e-6, 'the height is the recorded stature');
  assert.doesNotMatch(usda, /-0\.0000000\b/);
});

test("orientation follows the triangles' winding, so the surface faces outward either way", () => {
  const mesh = surface();
  assert.ok(Avatar.signedVolume(mesh) > 0);
  assert.match(Avatar.toUSDA(mesh), /uniform token orientation = "rightHanded"/);
  const flipped = { ...mesh, faces: mesh.faces.map(([a, b, c]) => [a, c, b]) };
  assert.ok(Avatar.signedVolume(flipped) < 0);
  assert.match(Avatar.toUSDA(flipped), /uniform token orientation = "leftHanded"/);
});

test('the USDZ package is one stored, unencrypted layer, first, with its data on a 64-byte boundary', () => {
  const mesh = surface();
  const bytes = Avatar.toUSDZ(mesh);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();

  // Local file header.
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint16(6, true) & 0x0001, 0, 'not encrypted');
  assert.equal(view.getUint16(6, true) & 0x0008, 0, 'sizes in the header, no data descriptor');
  assert.equal(view.getUint16(8, true), 0, 'stored, not compressed');
  const size = view.getUint32(18, true), nameLength = view.getUint16(26, true), extraLength = view.getUint16(28, true);
  assert.equal(view.getUint32(22, true), size);
  assert.equal(decoder.decode(bytes.subarray(30, 30 + nameLength)), 'avatar.usda', 'the default layer is the first file');
  const dataOffset = 30 + nameLength + extraLength;
  assert.equal(dataOffset % 64, 0, 'file data starts on a 64-byte boundary');
  const data = bytes.subarray(dataOffset, dataOffset + size);
  assert.equal(decoder.decode(data), Avatar.toUSDA(mesh));
  assert.equal(view.getUint32(14, true), crc(data));

  // End of central directory, and the one central record it points at.
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.deepEqual([view.getUint16(end + 8, true), view.getUint16(end + 10, true)], [1, 1], 'exactly one file');
  const central = view.getUint32(end + 16, true);
  assert.equal(central, dataOffset + size);
  assert.equal(view.getUint32(central, true), 0x02014b50);
  assert.equal(view.getUint16(central + 10, true), 0);
  assert.equal(view.getUint32(central + 16, true), crc(data));
  assert.equal(view.getUint32(central + 42, true), 0, 'the central record points at offset 0');
  assert.equal(view.getUint32(end + 12, true), end - central);

  assert.deepEqual(Avatar.toUSDZ(mesh), bytes, 'the same surface gives the same bytes');
  assert.equal(Avatar.USDZ_MEDIA_TYPE, 'model/vnd.usdz+zip');
});

test('it writes only an experimental surface in metres, with sound vertices and faces', () => {
  const mesh = surface();
  assert.throws(() => Avatar.toUSDZ({ ...mesh, experimental: undefined }), /Only an experimental silhouette surface in metres/);
  assert.throws(() => Avatar.toUSDA({ ...mesh, units: 'cm' }), /Only an experimental silhouette surface in metres/);
  assert.throws(() => Avatar.toUSDA({ ...mesh, vertices: [[0, NaN, 0], ...mesh.vertices.slice(1)] }), /three finite numbers/);
  assert.throws(() => Avatar.toUSDA({ ...mesh, faces: [[0, 1, mesh.vertices.length], ...mesh.faces.slice(1)] }), /three distinct vertices/);
  assert.throws(() => Avatar.toUSDA({ ...mesh, faces: [[0, 0, 1], ...mesh.faces.slice(1)] }), /three distinct vertices/);
  assert.throws(() => Avatar.toUSDA({ ...mesh, faces: mesh.faces.slice(0, 3) }), /too few/);
  assert.match(Avatar.toUSDA({ ...mesh, protocol: 'a "quoted"\nprotocol' }), /string protocol = "a \\"quoted\\" protocol"/);
});

test('lab only: served by the loopback lab, offered beside the OBJ, and kept out of the SDK and buyer package', () => {
  assert.match(read('tools/reconstruction/silhouette-lab.cjs'), /'\/avatar-files\.js':\['avatar-files\.js','text\/javascript'\],/);
  const html = read('tools/reconstruction/silhouette-lab.html');
  assert.match(html, /<button id="obj">Download OBJ<\/button><button id="usdz">Download USDZ<\/button>/);
  assert.ok(html.indexOf('<script src="/visual-hull.js">') < html.indexOf('<script src="/avatar-files.js">')
    && html.indexOf('<script src="/avatar-files.js">') < html.indexOf('<script src="/silhouette-lab.js">'));
  const { BUNDLE_FILES } = require('../tools/sdk-files.cjs');
  assert.ok(!BUNDLE_FILES.some(f => /avatar-files/.test(f)), 'not in the buyer package until it is part of the SDK');
  assert.doesNotMatch(read('js/body-sdk.mjs'), /avatar-files|toUSDZ/);
});
