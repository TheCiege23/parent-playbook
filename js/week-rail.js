// ===================================================================
//  THE RIGHT RAIL — context you didn't ask for but will read
// ===================================================================
// Desktop handoff. Two columns, never three: the left column is identical at every
// width and this folds underneath below 1180. Deliberately NOT a dashboard — a parent
// marks Thursday done on a phone in a driveway, not at a desk — so the rail carries
// three things worth a glance and nothing else.
//
// It is populated AFTER the week renders and is never awaited by it. The week is the
// product; the rail is furniture, and furniture must not delay the product or break it
// when one of its queries fails. Every section fills itself or says plainly that it is
// empty: a rail stuck on three spinners is worse than one admitting it has nothing.

function railSkeleton(){
  return H`<aside class="col-rail" id="weekRail" aria-label="At a glance">
    <div class="rail-card"><div class="k">Working toward</div>
      <div class="rail-empty" id="railGoal">…</div></div>
    <div class="rail-card"><div class="k">Next game</div>
      <div class="rail-empty" id="railGame">…</div></div>
    <div class="rail-card"><div class="k">Who can see ${esc(state.active.first_name)}</div>
      <div class="rail-empty" id="railWho">…</div></div>
  </aside>`;
}

async function fillWeekRail(a, goals, days, todayIdx){
  const rail = $("#weekRail");
  if(!rail) return;
  const set = (id, html) => { const el = $('#' + id); if(el) el.innerHTML = html; };

  // ---- 1. the active goal, and the one number that evidences it ----
  const lead = (goals || []).filter(g => g.status === 'active')[0] || null;
  if(!lead){
    set('railGoal', H`No goal set yet. <b>Growth</b> is where you pick one, and the week
      starts building around it.`);
  } else {
    const key = (typeof GOAL_METRIC !== 'undefined') ? GOAL_METRIC[lead.key] : null;
    // An unmapped goal shows its label alone rather than an unrelated number. Confidence
    // and game IQ have no honest measurement, and inventing one would be worse than none.
    set('railGoal', H`<h4>${esc(lead.label)}</h4>
      <div class="sub" id="railGoalNum">${key ? '…'
        : "Not a number — you'll see this one on the field before you see it here."}</div>`);
    if(key){
      try{
        const { data } = await sb.from('measurements').select('value,unit,measured_on')
          .eq('athlete_id', a.id).eq('metric_key', key)
          .order('measured_on', { ascending: false }).limit(5);
        const mm = (typeof metricMeta === 'function') ? (metricMeta(key) || {}) : {};
        const label = (typeof metricName === 'function') ? metricName(key) : key;
        if(data && data.length){
          const latest = data[0];
          // Reuses the Growth screen's own bars, including its lower-is-better inversion.
          const bars = (typeof trendBars === 'function') ? trendBars(data, mm.lower_is_better) : '';
          set('railGoalNum', H`<b style="font-family:'Archivo',sans-serif;font-size:19px;color:var(--ink)">
              ${esc(String(Math.round(Number(latest.value) * 100) / 100))}${esc(mm.unit || '')}</b>
            <span style="display:block;margin-top:2px">${esc(label)}</span>${bars}`);
        } else {
          set('railGoalNum', H`No ${esc(label.toLowerCase())} recorded yet — one reading
            gives you a starting line.`);
        }
      }catch(e){ console.error(e); set('railGoalNum', 'Could not load that.'); }
    }
  }

  // ---- 2. the next game. Read off the week already built — no new query. ----
  let gi = -1;
  for(let n = 0; n < 7; n++){
    const i = (todayIdx + n) % 7;
    if(days[i] && days[i].t === 'game'){ gi = i; break; }
  }
  if(gi < 0){
    set('railGame', 'Nothing on the calendar this week.');
  } else {
    const iso = dateForDayIndex(gi);
    const when = new Date(iso + 'T00:00:00');
    const label = when.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    set('railGame', H`<h4>${esc(label)}</h4>
      <div class="sub">${esc(days[gi].title || 'Game day')}</div>
      <button class="btn sm ghost" id="railIcs" style="margin-top:10px">Add to calendar</button>`);
    const b = $("#railIcs");
    if(b) b.onclick = () => downloadGameIcs(a, days[gi], iso);
  }

  // ---- 3. who can see this athlete ----
  try{
    const [{ data: acc }, { data: ath }] = await Promise.all([
      sb.from('athlete_access').select('guardian_id,role').eq('athlete_id', a.id).is('revoked_at', null),
      sb.from('athletes').select('family_id').eq('id', a.id).maybeSingle(),
    ]);
    let people = [];
    if(ath && ath.family_id){
      const { data: mem } = await sb.from('family_members')
        .select('guardian_id,role').eq('family_id', ath.family_id);
      people = (mem || []).map(m => ({ id: m.guardian_id, role: m.role }));
    }
    // The household is the stronger claim, so it wins on a duplicate — the same rule
    // loadRole() applies, and the reason an owner who accepted an invite to their own
    // child is not listed here as family view.
    for(const r of (acc || [])){
      if(!people.some(p => p.id === r.guardian_id)) people.push({ id: r.guardian_id, role: r.role });
    }

    const ids = people.map(p => p.id);
    const names = {};
    if(ids.length){
      const { data: g } = await sb.from('guardians').select('id,display_name').in('id', ids);
      (g || []).forEach(x => { names[x.id] = (x.display_name || '').trim(); });
    }
    const LABEL = { owner: 'Owner · full control', co_parent: 'Co-parent · can edit',
                    family_view: 'Family view · can look' };

    set('railWho', people.length
      ? people.map(p => {
          const you = p.id === state.user.id;
          const nm = names[p.id] || (you ? 'You' : 'Invited');
          return H`<div class="rail-who">
            <div class="av" style="background:${you ? 'var(--pine-900)' : '#E3EDE8'};
              color:${you ? 'var(--paper)' : 'var(--green-d)'}">${esc((nm[0] || '?').toUpperCase())}</div>
            <div style="min-width:0"><b>${esc(nm)}${you ? ' (you)' : ''}</b>
              <span>${esc(LABEL[p.role] || p.role)}</span></div></div>`;
        }).join('')
        + (state.canEdit
          ? H`<button class="btn sm ghost" id="railInvite" style="margin-top:10px">＋ Invite someone</button>`
          : '')
      : H`Only you.${state.canEdit ? ' Invite a co-parent or a grandparent from Profile.' : ''}`);
    const inv = $("#railInvite");
    if(inv) inv.onclick = () => renderApp('profile');
  }catch(e){
    console.error(e);
    set('railWho', 'Could not load that.');
  }
}

// A single-event .ics the phone's own calendar opens. Not a calendar integration:
// no OAuth, no third party, and no permission a parent has to think about. An all-day
// event because the plan stores a game DAY, not a kick-off time — inventing 10:00
// would put a wrong alarm on someone's phone.
function downloadGameIcs(a, day, isoDate){
  const stamp = isoDate.replace(/-/g, '');
  const esc2 = s => String(s || '').replace(/([,;\\])/g, '\\$1');
  const title = (a.first_name ? a.first_name + ' — ' : '') + (day.title || 'Game day');
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Parent Playbook//EN', 'BEGIN:VEVENT',
    'UID:pp-' + a.id + '-' + stamp + '@playbookbp.com',
    'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z',
    'DTSTART;VALUE=DATE:' + stamp,
    'DTEND;VALUE=DATE:' + stamp,
    'SUMMARY:' + esc2(title),
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = (a.first_name || 'game') + '-' + isoDate + '.ics';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
