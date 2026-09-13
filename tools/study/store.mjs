/* Files for the measurement study.
 *
 * A study lives in one directory, which must be OUTSIDE this repository. Study data is personal data
 * about real people; stored inside an application repository it ends up in a commit, a deployed image
 * or a buyer package by accident, which is the same reason tools/nhanes/acquire.cjs refuses.
 *
 * The link key — code to name and contact — is a separate file, so a coordinator can hold it apart
 * from the measurements (protocol §6). Every write goes to a temporary file first and is renamed into
 * place, so an interrupted save leaves the previous version intact rather than half a file.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertStudyConfig, emptyState } from './study.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fail = (code, message) => { throw Object.assign(new Error(message), { name: 'StudyStoreError', code }); };

export const FILES = Object.freeze({
  config: 'study.json',
  participants: 'participants.json',
  linkKey: 'link-key.json',
  reference: 'reference.json',
  scans: 'scans.json',
  visits: 'visits.json',
  audit: 'audit.jsonl',
  lock: 'lock.json',
});

export function requireOutsideRepo(directory, repoRoot = REPO) {
  const resolved = path.resolve(directory);
  const relative = path.relative(path.resolve(repoRoot), resolved);
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
    fail('INSIDE_REPOSITORY', 'Study data must live outside the repository; it is personal data about real people. Refused: ' + resolved);
  }
  return resolved;
}

function writeAtomic(file, text) {
  const temporary = file + '.tmp-' + process.pid;
  fs.writeFileSync(temporary, text, 'utf8');
  fs.renameSync(temporary, file);
}
const writeJson = (file, value) => writeAtomic(file, JSON.stringify(value, null, 2) + '\n');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

export function initStudy(directory, config, { repoRoot = REPO } = {}) {
  const dir = requireOutsideRepo(directory, repoRoot);
  assertStudyConfig(config);
  if (fs.existsSync(path.join(dir, FILES.config))) fail('ALREADY_INITIALIZED', 'A study already exists in ' + dir + '. It is not overwritten.');
  fs.mkdirSync(dir, { recursive: true });
  saveStudy(dir, emptyState(config), { repoRoot });
  return dir;
}

export function loadStudy(directory, { repoRoot = REPO } = {}) {
  const dir = requireOutsideRepo(directory, repoRoot);
  if (!fs.existsSync(path.join(dir, FILES.config))) fail('NO_STUDY', 'No study found in ' + dir + '. Run init first.');
  const config = readJson(path.join(dir, FILES.config));
  assertStudyConfig(config);
  const auditFile = path.join(dir, FILES.audit);
  const audit = fs.existsSync(auditFile)
    ? fs.readFileSync(auditFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
    : [];
  const lockFile = path.join(dir, FILES.lock);
  return {
    config,
    participants: readJson(path.join(dir, FILES.participants)),
    linkKey: readJson(path.join(dir, FILES.linkKey)),
    reference: readJson(path.join(dir, FILES.reference)),
    scans: readJson(path.join(dir, FILES.scans)),
    visits: readJson(path.join(dir, FILES.visits)),
    audit,
    lockedAt: fs.existsSync(lockFile) ? readJson(lockFile).lockedAt : null,
  };
}

export function saveStudy(directory, state, { repoRoot = REPO } = {}) {
  const dir = requireOutsideRepo(directory, repoRoot);
  writeJson(path.join(dir, FILES.config), state.config);
  writeJson(path.join(dir, FILES.participants), state.participants);
  writeJson(path.join(dir, FILES.linkKey), state.linkKey);
  writeJson(path.join(dir, FILES.reference), state.reference);
  writeJson(path.join(dir, FILES.scans), state.scans);
  writeJson(path.join(dir, FILES.visits), state.visits);
  writeAtomic(path.join(dir, FILES.audit), state.audit.map(entry => JSON.stringify(entry)).join('\n') + (state.audit.length ? '\n' : ''));
  if (state.lockedAt) writeJson(path.join(dir, FILES.lock), { lockedAt: state.lockedAt });
  return dir;
}
