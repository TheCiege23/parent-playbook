#!/usr/bin/env node
'use strict';

/**
 * Measurement study operations from the command line.
 *
 *   node tools/study/study.cjs init      --dir <study dir> --config <config.json>
 *   node tools/study/study.cjs enroll    --dir <dir> --role coordinator --file <enrollment.json>
 *   node tools/study/study.cjs reading   --dir <dir> --role measurer --code <code> --visit 1 --measure <key> --measurer A --value 181.2 --verify 181.2
 *   node tools/study/study.cjs scan      --dir <dir> --role scan_operator --code <code> --visit 1 --device <id> --capture 1 --file <company.json>
 *   node tools/study/study.cjs visit     --dir <dir> --role coordinator --code <code> --visit 1 --complete YYYY-MM-DD
 *   node tools/study/study.cjs visit     --dir <dir> --role coordinator --code <code> --visit 2 --missed
 *   node tools/study/study.cjs withdraw  --dir <dir> --role coordinator --code <code> --on YYYY-MM-DD
 *   node tools/study/study.cjs lock      --dir <dir> --role coordinator
 *   node tools/study/study.cjs view      --dir <dir> --role <role> [--measurer A]
 *   node tools/study/study.cjs export    --dir <dir> --role analyst --key-file <file> --out <file> [--include-race-ethnicity] [--interim]
 *   node tools/study/study.cjs analyze   --export <file> --out <file>
 *
 * THE ROLE FLAG IS NOT AUTHENTICATION. Anyone at this keyboard can type any role. The flag makes
 * each person's permitted actions explicit and stops honest mistakes; it does not stop a person who
 * decides to look. Running the study with real blinding needs separate accounts or separate copies
 * of the files per role, as research/STUDY-OPERATIONS.md explains.
 */

const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const command = args[0];
const valueFor = name => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
const flag = name => args.includes(name);
const need = name => {
  const value = valueFor(name);
  if (value == null || value.startsWith('--')) { console.error('Missing ' + name); process.exit(2); }
  return value;
};
const today = () => new Date().toISOString().slice(0, 10);
const REPO = path.resolve(__dirname, '..', '..');

function outsideRepo(file) {
  const relative = path.relative(REPO, path.resolve(file));
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
    console.error('Refused: ' + path.resolve(file) + ' is inside the repository. Study files hold personal data and stay outside it.');
    process.exit(2);
  }
  return path.resolve(file);
}

(async () => {
  const store = await import('./store.mjs');
  const study = await import('./study.mjs');
  const { viewFor } = await import('./blinding.mjs');
  const { scanFromCompanyRecord } = await import('./scan-import.mjs');
  const { deidentifiedExport, analyzeExport } = await import('./export.mjs');
  const print = value => console.log(JSON.stringify(value, null, 2));

  try {
    switch (command) {
      case 'init': {
        const config = JSON.parse(fs.readFileSync(need('--config'), 'utf8'));
        const dir = store.initStudy(need('--dir'), config);
        console.log('Study initialized in ' + dir);
        break;
      }
      case 'enroll': {
        const dir = need('--dir');
        const details = JSON.parse(fs.readFileSync(outsideRepo(need('--file')), 'utf8'));
        const result = study.enroll(store.loadStudy(dir), need('--role'), details);
        store.saveStudy(dir, result.state);
        print({ code: result.code, deviceOrder: result.deviceOrder });
        break;
      }
      case 'reading': {
        const dir = need('--dir');
        const result = study.recordReading(store.loadStudy(dir), need('--role'), {
          code: need('--code'), visit: Number(need('--visit')), measure: need('--measure'), measurer: need('--measurer'),
          value: Number(need('--value')), verifyValue: Number(need('--verify')),
        });
        store.saveStudy(dir, result.state);
        print(result.evaluation);
        break;
      }
      case 'scan': {
        const dir = need('--dir');
        const state = store.loadStudy(dir);
        const record = JSON.parse(fs.readFileSync(need('--file'), 'utf8'));
        const scan = scanFromCompanyRecord(record, {
          code: need('--code'), device: need('--device'), visit: Number(need('--visit')), captureIndex: Number(need('--capture')),
          devices: state.config.devices.map(d => d.id),
        });
        const result = study.recordScan(state, need('--role'), scan);
        store.saveStudy(dir, result.state);
        print({ recorded: true, outputs: Object.keys(scan.outputs).length, missing: scan.missingOutputs.length });
        break;
      }
      case 'visit': {
        const dir = need('--dir');
        const state = store.loadStudy(dir);
        const target = { code: need('--code'), visit: Number(need('--visit')) };
        const result = flag('--missed')
          ? study.markVisitMissed(state, need('--role'), target)
          : study.completeVisit(state, need('--role'), { ...target, on: valueFor('--complete') || today() });
        store.saveStudy(dir, result.state);
        print(viewFor(result.state, 'coordinator').visits.filter(v => v.code === target.code));
        break;
      }
      case 'withdraw': {
        const dir = need('--dir');
        const result = study.withdraw(store.loadStudy(dir), need('--role'), { code: need('--code'), on: valueFor('--on') || today() });
        store.saveStudy(dir, result.state);
        print({ withdrawn: true, deleted: result.removed });
        break;
      }
      case 'lock': {
        const dir = need('--dir');
        const result = study.lockData(store.loadStudy(dir), need('--role'));
        store.saveStudy(dir, result.state);
        console.log('Data locked at ' + result.state.lockedAt + '. No new readings or scans can be recorded; withdrawals are still honoured.');
        break;
      }
      case 'view': {
        print(viewFor(store.loadStudy(need('--dir')), need('--role'), { measurer: valueFor('--measurer') }));
        break;
      }
      case 'export': {
        const exportKey = fs.readFileSync(need('--key-file'), 'utf8').trim();
        const exported = deidentifiedExport(store.loadStudy(need('--dir')), need('--role'), {
          exportKey, includeRaceEthnicity: flag('--include-race-ethnicity'), interim: flag('--interim'),
        });
        fs.writeFileSync(outsideRepo(need('--out')), JSON.stringify(exported, null, 2) + '\n', 'utf8');
        console.log('Wrote ' + (exported.interim ? 'INTERIM ' : '') + 'de-identified export: ' + exported.counts.participants + ' participants.');
        break;
      }
      case 'analyze': {
        const exported = JSON.parse(fs.readFileSync(need('--export'), 'utf8'));
        const analysis = analyzeExport(exported);
        fs.writeFileSync(outsideRepo(need('--out')), JSON.stringify(analysis, null, 2) + '\n', 'utf8');
        console.log('Wrote ' + (analysis.interim ? 'INTERIM ' : '') + 'analysis. No pass/fail thresholds are applied.');
        break;
      }
      default:
        console.error('Usage: node tools/study/study.cjs <init|enroll|reading|scan|visit|withdraw|lock|view|export|analyze> ...  (see the header of this file)');
        process.exit(2);
    }
  } catch (error) {
    console.error((error.code ? error.code + ': ' : '') + error.message);
    process.exit(1);
  }
})();
