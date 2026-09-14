// Adult Training, milestone 2: a parent's own eating plan. These pin the pure logic and the promises it rests on:
//
//   it proportions a plate and never prescribes an amount or shows a nutrient value;
//   allergen tags and costs are only ever what the parent entered, and a tag the parent avoids is flagged;
//   it is the parent's alone, behind the same allowlist, exported and deleted with the account.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const base = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(base, file), 'utf8');
const flat = text => text.replace(/\r\n/g, '\n');
const MIGRATION = 'supabase/migrations/20260914130000_adult_nutrition.sql';

function context() {
  const ctx = vm.createContext({ console, Number, Math, String, Date, JSON, Set, Map, Array, Object });
  vm.runInContext(read('js/adult-nutrition.js'), ctx);
  return ctx;
}
const plain = value => JSON.parse(JSON.stringify(value));

test('preferences keep only known choices, and the habit aims are whole meals the parent picks', () => {
  const ctx = context();
  const v = input => plain(ctx.adultValidatePreferences(input));
  assert.deepEqual(v({ eating_pattern: 'vegetarian', avoid_allergens: ['sesame', 'peanuts', 'peanuts', 'gluten', 'constructor'],
    avoid_other: '  mushrooms ', weekly_budget: 'tight', cooking_minutes: '30', protein_meals_target: '2', plate_meals_target: '' }),
  { ok: true, value: { eating_pattern: 'vegetarian', avoid_allergens: ['peanuts', 'sesame'], avoid_other: 'mushrooms',
    weekly_budget: 'tight', cooking_minutes: 30, protein_meals_target: 2, plate_meals_target: null } });
  assert.deepEqual(v({}).value, { eating_pattern: null, avoid_allergens: [], avoid_other: null, weekly_budget: null,
    cooking_minutes: null, protein_meals_target: null, plate_meals_target: null }, 'nothing is filled in for them');
  for (const bad of [{ eating_pattern: 'keto' }, { eating_pattern: 'constructor' }, { weekly_budget: 'lavish' },
    { cooking_minutes: '20' }, { protein_meals_target: '7' }, { plate_meals_target: '1.5' }])
    assert.equal(v(bad).ok, false, JSON.stringify(bad));
});

test('a recipe has a name and 1 to 40 short ingredient lines; tags come from fixed lists; cost is optional', () => {
  const ctx = context();
  const v = input => plain(ctx.adultValidateRecipe(input));
  const ok = v({ title: ' Chili ', minutes: '45', servings: '4', ingredients: '1 can black beans\r\n\n  1 onion  \n', steps: ' Brown, simmer. ',
    allergens: ['soy', 'milk', 'nope'], plate_groups: ['protein', 'vegetables'], cost_estimate: '12.346' });
  assert.deepEqual(ok, { ok: true, value: { title: 'Chili', minutes: 45, servings: 4, ingredients: ['1 can black beans', '1 onion'],
    steps: 'Brown, simmer.', allergens: ['milk', 'soy'], plate_groups: ['vegetables', 'protein'], cost_estimate: 12.35 } });
  assert.equal(v({ title: 'Toast', ingredients: ['bread'] }).value.cost_estimate, null);
  for (const bad of [
    { title: '', ingredients: 'x' }, { title: 'x', ingredients: '' }, { title: 'x', ingredients: 'a\n'.repeat(41) },
    { title: 'x', ingredients: 'a'.repeat(121) }, { title: 'x', ingredients: 'a', minutes: '0' }, { title: 'x', ingredients: 'a', servings: '25' },
    { title: 'x', ingredients: 'a', cost_estimate: '-1' }, { title: 'x', ingredients: 'a', cost_estimate: '10000' },
  ]) assert.equal(v(bad).ok, false, JSON.stringify(bad).slice(0, 80));
});

test('a planned meal needs a day, a meal and a recipe or a typed title, up to 60 days ahead', () => {
  const ctx = context();
  const v = input => plain(ctx.adultValidatePlannedMeal(input, '2026-09-14'));
  assert.deepEqual(v({ planned_on: '2026-09-16', slot: 'dinner', recipe: { id: 'r1', title: 'Chili' }, title: 'ignored' }),
    { ok: true, value: { planned_on: '2026-09-16', slot: 'dinner', recipe_id: 'r1', title: 'Chili' } });
  assert.deepEqual(v({ planned_on: '2026-09-14', slot: 'lunch', title: ' Leftovers ' }).value, { planned_on: '2026-09-14', slot: 'lunch', recipe_id: null, title: 'Leftovers' });
  assert.equal(v({ planned_on: '2026-11-13', slot: 'dinner', title: 'x' }).ok, true);
  for (const bad of [{ planned_on: '2026-11-14', slot: 'dinner', title: 'x' }, { planned_on: '2026-09-14', slot: 'constructor', title: 'x' },
    { planned_on: '2026-09-14', slot: 'dinner', title: '' }, { planned_on: 'soon', slot: 'dinner', title: 'x' }])
    assert.equal(v(bad).ok, false, JSON.stringify(bad));
});

test('a habit day is today or earlier, with at least one count of 0 to 6 meals', () => {
  const ctx = context();
  const v = input => plain(ctx.adultValidateNutritionDay(input, '2026-09-14'));
  assert.deepEqual(v({ logged_on: '2026-09-14', protein_meals: '0', plate_meals: '' }).value, { logged_on: '2026-09-14', protein_meals: 0, plate_meals: null });
  for (const bad of [{ logged_on: '2026-09-15', protein_meals: '1' }, { logged_on: '2026-09-14' }, { logged_on: '2026-09-14', plate_meals: '7' }])
    assert.equal(v(bad).ok, false, JSON.stringify(bad));
});

test('the week plans meals in order, flags tags the parent avoids, and adds up a grocery list and their own costs', () => {
  const ctx = context();
  const dateFor = i => '2026-09-' + String(14 + i).padStart(2, '0');
  const recipes = [
    { id: 'chili', title: 'Chili', ingredients: ['1 can black beans', '1 Onion', '1  onion'], allergens: [], cost_estimate: 9.5 },
    { id: 'satay', title: 'Satay', ingredients: ['1 onion', 'Peanut butter'], allergens: ['peanuts', 'soy'], cost_estimate: null },
  ];
  const items = [
    { id: 'm3', planned_on: '2026-09-14', slot: 'dinner', recipe_id: 'chili', title: 'Chili' },
    { id: 'm1', planned_on: '2026-09-14', slot: 'breakfast', recipe_id: null, title: 'Oats' },
    { id: 'm2', planned_on: '2026-09-16', slot: 'lunch', recipe_id: 'satay', title: 'Satay' },
    { id: 'm4', planned_on: '2026-09-18', slot: 'dinner', recipe_id: 'chili', title: 'Chili' },
    { id: 'gone', planned_on: '2026-09-18', slot: 'lunch', recipe_id: null, title: 'A recipe since deleted' },
  ];
  const week = plain(ctx.adultMealPlanWeek(items, recipes, dateFor, { avoid_allergens: ['peanuts'] }));
  assert.equal(week.length, 7);
  assert.deepEqual(week[0].meals.map(m => m.id), ['m1', 'm3'], 'breakfast before dinner');
  assert.deepEqual(week[2].meals[0].conflicts, ['peanuts'], 'soy is tagged but not avoided');
  assert.deepEqual(week[0].meals[1].conflicts, []);
  assert.deepEqual(plain(ctx.adultGroceryList(week)), [
    { name: '1 can black beans', meals: 2 }, { name: '1 Onion', meals: 3 }, { name: 'Peanut butter', meals: 1 },
  ], 'a line repeated inside one recipe counts once for that meal');
  assert.deepEqual(plain(ctx.adultPlannedCost(week)), { total: 19, priced: 2, unpriced: 1 });
});

test('a habit with no aim has nothing to meet; with one, it counts the days that met it', () => {
  const ctx = context();
  const days = [{ protein_meals: 2, plate_meals: 0 }, { protein_meals: 1, plate_meals: null }, { protein_meals: null, plate_meals: 1 }];
  assert.deepEqual(plain(ctx.adultHabitSummary(days, null)), { daysLogged: 3, proteinDaysMet: null, plateDaysMet: null });
  assert.deepEqual(plain(ctx.adultHabitSummary(days, { protein_meals_target: 2, plate_meals_target: 1 })), { daysLogged: 3, proteinDaysMet: 1, plateDaysMet: 1 });
  assert.deepEqual(plain(ctx.adultHabitSummary(days, { protein_meals_target: 0 })).proteinDaysMet, 2, 'an unlogged count does not meet even a zero aim');
});

test('the plate guide proportions a plate after USDA MyPlate and never prescribes an amount', () => {
  const ctx = context();
  const guide = plain(vm.runInContext('ADULT_PLATE_GUIDE', ctx));
  assert.deepEqual(guide.parts.map(p => p.group), ['vegetables', 'grains', 'protein', 'dairy']);
  assert.match(guide.url, /^https:\/\/www\.myplate\.gov\//);
  assert.deepEqual(Object.keys(plain(vm.runInContext('ADULT_ALLERGENS', ctx))),
    ['milk', 'eggs', 'fish', 'shellfish', 'tree_nuts', 'peanuts', 'wheat', 'soy', 'sesame']);
  const text = [...guide.parts.map(p => p.text), guide.protein].join(' ');
  assert.doesNotMatch(text, /\d|grams?\b|ounces?\b|\bcups?\b|servings?\b/i, 'proportions only, no amounts');
  assert.match(guide.protein, /depends on your body and how active you are/);
});

test('the eating plan never claims what it cannot measure', () => {
  const claims = /weight[- ]loss|lose weight|calorie|kcal|\bbmi\b|body[- ]fat|lean mass|muscle gain|pounds lost|\bdetox|\bcleanse|fat[- ]burn|allergen[- ]free|safe for (?:your )?allerg/i;
  for (const file of ['js/adult-nutrition.js', 'js/screen-adult-eating.js', MIGRATION]) assert.doesNotMatch(read(file), claims, file);
  const screen = read('js/screen-adult-eating.js');
  assert.match(screen, /No nutrient values are shown, because nothing here measures them\./);
  assert.match(screen, /Allergen tags are the ones you put on each recipe, so check the label on anything you buy\./);
});

test('every table is the guardian\'s own, and writing needs the allowlist', () => {
  const migration = flat(read(MIGRATION));
  const tables = [...migration.matchAll(/create table if not exists public\.(adult_[a-z_]+) \(/g)].map(m => m[1]);
  assert.deepEqual(tables, ['adult_nutrition_preferences', 'adult_recipes', 'adult_meal_plan_items', 'adult_nutrition_days']);
  for (const t of tables) {
    assert.match(migration, new RegExp(`create policy ${t}_select on public\\.${t} for select to authenticated using \\(guardian_id = \\(select auth\\.uid\\(\\)\\)\\);`), t + ' select');
    assert.match(migration, new RegExp(`create policy ${t}_insert on public\\.${t} for insert to authenticated\\n  with check \\(guardian_id = \\(select auth\\.uid\\(\\)\\) and private\\.adult_training_allowed\\(\\)`), t + ' insert');
    assert.match(migration, new RegExp(`create policy ${t}_update on public\\.${t} for update to authenticated\\n  using \\(guardian_id = \\(select auth\\.uid\\(\\)\\)\\)(?:\\n  | )with check \\(guardian_id = \\(select auth\\.uid\\(\\)\\) and private\\.adult_training_allowed\\(\\)`), t + ' update');
    assert.match(migration, new RegExp(`alter table public\\.${t} enable row level security;`), t + ' rls');
  }
  assert.doesNotMatch(migration, /can_view_athlete|can_edit_athlete|can_coach_view_athlete|can_org_view_athlete|is_admin_of_team|athlete_id/);
  // The database's lists match the app's.
  const ctx = context();
  const list = name => plain(vm.runInContext(name, ctx));
  assert.match(migration, new RegExp(`array\\[${Object.keys(list('ADULT_ALLERGENS')).map(k => `'${k}'`).join(', ')}\\]`));
  assert.match(migration, new RegExp(`array\\[${Object.keys(list('ADULT_PLATE_GROUPS')).map(k => `'${k}'`).join(', ')}\\]`));
  assert.match(migration, new RegExp(`slot in \\(${Object.keys(list('ADULT_MEAL_SLOTS')).map(k => `'${k}'`).join(', ')}\\)`));
  assert.match(migration, new RegExp(`cooking_minutes in \\(${list('ADULT_COOK_TIMES').join(', ')}\\)`));
});

test('it lives inside Your training, never reads a child, and goes with the account', async () => {
  const eating = flat(read('js/screen-adult-eating.js'));
  assert.doesNotMatch(eating, /state\.active|athlete/i);
  assert.match(eating, /async function screenAdultEating\(\)\{\n  if \(adultTrainingOff\(\)\) return;/);
  const adult = read('js/screen-adult.js');
  assert.match(adult, /if \(state\.adultSection === 'eating' && typeof screenAdultEating === 'function'\) return screenAdultEating\(\);/);
  for (const t of ['adult_nutrition_preferences', 'adult_recipes', 'adult_meal_plan_items', 'adult_nutrition_days'])
    assert.match(adult, new RegExp(`'${t}'`), t + ' is exported');

  // No child-facing file reads the eating plan.
  const jsDir = path.join(base, 'js');
  for (const file of fs.readdirSync(jsDir).filter(f => /\.(m?js)$/.test(f) && !/^(screen-adult|screen-adult-eating|adult-nutrition|adult-progress)\.js$/.test(f)))
    assert.doesNotMatch(fs.readFileSync(path.join(jsDir, file), 'utf8'), /adult_(nutrition|recipes|meal_plan)|ADULT_PLATE_GUIDE/, file);

  const index = read('index.html');
  const at = name => index.indexOf('<script src="/js/' + name + '"></script>');
  assert.ok(at('screen-adult.js') < at('adult-nutrition.js') && at('adult-nutrition.js') < at('screen-adult-eating.js') && at('screen-adult-eating.js') < at('init.js'));
  assert.match(read('sw.js'), /'\/js\/screen-adult\.js','\/js\/adult-nutrition\.js','\/js\/screen-adult-eating\.js'/);

  const { ADULT_TABLES } = await import(pathToFileURL(path.join(base, 'supabase/functions/delete-account/handler.mjs')).href);
  assert.ok(ADULT_TABLES.indexOf('adult_meal_plan_items') < ADULT_TABLES.indexOf('adult_recipes'), 'planned meals before the recipes they use');
  assert.equal(ADULT_TABLES.at(-1), 'adult_training_access');
  assert.match(read('privacy.html'), /your food preferences and any allergens you choose to avoid, recipes you add, meals you plan and the eating habits you log\./);
});
