// ===================================================================
//  YOUR TRAINING → EATING — a parent's own meal plan (Adult Training, milestone 2)
// ===================================================================
// A plate guide, the parent's food preferences and the allergens they avoid, recipes they add themselves, meals they
// plan for the week with the grocery list those recipes add up to, and two eating habits they log against targets they
// set. Like the rest of Your training it belongs to the signed-in guardian alone: this screen never reads the active
// child and nothing here reaches a child's profile or plan. Behind ADULT_TRAINING_ENABLED and the allowlist.
//
// What it deliberately does not do: prescribe an amount of food, show a nutrient value, or promise a recipe is safe
// for an allergy. Allergen tags and costs are what the parent entered.

async function screenAdultEating(){
  if (adultTrainingOff()) return;
  const uid = state.user.id;
  const weekStart = isoDay(mondayOfThisWeek()), weekEnd = dateForDayIndex(6), today = todayISO();
  const results = await Promise.all([
    sb.from('adult_nutrition_preferences').select('*').eq('guardian_id', uid).maybeSingle(),
    sb.from('adult_recipes').select('*').eq('guardian_id', uid).order('title').limit(200),
    sb.from('adult_meal_plan_items').select('*').eq('guardian_id', uid).gte('planned_on', weekStart).lte('planned_on', weekEnd).order('created_at'),
    sb.from('adult_nutrition_days').select('*').eq('guardian_id', uid).gte('logged_on', weekStart).lte('logged_on', weekEnd),
  ]);
  if (results.some(r => r.error)) {
    results.filter(r => r.error).forEach(r => console.error(r.error));
    $("#screen").innerHTML = H`${adultTopBar()}<div class="app-pad" style="padding-top:6px">${adultSectionSwitch('eating')}
      <p class="empty">Meal planning isn't available on this account yet.</p></div>`;
    bindAdultChrome();
    return;
  }
  const [prefRow, recipeRows, planRows, dayRows] = results;
  const prefs = prefRow.data || null, recipes = recipeRows.data || [], plan = planRows.data || [], days = dayRows.data || [];
  const week = adultMealPlanWeek(plan, recipes, dateForDayIndex, prefs);
  const grocery = adultGroceryList(week);
  const cost = adultPlannedCost(week);
  const habits = adultHabitSummary(days, prefs);
  const plannedDays = week.filter(d => d.meals.length);
  const G = ADULT_PLATE_GUIDE;
  const names = (keys, table) => (keys || []).map(k => table[k]).filter(Boolean).join(', ');
  const avoiding = prefs ? [names(prefs.avoid_allergens, ADULT_ALLERGENS), prefs.avoid_other || ''].filter(Boolean).join('; ') : '';

  $("#screen").innerHTML = H`${adultTopBar()}
    <div class="app-pad" style="padding-top:6px">
      ${adultSectionSwitch('eating')}
      <p class="muted-note" style="margin-top:0">Private to you, and for your own meals. None of it appears on a child's profile or plan.</p>

      <div class="sec-title">The plate guide</div>
      <div class="card app-pad">
        ${G.parts.map(p => H`<div class="mrow"><span><b>${esc(ADULT_PLATE_GROUPS[p.group])}</b><small>${esc(p.text)}</small></span></div>`).join('')}
        <p class="muted-note" style="margin:8px 0 0">${esc(G.protein)} After <a href="${esc(G.url)}" target="_blank" rel="noopener">${esc(G.source)}</a>.</p>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="sec-title">Your preferences</div>
        <button class="btn sm ghost" id="adultPrefs">${prefs ? 'Edit' : 'Set up'}</button>
      </div>
      <div class="card app-pad">
        ${prefs ? H`
          <div class="mrow"><span>Way of eating</span><b>${esc(ADULT_EATING_PATTERNS[prefs.eating_pattern] || 'Not set')}</b></div>
          <div class="mrow"><span>Avoiding</span><b>${esc(avoiding || 'Nothing listed')}</b></div>
          <div class="mrow"><span>Budget</span><b>${esc(ADULT_BUDGETS[prefs.weekly_budget] || 'Not set')}</b></div>
          <div class="mrow"><span>Cooking time</span><b>${prefs.cooking_minutes ? esc(String(prefs.cooking_minutes)) + ' min' : 'Not set'}</b></div>`
          : H`<p class="empty" style="margin:0">How you like to eat, what you avoid, your budget and how long you want to spend cooking.</p>`}
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="sec-title">Habits this week</div>
        <button class="btn sm ghost" id="adultLogDay">Log today</button>
      </div>
      <div class="card app-pad">
        <div class="mrow"><span>Days logged</span><b>${habits.daysLogged}</b></div>
        ${habits.proteinDaysMet !== null ? H`<div class="mrow"><span>Your aim of ${esc(String(prefs.protein_meals_target))} meals with a protein food</span><b>${habits.proteinDaysMet} of ${habits.daysLogged} days</b></div>` : ''}
        ${habits.plateDaysMet !== null ? H`<div class="mrow"><span>Your aim of ${esc(String(prefs.plate_meals_target))} meals following the plate guide</span><b>${habits.plateDaysMet} of ${habits.daysLogged} days</b></div>` : ''}
        ${habits.proteinDaysMet === null && habits.plateDaysMet === null ? H`<p class="muted-note" style="margin:8px 0 0">Set your own daily aims in preferences, or just log what you ate. Start wherever you are.</p>` : ''}
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="sec-title">Meals this week</div>
        <button class="btn sm ghost" id="adultPlanMeal">＋ Plan a meal</button>
      </div>
      ${plannedDays.length ? plannedDays.map(d => H`
        <div class="card app-pad" style="margin-top:10px">
          <div class="k-mono">${esc(fmtDate(d.date))}</div>
          ${d.meals.map(m => H`<div class="mrow">
            <span><b>${esc(m.title)}</b><small>${esc(ADULT_MEAL_SLOTS[m.slot] || '')}${m.recipe && m.recipe.minutes ? ' · ' + esc(String(m.recipe.minutes)) + ' min' : ''}${m.conflicts.length
              ? ' · ⚠ tagged ' + esc(names(m.conflicts, ADULT_ALLERGENS).toLowerCase()) + ', which you avoid' : ''}</small></span>
            <button class="btn sm ghost" data-adult-meal-remove="${esc(m.id)}">Remove</button></div>`).join('')}
        </div>`).join('')
        : H`<p class="empty">Nothing planned. Plan a meal from one of your recipes, or type one in.</p>`}

      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="sec-title">Grocery list</div>
        ${grocery.length ? '<button class="btn sm ghost" id="adultCopyGrocery">Copy</button>' : ''}
      </div>
      <div class="card app-pad">
        ${grocery.length ? grocery.map(g => H`<div class="mrow"><span>${esc(g.name)}</span>${g.meals > 1 ? H`<b>for ${g.meals} meals</b>` : ''}</div>`).join('')
          : H`<p class="empty" style="margin:0">The ingredients of this week's planned recipes show up here.</p>`}
        ${cost.priced ? H`<p class="muted-note" style="margin:8px 0 0">Your cost estimates for this week's planned recipes add up to ${esc(cost.total.toFixed(2))}${cost.unpriced ? H` (${cost.unpriced} without an estimate)` : ''}.</p>` : ''}
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="sec-title">Your recipes</div>
        <button class="btn sm ghost" id="adultAddRecipe">＋ Add</button>
      </div>
      <div class="card app-pad">
        ${recipes.length ? recipes.map(r => { const conflicts = adultRecipeConflicts(r, prefs);
          return H`<div class="mrow">
            <span><b>${esc(r.title)}</b><small>${esc([r.minutes ? r.minutes + ' min' : '', r.servings ? r.servings + (r.servings === 1 ? ' serving' : ' servings') : '',
              names(r.plate_groups, ADULT_PLATE_GROUPS)].filter(Boolean).join(' · '))}${conflicts.length ? ' · ⚠ tagged ' + esc(names(conflicts, ADULT_ALLERGENS).toLowerCase()) : ''}</small></span>
            <button class="btn sm ghost" data-adult-recipe-edit="${esc(r.id)}">Edit</button></div>`; }).join('')
          : H`<p class="empty" style="margin:0">No recipes yet. Add the meals you already make, with their ingredients, one per line.</p>`}
      </div>

      <p class="muted-note" style="margin-top:16px">Allergen tags are the ones you put on each recipe, so check the label on anything you buy. No nutrient values are shown, because nothing here measures them. If you have a medical condition that affects what you eat, follow your doctor's or dietitian's advice.</p>
    </div>`;

  bindAdultChrome();
  $("#adultPrefs").onclick = () => openAdultPreferences(prefs);
  $("#adultLogDay").onclick = () => openAdultNutritionDay(days.find(d => d.logged_on === today) || null, prefs);
  $("#adultPlanMeal").onclick = () => openAdultPlanMeal(recipes, prefs);
  $("#adultAddRecipe").onclick = () => openAdultRecipe(null);
  { const b = $("#adultCopyGrocery"); if (b) b.onclick = async () => {
    const text = grocery.map(g => g.name).join('\n');
    try { await navigator.clipboard.writeText(text); toast('Grocery list copied'); }
    catch (e) { toast('Copying isn’t available in this browser'); }
  }; }
  $("#screen").querySelectorAll('[data-adult-meal-remove]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    const { error } = await sb.from('adult_meal_plan_items').delete().eq('id', b.dataset.adultMealRemove).eq('guardian_id', uid);
    if (error) { adultFail(error, 'adult:mealRemove', 'Could not remove that meal'); b.disabled = false; return; }
    renderApp('adult');
  });
  $("#screen").querySelectorAll('[data-adult-recipe-edit]').forEach(b => b.onclick = () => {
    const recipe = recipes.find(r => r.id === b.dataset.adultRecipeEdit);
    if (recipe) openAdultRecipe(recipe);
  });
}

// Toggle chips for a multiple choice: each press flips one, and the sheet reads the ones that are on.
function adultChips(table, chosen, attr){
  const on = new Set(chosen || []);
  return H`<div class="chipgrid">${Object.entries(table).map(([k, l]) => H`<button type="button" class="chip${on.has(k) ? ' on' : ''}" ${attr}="${esc(k)}" aria-pressed="${on.has(k) ? 'true' : 'false'}">${esc(l)}</button>`).join('')}</div>`;
}
function bindAdultChips(bg, attr){
  bg.querySelectorAll('[' + attr + ']').forEach(c => c.onclick = () => {
    c.classList.toggle('on');
    c.setAttribute('aria-pressed', c.classList.contains('on') ? 'true' : 'false');
  });
}
function adultChipValues(bg, attr){
  return [...bg.querySelectorAll('[' + attr + '].on')].map(c => c.getAttribute(attr));
}
function adultOptions(table, selected, blank){
  return (blank ? `<option value="">${esc(blank)}</option>` : '')
    + Object.entries(table).map(([k, l]) => `<option value="${esc(k)}"${selected === k ? ' selected' : ''}>${esc(l)}</option>`).join('');
}

function openAdultPreferences(prefs){
  const p = prefs || {};
  const bg = sheet(H`<h3>Your food preferences</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 12px">All optional, and you can change them later.</p>
    <div class="field"><label>Way of eating</label><select id="anPattern">${adultOptions(ADULT_EATING_PATTERNS, p.eating_pattern, 'Not set')}</select></div>
    <div class="field"><label>Allergens you avoid</label>${adultChips(ADULT_ALLERGENS, p.avoid_allergens, 'data-avoid')}</div>
    <div class="field"><label>Anything else you avoid</label><input id="anOther" maxlength="200" value="${esc(p.avoid_other || '')}" placeholder="e.g. mushrooms"/></div>
    <div class="row2">
      <div class="field"><label>Weekly budget</label><select id="anBudget">${adultOptions(ADULT_BUDGETS, p.weekly_budget, 'Not set')}</select></div>
      <div class="field"><label>Cooking time</label><select id="anCook"><option value="">Not set</option>${ADULT_COOK_TIMES.map(m => `<option value="${m}"${p.cooking_minutes === m ? ' selected' : ''}>Up to ${m} min</option>`).join('')}</select></div>
    </div>
    <div class="sec-title" style="margin-top:6px">Your daily aims</div>
    <div class="row2">
      <div class="field"><label>Meals with a protein food</label><input id="anProtein" type="number" inputmode="numeric" min="0" max="6" value="${esc(p.protein_meals_target == null ? '' : String(p.protein_meals_target))}" placeholder="e.g. 2"/></div>
      <div class="field"><label>Meals following the plate guide</label><input id="anPlate" type="number" inputmode="numeric" min="0" max="6" value="${esc(p.plate_meals_target == null ? '' : String(p.plate_meals_target))}" placeholder="e.g. 1"/></div>
    </div>
    <p style="font-size:11.5px;color:var(--muted);margin:-4px 2px 12px">How much protein suits you depends on your body and how active you are. Pick aims that fit your week now.</p>
    <div class="err" id="anPrefErr"></div>
    <button class="btn" id="anPrefSave">Save</button>`);
  bindAdultChips(bg, 'data-avoid');
  bg.querySelector('#anPrefSave').onclick = async e => {
    const err = bg.querySelector('#anPrefErr'); err.textContent = '';
    const v = adultValidatePreferences({
      eating_pattern:bg.querySelector('#anPattern').value, avoid_allergens:adultChipValues(bg, 'data-avoid'),
      avoid_other:bg.querySelector('#anOther').value, weekly_budget:bg.querySelector('#anBudget').value,
      cooking_minutes:bg.querySelector('#anCook').value, protein_meals_target:bg.querySelector('#anProtein').value,
      plate_meals_target:bg.querySelector('#anPlate').value,
    });
    if (!v.ok) { err.textContent = v.error; return; }
    const btn = e.currentTarget; btn.disabled = true;
    const { error } = await sb.from('adult_nutrition_preferences').upsert({ ...v.value, guardian_id:state.user.id, updated_at:new Date().toISOString() }, { onConflict:'guardian_id' });
    if (error) { adultFail(error, 'adult:nutritionPrefs', 'Could not save'); btn.disabled = false; return; }
    bg.remove(); toast('Saved'); renderApp('adult');
  };
}

function openAdultRecipe(recipe){
  const r = recipe || {};
  const bg = sheet(H`<h3>${recipe ? 'Edit recipe' : 'Add a recipe'}</h3>
    <div class="field"><label>Name</label><input id="anTitle" maxlength="80" value="${esc(r.title || '')}" placeholder="e.g. Sheet-pan chicken and vegetables"/></div>
    <div class="row2">
      <div class="field"><label>Minutes</label><input id="anMinutes" type="number" inputmode="numeric" min="1" max="600" value="${esc(r.minutes == null ? '' : String(r.minutes))}"/></div>
      <div class="field"><label>Servings</label><input id="anServings" type="number" inputmode="numeric" min="1" max="24" value="${esc(r.servings == null ? '' : String(r.servings))}"/></div>
    </div>
    <div class="field"><label>Ingredients, one per line</label><textarea id="anIngredients" rows="6" placeholder="2 chicken thighs&#10;1 bell pepper&#10;1 cup brown rice">${esc((r.ingredients || []).join('\n'))}</textarea></div>
    <div class="field"><label>Steps</label><textarea id="anSteps" rows="4" maxlength="4000">${esc(r.steps || '')}</textarea></div>
    <div class="field"><label>Plate groups it covers</label>${adultChips(ADULT_PLATE_GROUPS, r.plate_groups, 'data-plate')}</div>
    <div class="field"><label>Contains</label>${adultChips(ADULT_ALLERGENS, r.allergens, 'data-contains')}</div>
    <div class="field"><label>Your cost estimate</label><input id="anCost" type="number" inputmode="decimal" step="0.01" min="0" value="${esc(r.cost_estimate == null ? '' : String(r.cost_estimate))}" placeholder="optional"/></div>
    <div class="err" id="anRecipeErr"></div>
    <button class="btn" id="anRecipeSave">${recipe ? 'Save changes' : 'Add recipe'}</button>
    ${recipe ? '<button class="btn danger" id="anRecipeDelete" style="margin-top:12px">Delete this recipe</button>' : ''}`);
  bindAdultChips(bg, 'data-plate');
  bindAdultChips(bg, 'data-contains');
  bg.querySelector('#anRecipeSave').onclick = async e => {
    const err = bg.querySelector('#anRecipeErr'); err.textContent = '';
    const v = adultValidateRecipe({
      title:bg.querySelector('#anTitle').value, minutes:bg.querySelector('#anMinutes').value, servings:bg.querySelector('#anServings').value,
      ingredients:bg.querySelector('#anIngredients').value, steps:bg.querySelector('#anSteps').value,
      plate_groups:adultChipValues(bg, 'data-plate'), allergens:adultChipValues(bg, 'data-contains'), cost_estimate:bg.querySelector('#anCost').value,
    });
    if (!v.ok) { err.textContent = v.error; return; }
    const btn = e.currentTarget; btn.disabled = true;
    const { error } = recipe
      ? await sb.from('adult_recipes').update({ ...v.value, updated_at:new Date().toISOString() }).eq('id', recipe.id).eq('guardian_id', state.user.id)
      : await sb.from('adult_recipes').insert({ ...v.value, guardian_id:state.user.id });
    if (error) { adultFail(error, 'adult:recipe', 'Could not save the recipe'); btn.disabled = false; return; }
    bg.remove(); toast(recipe ? 'Saved' : 'Recipe added'); renderApp('adult');
  };
  if (!recipe) return;
  bg.querySelector('#anRecipeDelete').onclick = async e => {
    if (!confirm('Delete this recipe? Meals you already planned with it stay on your plan.')) return;
    const btn = e.currentTarget; btn.disabled = true;
    const { error } = await sb.from('adult_recipes').delete().eq('id', recipe.id).eq('guardian_id', state.user.id);
    if (error) { adultFail(error, 'adult:recipeDelete', 'Could not delete the recipe'); btn.disabled = false; return; }
    bg.remove(); toast('Recipe deleted'); renderApp('adult');
  };
}

function openAdultPlanMeal(recipes, prefs){
  const today = todayISO();
  const latest = isoDay(new Date(Date.parse(today + 'T12:00:00') + 60 * 86400000));
  const bg = sheet(H`<h3>Plan a meal</h3>
    <div class="row2">
      <div class="field"><label>Day</label><input id="anPlanDate" type="date" value="${today}" max="${latest}"/></div>
      <div class="field"><label>Meal</label><select id="anPlanSlot">${adultOptions(ADULT_MEAL_SLOTS, 'dinner')}</select></div>
    </div>
    <div class="field"><label>Recipe</label><select id="anPlanRecipe"><option value="">Type a meal instead</option>
      ${(recipes || []).map(r => `<option value="${esc(r.id)}">${esc(r.title)}</option>`).join('')}</select></div>
    <div class="field" id="anPlanTitleField"><label>What you plan to eat</label><input id="anPlanTitle" maxlength="80" placeholder="e.g. Leftover chili"/></div>
    <p class="muted-note" id="anPlanWarn" style="margin:-4px 2px 12px" hidden></p>
    <div class="err" id="anPlanErr"></div>
    <button class="btn" id="anPlanSave">Add to this week</button>`);
  const recipeEl = bg.querySelector('#anPlanRecipe'), warn = bg.querySelector('#anPlanWarn');
  const chosen = () => (recipes || []).find(r => r.id === recipeEl.value) || null;
  recipeEl.onchange = () => {
    const recipe = chosen(), conflicts = adultRecipeConflicts(recipe, prefs);
    bg.querySelector('#anPlanTitleField').hidden = !!recipe;
    warn.hidden = !conflicts.length;
    warn.textContent = conflicts.length ? '⚠ You tagged this recipe with ' + conflicts.map(k => ADULT_ALLERGENS[k].toLowerCase()).join(', ') + ', which you avoid.' : '';
  };
  bg.querySelector('#anPlanSave').onclick = async e => {
    const err = bg.querySelector('#anPlanErr'); err.textContent = '';
    const v = adultValidatePlannedMeal({ planned_on:bg.querySelector('#anPlanDate').value, slot:bg.querySelector('#anPlanSlot').value,
      recipe:chosen(), title:bg.querySelector('#anPlanTitle').value }, today);
    if (!v.ok) { err.textContent = v.error; return; }
    const btn = e.currentTarget; btn.disabled = true;
    const { error } = await sb.from('adult_meal_plan_items').insert({ ...v.value, guardian_id:state.user.id });
    if (error) { adultFail(error, 'adult:planMeal', 'Could not plan that meal'); btn.disabled = false; return; }
    bg.remove(); toast('Planned'); renderApp('adult');
  };
}

function openAdultNutritionDay(row, prefs){
  const today = todayISO(), d = row || {};
  const aim = n => n == null ? '' : H` <small>(your aim: ${esc(String(n))})</small>`;
  const bg = sheet(H`<h3>Today's eating habits</h3>
    <p style="color:var(--muted);font-size:13px;margin:6px 0 12px">A quick count for ${esc(fmtDate(today))}. You can update it later today.</p>
    <div class="field"><label>Meals with a protein food${aim(prefs && prefs.protein_meals_target)}</label><input id="anDayProtein" type="number" inputmode="numeric" min="0" max="6" value="${esc(d.protein_meals == null ? '' : String(d.protein_meals))}"/></div>
    <div class="field"><label>Meals following the plate guide${aim(prefs && prefs.plate_meals_target)}</label><input id="anDayPlate" type="number" inputmode="numeric" min="0" max="6" value="${esc(d.plate_meals == null ? '' : String(d.plate_meals))}"/></div>
    <div class="err" id="anDayErr"></div>
    <button class="btn" id="anDaySave">Save</button>`);
  bg.querySelector('#anDaySave').onclick = async e => {
    const err = bg.querySelector('#anDayErr'); err.textContent = '';
    const v = adultValidateNutritionDay({ logged_on:today, protein_meals:bg.querySelector('#anDayProtein').value, plate_meals:bg.querySelector('#anDayPlate').value }, today);
    if (!v.ok) { err.textContent = v.error; return; }
    const btn = e.currentTarget; btn.disabled = true;
    const { error } = await sb.from('adult_nutrition_days').upsert({ ...v.value, guardian_id:state.user.id, updated_at:new Date().toISOString() }, { onConflict:'guardian_id,logged_on' });
    if (error) { adultFail(error, 'adult:nutritionDay', 'Could not save'); btn.disabled = false; return; }
    bg.remove(); toast('Logged'); renderApp('adult');
  };
}
