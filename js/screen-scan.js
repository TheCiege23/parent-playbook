// ===================================================================
//  SCAN — home for both on-device measurements, still tied into Growth
// ===================================================================
// This screen owns nothing new. Both triggers here call the exact same
// openBodyScan()/openJumpScan() the Growth screen used to hold directly, and every
// number either one produces still lands in the same `measurements` table Growth reads
// from — a scan run from here shows up on Growth's trend bars and the growth-read card
// exactly as if it had been started there. What moved is the ENTRY POINT, not the data:
// scanning is important enough to deserve its own tab, but it was never its own feature
// — it's how some of Growth's numbers get filled in, and this screen says so rather than
// pretending otherwise.
async function screenScan(){
  const a = state.active;

  const { data: recent } = await sb.from('measurements')
    .select('metric_key,value,unit,measured_on,source')
    .eq('athlete_id', a.id).in('source', ['photo','video'])
    .order('measured_on', { ascending:false }).limit(6);

  $("#screen").innerHTML = H`
    ${topBar('Body scan & jump measurement')}
    <div class="app-pad" style="padding-top:6px">

      <div class="card app-pad">
        <div class="navrow" id="scanBody" role="button" tabindex="0">
          <div class="gi"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="2" y="8" width="20" height="8" rx="2"/><path d="M6 8v3M10 8v5M14 8v3M18 8v5"/></svg></div>
          <div class="gt"><b>Measure ${esc(a.first_name)} from four photos</b>
            <span>Wingspan, reach, shoulders and leg length. Measured on this phone — the photos are never
              uploaded and never saved.</span></div><i>›</i></div>
      </div>

      <div class="card app-pad" style="margin-top:10px">
        <div class="navrow" id="scanJump" role="button" tabindex="0">
          <div class="gi"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 4v10M12 4l-3.5 3.5M12 4l3.5 3.5"/><path d="M5 20c1.5-3 4-4 7-4s5.5 1 7 4"/></svg></div>
          <div class="gt"><b>Measure ${esc(a.first_name)}'s vertical jump</b>
            <span>About five seconds of video, three jumps. Measured on this phone — the video is never
              uploaded and never saved.</span></div><i>›</i></div>
      </div>

      <p class="muted-note" style="margin-top:10px">Each asks your permission first — a signed, revocable
        release — before the camera opens. Manage or withdraw either from Account.</p>

      <div class="sec-title" style="margin-top:22px">Recent scans</div>
      ${recent && recent.length ? H`
      <div class="card app-pad">
        ${recent.map(r=>H`<div class="mrow">
          <span>${esc(metricName(r.metric_key))} · ${esc(fmtDate(r.measured_on))}</span>
          <b>${esc(fmtMeasure(r.metric_key, r.value, r.unit))}</b></div>`).join('')}
      </div>`
      : H`<p class="empty">Nothing yet — run either above and it shows here, and on Growth with everything
          else.</p>`}

      <div class="navrow" id="scanToGrowth" role="button" tabindex="0" style="margin-top:18px">
        <div class="gi">📈</div>
        <div class="gt"><b>See the full growth read</b>
          <span>Percentile, growth spurt, predicted height and every measurement together.</span></div><i>›</i></div>
    </div>`;
  bindTop();
  { const b=$("#scanBody");
    if(b){ const open=()=>openBodyScan(a);
      b.onclick=open; b.onkeydown=e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); open(); } }; } }
  { const b=$("#scanJump");
    if(b){ const open=()=>openJumpScan(a);
      b.onclick=open; b.onkeydown=e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); open(); } }; } }
  { const b=$("#scanToGrowth"); if(b) b.onclick=()=>renderApp('growth'); }
}
