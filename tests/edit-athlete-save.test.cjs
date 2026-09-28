const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/screen-edit.js'), 'utf8');

test('editing growth and league inputs saves them, including clearing optional values', async () => {
  const updates = [];
  const error = { textContent: '' };
  const button = { textContent: 'Save changes', disabled: false, innerHTML: '' };
  const active = { id: 'athlete-1', first_name: 'Sam' };
  const context = vm.createContext({
    state: { active, athletes: [active] },
    $: selector => selector === '#edErr' ? error : button,
    ageFrom: () => 11,
    sb: { from: table => ({ update: values => ({ eq: async () => {
      updates.push({ table, values });
      return { error: null };
    } }) }) },
    loadAthletes: async () => {},
    toast: () => {},
    renderApp: () => {},
    console,
  });
  vm.runInContext(source, context, { filename: 'screen-edit.js' });
  vm.runInContext("Object.assign(ed,{first:'Sam',nick:'',bd:'2015-05-12',hand:'left',sex:'female',sport:'football',positions:['RB'],level:'rec',cutoff:'08-01',sportRowId:'sport-1'})", context);
  await vm.runInContext('edSave()', context);
  assert.equal(updates.find(row => row.table === 'athletes').values.sex_at_birth, 'female');
  assert.equal(updates.find(row => row.table === 'athlete_sports').values.age_cutoff_md, '08-01');

  updates.length = 0;
  vm.runInContext("ed.sex=''; ed.cutoff=''", context);
  await vm.runInContext('edSave()', context);
  assert.equal(updates.find(row => row.table === 'athletes').values.sex_at_birth, null);
  assert.equal(updates.find(row => row.table === 'athlete_sports').values.age_cutoff_md, null);
});
