const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('parent invites are household-wide while coach invites remain athlete-scoped', () => {
  const ui = read('js/sheets.js');
  assert.match(ui, /filter\(a=>a\.family_id===state\.active\.family_id\)/,
    'shared athletes from another household must not enter this family invite');
  assert.match(ui, /const familyWide=role!==['"]coach['"]/);
  assert.match(ui, /scope:familyWide\?['"]family['"]:['"]athlete['"]/);
  assert.match(ui, /const kidIds = !familyWide&&multi/,
    'only coach access should create one invitation per selected child');
});

test('accepting a family invite grants every current sibling and repairs old accepted invites', () => {
  const sql = read('supabase/migrations/20260912123000_family_wide_parent_invites.sql');
  assert.match(sql, /join public\.athletes sibling on sibling\.family_id = anchor\.family_id/,
    'the migration must repair sibling access for an invitation accepted before this release');
  assert.match(sql, /if i\.scope = 'family' and i\.role in \('co_parent', 'family_view'\)/);
  assert.match(sql, /from public\.athletes a\s+where a\.family_id = v_family_id/,
    'one accepted household invitation must create access for every current child');
  assert.match(sql, /else\s+insert into public\.athlete_access/,
    'athlete-scoped coach invitations must keep the narrow grant path');
});

test('the Week screen exposes schedule changes and a tick cannot bubble into activity details', () => {
  const week = read('js/screen-week.js');
  assert.match(week, /id=['"]editWeekSchedule['"][^>]*>Change schedule</);
  assert.match(week, /editWeekSchedule[\s\S]*openPracticeSchedule/);
  assert.match(week, /btn\.onclick=e=>\{ e\.preventDefault\(\); e\.stopPropagation\(\);/,
    'the checkbox action must end the click before the row or title can open details');
});
