// ===================================================================
//  ADULT NUTRITION — the pure parts of a parent's own eating plan
// ===================================================================
// Validation, the week's meal plan, the grocery list and the habit summary behind js/screen-adult-eating.js, kept free
// of the DOM and the database so tests can run them directly. Nothing here prescribes an amount of food or computes
// a nutrient: a recipe's allergen tags and cost are what the parent entered, and a habit target is a number of meals
// the parent chose.

// The nine major food allergens named in U.S. food labeling law.
const ADULT_ALLERGENS = Object.freeze({
  milk:'Milk', eggs:'Eggs', fish:'Fish', shellfish:'Shellfish', tree_nuts:'Tree nuts',
  peanuts:'Peanuts', wheat:'Wheat', soy:'Soy', sesame:'Sesame',
});
// The food groups of the USDA MyPlate guide.
const ADULT_PLATE_GROUPS = Object.freeze({
  vegetables:'Vegetables', fruits:'Fruits', grains:'Grains', protein:'Protein foods', dairy:'Dairy or fortified soy',
});
const ADULT_EATING_PATTERNS = Object.freeze({
  no_preference:'No preference', vegetarian:'Vegetarian', vegan:'Vegan', pescatarian:'Pescatarian', other:'Something else',
});
const ADULT_MEAL_SLOTS = Object.freeze({ breakfast:'Breakfast', lunch:'Lunch', dinner:'Dinner', snack:'Snack' });
const ADULT_BUDGETS = Object.freeze({ tight:'Tight', moderate:'Moderate', flexible:'Flexible' });
const ADULT_COOK_TIMES = Object.freeze([15, 30, 45, 60, 90]);
const ADULT_INGREDIENT_MAX = 40;

// A plate guide rather than a food pyramid, in our own words, after USDA MyPlate. Proportions of a plate, never
// amounts of food.
const ADULT_PLATE_GUIDE = Object.freeze({
  source:'USDA MyPlate',
  url:'https://www.myplate.gov/eat-healthy/what-is-myplate',
  parts:Object.freeze([
    Object.freeze({ group:'vegetables', text:'Vegetables and fruits fill about half the plate, with a little more vegetables than fruit.' }),
    Object.freeze({ group:'grains', text:'Grains take about a quarter. Make at least half of your grains whole grains.' }),
    Object.freeze({ group:'protein', text:'Protein foods take the last quarter. Vary them from meal to meal.' }),
    Object.freeze({ group:'dairy', text:'Dairy, or a fortified soy alternative, goes on the side.' }),
  ]),
  protein:'Protein foods include seafood, beans, peas and lentils, nuts and seeds, soy foods, eggs, and lean meats and poultry. '
    + 'How much suits you depends on your body and how active you are, so the habit is yours to set.',
});

function adultNutritionText(value, max){
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}
// A whole number in range, null when left blank, NaN when it is something else.
function adultNutritionInt(value, lo, hi){
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : NaN;
}
// Keys from a fixed list, once each, in the list's order. Anything else is dropped.
function adultPickKeys(values, allowed){
  const chosen = new Set(Array.isArray(values) ? values : []);
  return Object.keys(allowed).filter(k => chosen.has(k));
}
const adultHasKey = (allowed, key) => typeof key === 'string' && Object.hasOwn(allowed, key);

function adultValidatePreferences(input){
  const i = input || {};
  const pattern = i.eating_pattern || null, budget = i.weekly_budget || null;
  const cooking = adultNutritionInt(i.cooking_minutes, 1, 600);
  const protein = adultNutritionInt(i.protein_meals_target, 0, 6), plate = adultNutritionInt(i.plate_meals_target, 0, 6);
  if (pattern !== null && !adultHasKey(ADULT_EATING_PATTERNS, pattern)) return { ok:false, error:'Pick a way of eating, or leave it blank.' };
  if (budget !== null && !adultHasKey(ADULT_BUDGETS, budget)) return { ok:false, error:'Pick a budget, or leave it blank.' };
  if (Number.isNaN(cooking) || (cooking !== null && !ADULT_COOK_TIMES.includes(cooking))) return { ok:false, error:'Pick a cooking time, or leave it blank.' };
  if (Number.isNaN(protein)) return { ok:false, error:'Meals with a protein food should be a whole number from 0 to 6.' };
  if (Number.isNaN(plate)) return { ok:false, error:'Meals following the plate guide should be a whole number from 0 to 6.' };
  return { ok:true, value:{
    eating_pattern:pattern, avoid_allergens:adultPickKeys(i.avoid_allergens, ADULT_ALLERGENS),
    avoid_other:adultNutritionText(i.avoid_other, 200) || null, weekly_budget:budget, cooking_minutes:cooking,
    protein_meals_target:protein, plate_meals_target:plate,
  } };
}

// One ingredient per line, as typed. Blank lines are ignored.
function adultParseIngredients(text){
  return String(text || '').split(/\r?\n/).map(line => adultNutritionText(line, 1000)).filter(Boolean);
}

function adultValidateRecipe(input){
  const i = input || {};
  const title = adultNutritionText(i.title, 80);
  const minutes = adultNutritionInt(i.minutes, 1, 600), servings = adultNutritionInt(i.servings, 1, 24);
  const ingredients = Array.isArray(i.ingredients) ? i.ingredients.map(x => adultNutritionText(x, 1000)).filter(Boolean) : adultParseIngredients(i.ingredients);
  const steps = typeof i.steps === 'string' ? i.steps.trim().slice(0, 4000) : '';
  const rawCost = i.cost_estimate;
  const cost = rawCost === '' || rawCost === null || rawCost === undefined ? null : Number(rawCost);
  if (!title) return { ok:false, error:'Give the recipe a name.' };
  if (Number.isNaN(minutes)) return { ok:false, error:'Minutes should be a whole number from 1 to 600.' };
  if (Number.isNaN(servings)) return { ok:false, error:'Servings should be a whole number from 1 to 24.' };
  if (!ingredients.length) return { ok:false, error:'Add at least one ingredient, one per line.' };
  if (ingredients.length > ADULT_INGREDIENT_MAX) return { ok:false, error:'A recipe can list up to ' + ADULT_INGREDIENT_MAX + ' ingredients.' };
  if (ingredients.some(x => x.length > 120)) return { ok:false, error:'Keep each ingredient line to 120 characters.' };
  if (cost !== null && (!Number.isFinite(cost) || cost < 0 || cost >= 10000)) return { ok:false, error:'Cost should be a number from 0 up to 9999.99, or blank.' };
  return { ok:true, value:{
    title, minutes, servings, ingredients, steps:steps || null,
    allergens:adultPickKeys(i.allergens, ADULT_ALLERGENS), plate_groups:adultPickKeys(i.plate_groups, ADULT_PLATE_GROUPS),
    cost_estimate:cost === null ? null : Math.round(cost * 100) / 100,
  } };
}

function adultValidatePlannedMeal(input, today){
  const i = input || {};
  const on = i.planned_on, slot = i.slot, recipe = i.recipe || null;
  const title = recipe ? adultNutritionText(recipe.title, 80) : adultNutritionText(i.title, 80);
  if (typeof on !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(on)) return { ok:false, error:'Pick a day.' };
  if (!adultHasKey(ADULT_MEAL_SLOTS, slot)) return { ok:false, error:'Pick a meal.' };
  if (!title) return { ok:false, error:'Pick one of your recipes or type what you plan to eat.' };
  if (today && adultDaysBetween(today, on) > 60) return { ok:false, error:'Plan up to 60 days ahead.' };
  return { ok:true, value:{ planned_on:on, slot, recipe_id:recipe ? recipe.id : null, title } };
}

function adultValidateNutritionDay(input, today){
  const i = input || {};
  const on = i.logged_on;
  const protein = adultNutritionInt(i.protein_meals, 0, 6), plate = adultNutritionInt(i.plate_meals, 0, 6);
  if (typeof on !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(on)) return { ok:false, error:'Pick a day.' };
  if (today && on > today) return { ok:false, error:'That day hasn’t happened yet.' };
  if (Number.isNaN(protein) || Number.isNaN(plate)) return { ok:false, error:'Use a whole number of meals from 0 to 6.' };
  if (protein === null && plate === null) return { ok:false, error:'Fill in at least one.' };
  return { ok:true, value:{ logged_on:on, protein_meals:protein, plate_meals:plate } };
}

function adultDaysBetween(fromISO, toISO){
  return Math.round((Date.parse(toISO + 'T00:00:00Z') - Date.parse(fromISO + 'T00:00:00Z')) / 86400000);
}

// The allergens a recipe is tagged with that the parent avoids.
function adultRecipeConflicts(recipe, prefs){
  const avoid = new Set((prefs && prefs.avoid_allergens) || []);
  return ((recipe && recipe.allergens) || []).filter(a => avoid.has(a));
}

// The week, Monday first, each day's planned meals in slot order with the recipe they use.
function adultMealPlanWeek(items, recipes, dateFor, prefs){
  const byId = new Map((recipes || []).map(r => [r.id, r]));
  const order = Object.keys(ADULT_MEAL_SLOTS);
  return [0, 1, 2, 3, 4, 5, 6].map(weekday => {
    const date = dateFor(weekday);
    const meals = (items || []).filter(it => it.planned_on === date)
      .slice().sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot) || String(a.created_at || '').localeCompare(String(b.created_at || '')))
      .map(it => {
        const recipe = it.recipe_id ? byId.get(it.recipe_id) || null : null;
        return { ...it, recipe, conflicts:adultRecipeConflicts(recipe, prefs) };
      });
    return { weekday, date, meals };
  });
}

// Every ingredient line from the planned meals that use a recipe, once, with how many planned meals need it. Lines
// match when they read the same ignoring case and spacing; nothing is converted or combined beyond that.
function adultGroceryList(week){
  const lines = new Map();
  (week || []).forEach(day => day.meals.forEach(meal => {
    if (!meal.recipe) return;
    const seen = new Set();
    (meal.recipe.ingredients || []).forEach(raw => {
      const name = adultNutritionText(raw, 120);
      const key = name.toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      const line = lines.get(key) || { name, meals:0 };
      line.meals++;
      lines.set(key, line);
    });
  }));
  return [...lines.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// The parent's own cost estimates for the planned recipes, and how many planned recipes have none.
function adultPlannedCost(week){
  let total = 0, priced = 0, unpriced = 0;
  (week || []).forEach(day => day.meals.forEach(meal => {
    if (!meal.recipe) return;
    if (meal.recipe.cost_estimate === null || meal.recipe.cost_estimate === undefined) { unpriced++; return; }
    total += Number(meal.recipe.cost_estimate); priced++;
  }));
  return { total:Math.round(total * 100) / 100, priced, unpriced };
}

// Days logged this week, and on how many of them each habit met the parent's own target. A habit with no target has
// nothing to meet, so it reports null rather than zero.
function adultHabitSummary(days, prefs){
  const list = days || [];
  const met = (field, target) => target === null || target === undefined ? null
    : list.filter(d => d[field] !== null && d[field] !== undefined && d[field] >= target).length;
  return {
    daysLogged:list.length,
    proteinDaysMet:met('protein_meals', prefs && prefs.protein_meals_target),
    plateDaysMet:met('plate_meals', prefs && prefs.plate_meals_target),
  };
}
