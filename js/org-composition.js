/* What an organization sees of a family's imported clinical results.
 *
 * Read-only, and narrower than it first looks. An organization sees a reading only while the
 * guardian's row names it; withdrawing is a single column and takes effect immediately, with no
 * organization-side accept and no organization-side copy. The source document never travels with
 * the numbers — the attachment policy follows write rights on the record, which an organization
 * never has, so the PDF carrying a name and a date of birth stays with the family.
 *
 * TWO THINGS THIS SCREEN DELIBERATELY IS NOT, because both are what a roster table naturally
 * becomes if nobody stops it:
 *
 *   It is not sortable by value, and it has no league table. Body composition sorted descending
 *   across a roster of children is a ranking of children by body fat, and it does not stop being
 *   one because the column header was neutral. Rows are ordered by name, always.
 *
 *   It is not a Parent Playbook measurement or estimate. Every row names the device or clinic that
 *   produced it and how strong that claim is, because an organization reading these has no other
 *   way to tell a DXA scan from a bathroom scale — and those are not the same evidence.
 */

// What the family shared, grouped per athlete, newest reading first within each.
//
// Ordered by athlete name rather than by any value. This is the ranking guard, and it lives in
// the data layer rather than the markup so a future table cannot quietly re-sort what it is given.
function ocRows(records = [], athletesById = new Map()) {
  const byAthlete = new Map();
  for (const row of records) {
    if (!row || !row.athlete_id || !row.record) continue;
    const list = byAthlete.get(row.athlete_id) || [];
    list.push(row);
    byAthlete.set(row.athlete_id, list);
  }
  return [...byAthlete.entries()]
    .map(([athleteId, list]) => ({
      athleteId,
      name: athletesById.get(athleteId)?.first_name || 'Athlete',
      readings: list.slice().sort((a, b) => String(b.measured_at).localeCompare(String(a.measured_at))
        || String(b.record_id).localeCompare(String(a.record_id))),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.athleteId.localeCompare(b.athleteId));
}

const OC_STATUS_LABEL = Object.freeze({ measured: 'Measured', device_estimated: 'Device estimate', calculated: 'Calculated' });
const OC_STATUS_NOTE = Object.freeze({
  measured: 'The method observed this directly.',
  device_estimated: "The device derived this from something else it measured, using the manufacturer's own equation.",
  calculated: 'Arithmetic on height and weight. Nothing measures it.',
});

function ocChip(status) {
  return '<span class="ci-chip ci-chip-' + esc(status) + '" title="' + esc(OC_STATUS_NOTE[status] || '') + '">'
    + esc(OC_STATUS_LABEL[status] || status) + '</span>';
}

// Where a reading came from, in a phrase an administrator can act on. A clinic name matters
// because two scanners are not interchangeable; a scale's model matters for the same reason.
function ocProvenance(record) {
  const device = record?.device || {};
  const parts = [record?.sourceLabel || record?.sourceClass || 'Unknown source'];
  if (device.facility) parts.push(device.facility);
  else if (device.originatingApp) parts.push('via ' + device.originatingApp);
  else if (device.manufacturer || device.model) parts.push([device.manufacturer, device.model].filter(Boolean).join(' '));
  if (record?.methodLabel) parts.push(record.methodLabel);
  return parts.join(' · ');
}

function ocValue(output) {
  const unit = output.unit === 'percent' ? '%' : output.unit === 'kg_m2' ? ' kg/m²' : output.unit === 'index' ? '' : ' ' + output.unit;
  return output.value + unit;
}

function ocReadingTable(readings) {
  const rows = readings.flatMap(row => (row.record.outputs || []).map((output, i) => '<tr>'
    + '<td>' + (i === 0 ? esc(localDay(new Date(row.measured_at))) : '') + '</td>'
    + '<td>' + (i === 0 ? esc(ocProvenance(row.record)) : '') + '</td>'
    + '<td>' + esc(output.label || output.key) + '</td>'
    + '<td>' + esc(ocValue(output)) + '</td>'
    + '<td>' + ocChip(output.status) + '</td></tr>'));
  return '<div class="bi-table-wrap"><table class="bi-table">'
    + '<caption class="sr-only">Imported measurements this family has shared</caption>'
    + '<thead><tr><th scope="col">Taken</th><th scope="col">Source</th><th scope="col">Measurement</th><th scope="col">Value</th><th scope="col">How it was obtained</th></tr></thead>'
    + '<tbody>' + rows.join('') + '</tbody></table></div>';
}

function ocAthleteSection(group) {
  const latest = group.readings[0];
  return '<section class="oc-athlete"><div class="bi-section-head"><h3>' + esc(group.name) + '</h3>'
    + '<span>' + group.readings.length + (group.readings.length === 1 ? ' shared reading' : ' shared readings')
    + ' · latest ' + esc(localDay(new Date(latest.measured_at))) + '</span></div>'
    + ocReadingTable(group.readings) + '</section>';
}

/* The section as it appears inside the organization's body assessments screen.
 *
 * The empty state is not an error and does not suggest chasing anyone. A family sharing nothing is
 * the default and a legitimate permanent answer, and a screen that reads as though something is
 * missing turns that into a request.
 */
function ocMarkup(groups, teamName) {
  const readings = groups.reduce((n, g) => n + g.readings.length, 0);
  return '<section class="bi-reference oc-section">'
    + '<div class="bi-section-head"><div><span class="bi-eyebrow">SHARED BY FAMILIES</span>'
    + '<h2>Imported clinical measurements</h2></div>'
    + '<span>' + (readings ? readings + (readings === 1 ? ' reading from ' : ' readings from ') + groups.length + (groups.length === 1 ? ' athlete' : ' athletes') : 'Nothing shared') + '</span></div>'
    + '<p class="bi-muted">These were measured elsewhere — a clinic, a device, a report a parent typed in — and shared with '
    + esc(teamName) + ' by the family. Parent Playbook did not perform them, has not checked the devices that did, and makes no accuracy claim about them. '
    + 'A family can stop sharing at any time, and the reading disappears from here when they do.</p>'
    + (groups.length ? groups.map(ocAthleteSection).join('')
      : '<div class="bi-empty">No family has shared an imported measurement with this organization. '
        + 'Sharing is theirs to offer, not yours to request, and no athlete is missing anything by not appearing here.</div>')
    + '<p class="bi-muted oc-scope"><strong>What these are not for.</strong> Not eligibility, team selection, athletic-potential ranking, '
    + 'a weight-loss target or an automatic training change. Rows are ordered by name and cannot be sorted by value, because a roster '
    + 'sorted by body fat is a ranking of children by body fat whatever the column is called. The source documents stay with the family; '
    + 'only the numbers above were shared.</p></section>';
}

/* ------------------------------------------------------------------ wiring */

async function loadOrgComposition(teamId, isCurrent) {
  // RLS is the boundary: the team filter here decides what to ASK for, and the policy decides
  // what comes back. A row is returned only when the guardian named this team and the athlete is
  // on its roster, so a wrong id returns nothing rather than somebody else's child.
  const { data, error } = await sb.from('external_composition_records')
    .select('id,record_id,athlete_id,measured_at,source_class,record')
    .eq('team_id', teamId)
    .order('measured_at', { ascending: false })
    .limit(400);
  if (error) throw error;
  if (!isCurrent()) return null;
  const rows = Array.isArray(data) ? data : [];
  const ids = [...new Set(rows.map(r => r.athlete_id).filter(Boolean))];
  const athletesById = new Map();
  if (ids.length) {
    const { data: athletes, error: athleteError } = await sb.from('athletes').select('id,first_name').in('id', ids);
    if (athleteError) throw athleteError;
    for (const athlete of athletes || []) athletesById.set(athlete.id, athlete);
  }
  return { rows, athletesById };
}
