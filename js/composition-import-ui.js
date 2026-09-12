/* The import screen: what a person actually touches to get a clinic result into the product.
 *
 * Markup is built by pure functions taking plain data, so what the screen says can be tested
 * without a browser — which matters more here than usual, because most of what this screen does
 * is make a claim's strength visible. A layout that shows a DXA body fat and a bathroom scale's
 * body fat identically is lying by arrangement, whatever the record underneath says.
 *
 * Everything factual comes from js/composition-import.mjs and the contract behind it. This file
 * decides only how it is shown and what happens on a click.
 */

const CI_SOURCE_ORDER = ['dexa', 'bia_clinical', 'smart_scale', 'health_platform', 'manual_report'];

// How each source is described to someone who has a piece of paper or an app in front of them,
// and does not know what "bioimpedance" means.
const CI_SOURCE_BLURB = Object.freeze({
  dexa: 'A DXA / DEXA scan from a clinic or sports lab.',
  bia_clinical: 'A clinical body composition analyser — InBody, Seca, Tanita MC and similar.',
  smart_scale: 'A bathroom scale that reports body fat as well as weight.',
  health_platform: 'Apple Health, Health Connect or a similar app you sync to.',
  manual_report: 'A printed or emailed report you are typing in by hand.',
});

// The three words this screen must never blur together.
const CI_STATUS_LABEL = Object.freeze({
  measured: 'Measured',
  device_estimated: 'Device estimate',
  calculated: 'Calculated',
});
const CI_STATUS_NOTE = Object.freeze({
  measured: 'The method observed this directly.',
  device_estimated: "The device derived this from something else it measured, using the manufacturer's own equation.",
  calculated: 'Arithmetic on height and weight. Nothing measures it.',
});

function ciStatusChip(status) {
  return `<span class="ci-chip ci-chip-${esc(status)}" title="${esc(CI_STATUS_NOTE[status] || '')}">${esc(CI_STATUS_LABEL[status] || status)}</span>`;
}

/* Step one: what produced this reading.
 *
 * Asked before anything else because it decides everything downstream — which quantities can even
 * appear, and whether each one is a measurement or a derivation. A form that asked for the numbers
 * first would have to re-ask, or worse, keep them.
 */
function ciSourceStep(sources) {
  return `<h3>Where did this reading come from?</h3>
  <p class="ci-muted">What produced a number decides how strong a claim it is. A DXA scan measures body fat; a scale works it out from an electrical signal. Both are worth recording, and they are not the same thing.</p>
  <div class="ci-sources">${CI_SOURCE_ORDER.filter(key => sources[key]).map(key => `
    <button class="ci-source" data-source="${esc(key)}">
      <strong>${esc(sources[key].label)}</strong>
      <span>${esc(CI_SOURCE_BLURB[key] || '')}</span>
    </button>`).join('')}</div>
  <p class="ci-muted ci-scope">Parent Playbook does not produce these numbers and does not check the device that did. An imported result is always shown as what it is — an outside measurement, never a Parent Playbook estimate.</p>`;
}

/* Step two: how it is arriving. */
function ciMethodStep(sourceLabel) {
  return `<h3>How do you have it?</h3>
  <p class="ci-muted">From ${esc(sourceLabel)}.</p>
  <div class="ci-methods">
    <button class="ci-method" data-method="manual"><strong>Type it in</strong><span>One reading, from a report or a screen in front of you.</span></button>
    <button class="ci-method" data-method="csv"><strong>Upload a spreadsheet</strong><span>A CSV export — often a whole history at once.</span></button>
    <button class="ci-method" data-method="json"><strong>Upload a Parent Playbook file</strong><span>A JSON export from another Parent Playbook account.</span></button>
  </div>
  <button class="btn ghost ci-back" data-step="source">Back</button>`;
}

/* Step three, typed: a field per quantity the source can actually report.
 *
 * The status is shown beside every field rather than chosen in one. It is not editable, and the
 * reason is written next to it: whoever is typing does not get to decide how strong the claim is.
 */
function ciManualStep(sourceKey, sourceLabel, metrics, today) {
  const needsMethod = sourceKey === 'manual_report';
  const needsFacility = sourceKey === 'dexa' || sourceKey === 'bia_clinical';
  const needsApp = sourceKey === 'health_platform';
  return `<h3>Type in the reading</h3>
  <p class="ci-muted">From ${esc(sourceLabel)}. Leave anything the report does not give you blank.</p>
  <form class="ci-form" id="ciManualForm" novalidate>
    <label class="ci-field"><span>Date on the report</span>
      <input type="date" name="measuredAt" max="${esc(today)}" required></label>
    ${needsFacility ? `<label class="ci-field"><span>Clinic or facility</span>
      <input type="text" name="facility" maxlength="200" required placeholder="Which clinic or lab">
      <small>Recorded so two scanners can be told apart in a history.</small></label>` : ''}
    ${needsApp ? `<label class="ci-field"><span>Which app recorded it</span>
      <input type="text" name="originatingApp" maxlength="200" required placeholder="The app the reading came from">
      <small>A health platform passes on a number another app produced; without its name the trail ends here.</small></label>` : ''}
    ${needsMethod ? `<label class="ci-field"><span>What method produced the report</span>
      <input type="text" name="methodLabel" maxlength="200" required placeholder="e.g. DXA, Hologic Horizon">
      <small>A transcription is never better evidence than the document it came from.</small></label>` : ''}
    <label class="ci-field ci-optional"><span>Device or model <em>optional</em></span>
      <input type="text" name="model" maxlength="200" placeholder="e.g. InBody 770"></label>

    <div class="ci-values">${metrics.map(metric => `
      <div class="ci-value">
        <label class="ci-field">
          <span>${esc(metric.label)} ${ciStatusChip(metric.status)}</span>
          <span class="ci-entry">
            <input type="text" inputmode="decimal" name="value:${esc(metric.key)}" placeholder="—" autocomplete="off">
            ${metric.unitChoices.length > 1
              ? `<select name="unit:${esc(metric.key)}" aria-label="${esc(metric.label)} unit">${metric.unitChoices.map(u => `<option value="${esc(u)}">${esc(u)}</option>`).join('')}</select>`
              : `<span class="ci-unit">${esc(metric.unit === 'percent' ? '%' : metric.unit === 'kg_m2' ? 'kg/m²' : metric.unit)}</span>`}
          </span>
        </label>
      </div>`).join('')}</div>

    <p class="ci-muted">${esc(CI_STATUS_NOTE.measured)} ${esc(CI_STATUS_NOTE.device_estimated)}</p>
    <div class="ci-actions">
      <button type="button" class="btn ghost ci-back" data-step="method">Back</button>
      <button type="submit" class="btn amber">Check this reading</button>
    </div>
  </form>`;
}

/* Step three, file: the drop target, plus what a usable file looks like.
 *
 * The requirements are stated before the upload rather than after a rejection, because "put the
 * unit in the heading" is far more useful next to the file picker than next to an error.
 */
function ciFileStep(method, sourceLabel) {
  const csv = method === 'csv';
  return `<h3>${csv ? 'Upload a spreadsheet' : 'Upload a Parent Playbook file'}</h3>
  <p class="ci-muted">From ${esc(sourceLabel)}.</p>
  ${csv ? `<ul class="ci-requirements">
    <li>A column saying when each reading was taken — <strong>Date</strong> or <strong>Measured</strong>.</li>
    <li>Weights and masses must say their unit in the heading: <strong>Weight (lb)</strong>, <strong>Lean mass (kg)</strong>. A weight in pounds read as kilograms is still a believable number, so this import will not guess.</li>
    <li>Dates as <strong>2026-09-10</strong> where possible. Slash dates are read only when something in the file settles whether the day or the month comes first.</li>
    <li>Columns it does not recognise are ignored, and it will tell you which.</li>
  </ul>` : `<p class="ci-muted">A JSON file exported from Parent Playbook. Whose record it becomes and what release covers it are decided here, not by the file.</p>`}
  <label class="ci-drop"><input type="file" id="ciFile" accept="${csv ? '.csv,text/csv,text/plain' : '.json,application/json'}">
    <span>Choose a ${csv ? 'CSV' : 'JSON'} file</span></label>
  <button class="btn ghost ci-back" data-step="method">Back</button>`;
}

/* Step four: what is about to be saved, before it is saved.
 *
 * Refused rows are shown alongside the good ones, not behind a link. A partial import that reads
 * as a clean one is the failure this whole screen is arranged to avoid.
 */
function ciReviewStep(result, outcome, sourceLabel) {
  const rows = result.records.slice(0, 50);
  return `<h3>Check before importing</h3>
  <p class="ci-summary ci-${esc(outcome.tone)}">${esc(outcome.text)}</p>
  ${result.dateReason ? `<p class="ci-muted">${esc(result.dateReason)}</p>` : ''}
  ${result.columnsUsed?.length ? `<p class="ci-muted">Using: ${result.columnsUsed.map(c => esc(c.heading) + ' → ' + esc(c.key) + ' (' + esc(c.unit) + ')').join(', ')}.</p>` : ''}
  ${result.columnsIgnored?.length ? `<p class="ci-muted">Ignored: ${result.columnsIgnored.map(esc).join(', ')}.</p>` : ''}
  ${result.problems.length ? `<details class="ci-problems" open><summary>${result.problems.length} ${result.problems.length === 1 ? 'row was' : 'rows were'} refused</summary>
    <ul>${result.problems.map(p => `<li><strong>Line ${esc(p.line)}</strong> — ${esc(p.reason)}</li>`).join('')}</ul></details>` : ''}
  ${rows.length ? `<div class="ci-table-wrap"><table class="ci-table">
    <caption class="sr-only">Readings ready to import from ${esc(sourceLabel)}</caption>
    <thead><tr><th scope="col">Date</th><th scope="col">Measurement</th><th scope="col">Value</th><th scope="col">How it was obtained</th></tr></thead>
    <tbody>${rows.flatMap(record => record.outputs.map((output, i) => `<tr>
      <td>${i === 0 ? esc(localDay(new Date(record.measuredAt))) : ''}</td>
      <td>${esc(output.label)}</td>
      <td>${esc(ciDisplayValue(output))}</td>
      <td>${ciStatusChip(output.status)}</td></tr>`)).join('')}</tbody></table></div>` : ''}
  ${result.records.length > rows.length ? `<p class="ci-muted">Showing the first ${rows.length} of ${result.records.length} readings. All of them will be imported.</p>` : ''}
  <div class="ci-actions">
    <button type="button" class="btn ghost ci-back" data-step="method">Start over</button>
    <button type="button" class="btn amber" id="ciConfirm" ${result.records.length ? '' : 'disabled'}>Import ${result.records.length} ${result.records.length === 1 ? 'reading' : 'readings'}</button>
  </div>`;
}

/* The value as the source gave it, with the conversion shown rather than hidden.
 *
 * Someone who typed 170 lb should see 170 lb, and also see the 77.1 kg that got stored — silently
 * replacing one with the other is how a person loses the ability to check their own data entry.
 */
function ciDisplayValue(output) {
  const stored = output.value + (output.unit === 'percent' ? '%' : output.unit === 'kg_m2' ? ' kg/m²' : output.unit === 'index' ? '' : ' ' + output.unit);
  const original = output.original;
  if (!original || original.unit === output.unit) return stored;
  return original.value + ' ' + original.unit + ' → ' + stored;
}

/* Step five: the outcome, and the one thing left to offer. */
function ciDoneStep(summary, canAttach) {
  return `<h3>${summary.tone === 'error' ? 'Nothing was imported' : 'Imported'}</h3>
  <p class="ci-summary ci-${esc(summary.tone)}">${esc(summary.text)}</p>
  ${summary.reasons.length ? `<ul class="ci-problems">${summary.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
  ${canAttach ? `<div class="ci-attach">
    <h4>Keep the report itself?</h4>
    <p class="ci-muted">A transcription can be checked against its source only while the source still exists. The document is stored privately; the numbers you typed are what appears in the app, and the file is never part of an export.</p>
    <label class="ci-drop"><input type="file" id="ciAttach" accept=".pdf,application/pdf,image/jpeg,image/png,.csv,text/csv">
      <span>Attach the report (PDF, photo or CSV, up to 20 MB)</span></label>
  </div>` : ''}
  <div class="ci-actions"><button type="button" class="btn" id="ciClose">Done</button></div>`;
}

/* Read the typed form into the shape readManualEntry expects.
 *
 * Kept separate from the DOM so the mapping is testable: a form that silently drops a field is
 * indistinguishable from a report that did not have it.
 */
function ciReadForm(entries) {
  const fields = { values: {}, device: {} };
  const units = {};
  for (const [name, value] of entries) {
    if (name.startsWith('value:')) fields.values[name.slice(6)] = String(value);
    else if (name.startsWith('unit:')) units[name.slice(5)] = String(value);
    else if (name === 'measuredAt') fields.measuredAt = String(value);
    else if (name === 'methodLabel') fields.methodLabel = String(value).trim() || null;
    else if (['facility', 'originatingApp', 'model', 'manufacturer'].includes(name)) fields.device[name] = String(value).trim() || null;
  }
  for (const [key, unit] of Object.entries(units)) {
    if (fields.values[key] != null && String(fields.values[key]).trim() !== '') fields.values[key] = { value: fields.values[key], unit };
  }
  // An empty field is a value the report did not give, not a zero.
  for (const [key, value] of Object.entries(fields.values)) {
    const raw = value && typeof value === 'object' ? value.value : value;
    if (raw == null || String(raw).trim() === '') delete fields.values[key];
  }
  return fields;
}

/* ------------------------------------------------------------------ wiring
 *
 * Everything above is data in, string out. Below is the only part that needs a browser.
 */
async function openCompositionImport(context = {}) {
  const IMPORT = await import('/js/composition-import.mjs');
  const sources = IMPORT.REFERENCE_SOURCES;
  // The user's own day, not the UTC one. In UTC+13 the UTC day is already tomorrow, and a max of
  // the UTC day would refuse a reading taken this afternoon.
  const today = localDay();
  const bg = sheet('<h3>Import a measurement</h3><p class="ci-muted" role="status">Loading…</p>');
  const card = bg.querySelector('.sheet');
  let sourceKey = null, method = null, parsed = null;

  const paint = html => {
    card.innerHTML = '<div class="grab"></div>' + html;
    card.querySelectorAll('.ci-back').forEach(button => {
      button.onclick = () => (button.dataset.step === 'source' ? showSource() : showMethod());
    });
  };
  const showSource = () => {
    sourceKey = null; method = null; parsed = null;
    paint(ciSourceStep(sources));
    card.querySelectorAll('.ci-source').forEach(button => {
      button.onclick = () => { sourceKey = button.dataset.source; showMethod(); };
    });
  };
  const showMethod = () => {
    method = null; parsed = null;
    paint(ciMethodStep(sources[sourceKey].label));
    card.querySelectorAll('.ci-method').forEach(button => {
      button.onclick = () => { method = button.dataset.method; method === 'manual' ? showManual() : showFile(); };
    });
  };

  const problem = message => {
    const node = card.querySelector('.ci-summary') || card.insertBefore(document.createElement('p'), card.querySelector('.ci-actions'));
    node.className = 'ci-summary ci-error';
    node.setAttribute('role', 'alert');
    node.textContent = message;
  };

  const showManual = () => {
    paint(ciManualStep(sourceKey, sources[sourceKey].label, IMPORT.importableMetrics(sourceKey), today));
    card.querySelector('#ciManualForm').onsubmit = event => {
      event.preventDefault();
      const fields = ciReadForm(new FormData(event.target).entries());
      try {
        const record = IMPORT.readManualEntry(fields, { ...context, sourceClass: sourceKey });
        parsed = { records: [record], problems: [], rowsRead: 1, columnsUsed: [], columnsIgnored: [] };
        showReview();
      } catch (error) { problem(error.message); }
    };
  };

  const showFile = () => {
    paint(ciFileStep(method, sources[sourceKey].label));
    card.querySelector('#ciFile').onchange = async event => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        parsed = method === 'csv'
          ? IMPORT.parseCompositionCsv(text, { ...context, sourceClass: sourceKey })
          : IMPORT.parseCompositionJson(text, { ...context, sourceClass: sourceKey });
        showReview();
      } catch (error) { problem(error.message); }
    };
  };

  const showReview = () => {
    paint(ciReviewStep(parsed, IMPORT.describeImportOutcome(parsed), sources[sourceKey].label));
    const confirm = card.querySelector('#ciConfirm');
    if (!confirm) return;
    confirm.onclick = async () => {
      confirm.disabled = true;
      confirm.textContent = 'Importing…';
      try {
        const summary = await context.save(parsed.records);
        paint(ciDoneStep(summary, sourceKey === 'manual_report' && summary.saved === 1 && !!summary.firstSavedId));
        const attach = card.querySelector('#ciAttach');
        if (attach) attach.onchange = async event => {
          const file = event.target.files?.[0];
          if (!file) return;
          try { await context.attach(summary.firstSavedId, file); attach.closest('.ci-attach').innerHTML = '<p class="ci-summary ci-ok">Report attached. It is stored privately and is not part of any export.</p>'; }
          catch (error) { problem(error.message); }
        };
        card.querySelector('#ciClose').onclick = () => { bg.remove(); context.onDone?.(); };
      } catch (error) {
        confirm.disabled = false;
        confirm.textContent = 'Try again';
        problem(error.message);
      }
    };
  };

  showSource();
  return bg;
}
