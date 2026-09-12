/* The family's own list of imported measurements, and the decision to share one.
 *
 * Sharing is a per-reading choice, not a setting. A parent who had a DXA scan done for a medical
 * reason and a smart-scale history they are indifferent about should not have to treat those the
 * same way, and a single "share my data" switch would make them.
 *
 * What sharing actually does is stated at the point of the decision rather than in a policy page,
 * because that is where someone is deciding: the organization sees these numbers, does not see the
 * document they came from, cannot change or keep them, and loses access the moment sharing stops.
 */

const CS_SOURCE_SHORT = Object.freeze({
  dexa: 'DXA scan', bia_clinical: 'Clinical bioimpedance', smart_scale: 'Smart scale',
  health_platform: 'Health platform', manual_report: 'Transcribed report',
});

// A reading in one line: what it is, when, and how strong the strongest claim in it is.
function csReadingLine(row) {
  const outputs = row.record?.outputs || [];
  const measured = outputs.filter(o => o.status === 'measured').length;
  const strength = measured ? measured + ' measured' : outputs.length + ' device ' + (outputs.length === 1 ? 'estimate' : 'estimates');
  return esc(localDay(new Date(row.measuredAt))) + ' · ' + esc(CS_SOURCE_SHORT[row.sourceClass] || row.sourceClass)
    + ' · ' + esc(outputs.length + (outputs.length === 1 ? ' value' : ' values') + ', ' + strength);
}

function csRow(row, index, teamName) {
  const shared = !!row.sharedWithTeamId;
  return '<li class="cs-row' + (shared ? ' cs-shared' : '') + '">'
    + '<div class="cs-line"><strong>' + csReadingLine(row) + '</strong>'
    + (shared ? '<span class="cs-badge">Shared with ' + esc(teamName || 'your organization') + '</span>' : '')
    + '</div>'
    + '<div class="cs-row-actions">'
    + (teamName
      ? '<button class="btn ghost" data-cs-share="' + index + '">' + (shared ? 'Stop sharing' : 'Share with ' + esc(teamName)) + '</button>'
      : '<span class="ci-muted">Join an organization to share a reading.</span>')
    + '<button class="btn ghost cs-delete" data-cs-delete="' + index + '">Delete</button>'
    + '</div></li>';
}

/* The list, plus what sharing means, plus what is never shared.
 *
 * The last paragraph is the one that matters most: a parent deciding this needs to know the
 * report document stays with them, because "share my child's DXA results" and "hand the club a PDF
 * with my child's name and date of birth on it" are very different decisions.
 */
function csMarkup(rows, teamName) {
  const shared = rows.filter(r => r.sharedWithTeamId).length;
  return '<section class="bi-reference cs-section"><div class="bi-section-head">'
    + '<div><span class="bi-eyebrow">IMPORTED MEASUREMENTS</span><h2>Measured somewhere else</h2></div>'
    + '<span>' + (rows.length ? rows.length + (rows.length === 1 ? ' reading' : ' readings') + (shared ? ' · ' + shared + ' shared' : '') : 'None yet') + '</span></div>'
    + '<p class="bi-muted">Clinic scans, analyser printouts and device histories you brought in. Parent Playbook did not measure these '
    + 'and makes no accuracy claim about them — they are shown as what their source said it did.</p>'
    + (rows.length
      ? '<ul class="cs-list">' + rows.map((row, i) => csRow(row, i, teamName)).join('') + '</ul>'
      : '<div class="bi-empty">Nothing imported yet. Use <strong>Import a measurement</strong> above to add a clinic result, a spreadsheet from a scale, or a report you type in.</div>')
    + (rows.length && teamName
      ? '<p class="bi-muted cs-what-sharing-means"><strong>What sharing does.</strong> ' + esc(teamName) + ' can read the numbers in a shared reading and nothing else. '
        + 'They cannot change it, cannot keep a copy, and lose access the moment you stop sharing. '
        + 'The report or file it came from is never shared — that stays with you, because it carries your child’s name and date of birth and the numbers do not.</p>'
      : '')
    + '</section>';
}

/* ------------------------------------------------------------------ wiring */

async function renderCompositionSharing(host, { athleteId, team, onChange }) {
  const { createExternalCompositionStore } = await import('/js/composition-import-supabase.mjs');
  const store = createExternalCompositionStore(sb, { scope: 'child_athlete', athleteId, subjectReference: athleteId });
  let rows = [];

  const say = text => { const node = host.querySelector('#csMessage'); if (node) node.textContent = text; };

  const draw = () => {
    host.innerHTML = csMarkup(rows, team?.name || null) + '<p id="csMessage" class="bi-muted" role="status"></p>';
    host.querySelectorAll('[data-cs-share]').forEach(button => {
      button.onclick = async () => {
        const row = rows[Number(button.dataset.csShare)];
        if (!row || !team) return;
        button.disabled = true;
        say(row.sharedWithTeamId ? 'Stopping…' : 'Sharing…');
        try {
          if (row.sharedWithTeamId) await store.unshare(row.id);
          else await store.share(row.id, team.id);
          await load();
          say(row.sharedWithTeamId ? 'Stopped sharing. ' + (team.name) + ' can no longer see that reading.' : 'Shared with ' + team.name + '.');
          onChange?.();
        } catch (error) { button.disabled = false; say(error.message || 'That could not be changed.'); }
      };
    });
    host.querySelectorAll('[data-cs-delete]').forEach(button => {
      button.onclick = async () => {
        const row = rows[Number(button.dataset.csDelete)];
        if (!row) return;
        // Deleting takes the stored report with it, by trigger. Saying so beforehand matters:
        // the document may be the only copy the family has.
        if (!confirm('Delete this reading? If a report is attached to it, that document is deleted too. This cannot be undone.')) return;
        button.disabled = true;
        say('Deleting…');
        try { await store.remove(row.id); await load(); say('Deleted.'); onChange?.(); }
        catch (error) { button.disabled = false; say(error.message || 'That could not be deleted.'); }
      };
    });
  };

  const load = async () => { rows = await store.list(); draw(); };
  await load();
  return { reload: load };
}
