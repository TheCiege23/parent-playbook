// Portable, self-contained exports. No remote fonts, analytics, media URLs or scripts.
function assessmentDownload(text,type,filename){
  // The iOS / Android app cannot download; saveFile (js/native.js) opens the share sheet there.
  if(typeof saveFile==='function') return saveFile(new Blob([text],{type}),filename);
  const url=URL.createObjectURL(new Blob([text],{type}));
  const link=document.createElement('a');link.href=url;link.download=filename;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function assessmentCSV(rows){
  // Quoting alone does not stop spreadsheet formula execution in textual cells.
  const cell=value=>{
    let text=String(value??'');
    if(typeof value!=='number' && /^[\s]*[=+@\-\t\r]/.test(text)) text="'"+text;
    return '"'+text.replace(/"/g,'""')+'"';
  };
  const header=['measurement_id','athlete_id','recorded_on','metric','value','unit','source','assessment_id','engine','engine_version','model','capture_quality_heuristic','height_input_in','height_recorded_on','recorded_output_dictionary','recorded_side_method','current_photo_definition','measurement_processing_ms','processing_timing_protocol','photo_reuse_protocol'];
  const out=rows.map(r=>{const m=readScanRecord(r);return [r.id,r.athlete_id,r.measured_on,r.metric_key,r.value,r.unit,r.source,m?.id,m?.engine.id,m?.engine.version,m?.engine.model,m?.quality?.score,m?.input_height?.value,m?.input_height?.measured_on,m?.output_dictionary,m?.side_method,r.source==='photo'?BODY_OUTPUTS[r.metric_key]?.definition:'',m?.processing?.duration_ms,m?.processing?.protocol,m?.photo_reuse_check?.protocol];});
  return '\uFEFF'+[header,...out].map(row=>row.map(cell).join(',')).join('\r\n');
}
function assessmentReport(athlete,input,date,baseline){
  const rows=biValidRows(input),current=biSnapshot(rows,date),prior=biSnapshot(rows,baseline||'');
  const section=(title,items)=>`<section><h2>${esc(title)}</h2><table><thead><tr><th>Measurement</th><th>Reading</th><th>Recorded</th><th>Method</th><th>Change</th></tr></thead><tbody>${items.map(r=>`<tr><td>${esc(biName(r.metric_key))}</td><td>${esc(biValue(r))}</td><td>${esc(r.measured_on)}</td><td>${esc(biMethod(r))}</td><td>${esc(biComparison(r,prior.get(r.metric_key)).label)}</td></tr>`).join('')||'<tr><td colspan="5">No recorded measurements in this category.</td></tr>'}</tbody></table></section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Body Insights report</title><style>
  *{box-sizing:border-box}body{font:14px/1.6 system-ui,sans-serif;margin:0;background:#edf1ee;color:#162d29}main{max-width:1000px;margin:32px auto;padding:40px;background:white;border-radius:18px}header{border-bottom:3px solid #257a6b;padding-bottom:22px}h1{font-size:34px;line-height:1.2;margin:12px 0}h2{font-size:19px;margin:28px 0 12px}.brand{font-size:11px;letter-spacing:.14em;font-weight:700;color:#276b60}.muted{color:#5d6d67}table{width:100%;border-collapse:collapse;text-align:left;font-size:12px}th{background:#edf3ef}td,th{padding:12px;border-bottom:1px solid #dce5df;vertical-align:top}aside{background:#eef4f0;padding:20px;border-radius:12px;margin-top:26px}.bi-assessment{border-bottom:1px solid #dce5df;padding:12px 0}.bi-assessment summary{font-weight:700}.bi-assessment-body{font-size:12px;overflow-wrap:anywhere}.bi-section-head span,.bi-muted{color:#5d6d67;font-size:12px}footer{font-size:11px;color:#5d6d67;margin-top:26px}@media(max-width:700px){main{margin:0;padding:20px;border-radius:0}td,th{padding:7px;font-size:11px}h1{font-size:28px}}@media print{body{background:white}main{margin:0;padding:0;max-width:none;border-radius:0}.print-hint{display:none}thead{display:table-header-group}tr,.bi-assessment{break-inside:avoid}aside{break-inside:avoid}@page{margin:16mm}}
  </style></head><body><main><header><div class="brand">PARENT PLAYBOOK / BODY INSIGHTS</div><h1>${esc(athlete.first_name||'Athlete')}'s assessment report</h1><p>Latest readings through <b>${esc(date||'today')}</b>${baseline?` · comparison through <b>${esc(baseline)}</b>`:' · no comparison selected'}</p><p class="muted">Each reading retains its own recording date. These values may come from different sessions. A body measurement change is not a performance grade.</p></header>
  ${section('Body measurements',[...current.values()].filter(r=>BI_BODY.includes(r.metric_key)))}
  ${section('Movement & other measurements',[...current.values()].filter(r=>!BI_BODY.includes(r.metric_key)))}
  ${biSidePairs(rows,date)}
  ${biOutputDefinitions([...current.values()]).replaceAll('<details ','<details open ')}
  ${biAssessments(rows.filter(r=>r.measured_on<=date)).replaceAll('<details ','<details open ')}
  <aside><b>How to read this report</b><p>Photo measurements are estimates scaled to a recorded height. Video results depend on the test and recording conditions. Capture-quality scores are heuristics, not accuracy percentages. Comparisons exclude different units, methods and incompatible recorded engine versions.</p><p>This photo assessment does not generate a saved 3D body, circumferences, body composition, PHV or maturity offset. The separate Growth estimate requires manual measurements. Neither workflow diagnoses an injury or determines athletic potential.</p></aside>
  <footer>Generated ${esc(new Date().toISOString())}. This report contains private athlete information. Share it only with intended recipients.<p class="print-hint">To save as PDF, use your browser's Print command and choose Save as PDF.</p></footer></main></body></html>`;
}
