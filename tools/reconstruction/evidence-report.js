// Self-contained, script-free presentation evidence. Study results are generated
// by the local worker; capability progress comes from the fixed repository rubric.
(function(root){
  'use strict';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const value=n=>Number.isFinite(n)?n.toFixed(2)+' cm':'—';
  function render(study,progress,{synthetic=false}={}){
    if(study?.schema!=='PP_SURFACE_REFERENCE_STUDY_V1'||!Array.isArray(study.rows)||!Array.isArray(study.methodGroups))throw Error('A computed reference report is required.');
    const categories=progress?.categories;
    if(!Array.isArray(categories)||!categories.length||categories.some(c=>!Number.isFinite(c.weight)||c.weight<=0||![0,.25,.5,.75,1].includes(c.stage))||categories.reduce((s,c)=>s+c.weight,0)!==100)throw Error('The parity rubric is unavailable or invalid.');
    const percent=categories.reduce((s,c)=>s+c.weight*c.stage,0);
    return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Parent Playbook — Evidence brief</title><style>'+ 
      'body{font:16px system-ui;color:#16382e;max-width:1100px;margin:36px auto;padding:0 22px;line-height:1.5}h1{font-size:36px;line-height:1.15}h2{margin-top:32px}p{max-width:900px}.banner{padding:18px;border:2px solid #966b1f;background:#fff4d9}.stats{display:flex;gap:22px;flex-wrap:wrap}.stat{background:#edf5ef;padding:18px;flex:1;min-width:180px}.stat strong{display:block;font-size:32px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;border-bottom:1px solid #bdcdc2;padding:10px;vertical-align:top}.scroll{overflow:auto}small{display:block}code{overflow-wrap:anywhere}li{margin:8px 0}@media print{body{margin:0;font-size:11pt}h2{break-after:avoid}tr,.stat{break-inside:avoid}.scroll{overflow:visible}table{font-size:9pt}.banner{background:white}}'+
      '</style><p>PARENT PLAYBOOK / PRESENTATION EVIDENCE</p><h1>What we can demonstrate today</h1><div class="banner"><strong>'+ 
      (synthetic?'SYNTHETIC FIXTURE — no person was scanned':'LOCAL EXPERIMENT — operator-supplied reference observations')+
      '</strong><p>This brief is not an accuracy certification. No FITMATCH-equivalent reconstruction, body composition or validated anatomical circumference claim is supported by this report.</p></div>'+ 
      '<p>Generated '+esc(study.createdAt)+'. Capability rubric updated '+esc(progress.updated)+'. This report is a snapshot; it does not change the completion score.</p>'+ 
      '<div class="stats"><div class="stat"><strong>'+esc(percent.toFixed(1))+'%</strong>Estimated overall FITMATCH parity</div><div class="stat"><strong>'+esc(study.summary.computed)+' / '+esc(study.summary.attempted)+'</strong>Computed reference observations</div><div class="stat"><strong>'+esc(study.summary.submittedParticipantCodes)+'</strong>Operator-supplied participant codes</div></div>'+ 
      '<h2>Reference procedure and results</h2><p><strong>'+esc(study.location)+'</strong><br>'+esc(study.procedure)+'</p><p>'+esc(study.declaration)+'</p>'+ 
      '<div class="scroll"><table><thead><tr><th>Method</th><th>Computed / attempted</th><th>Participant codes with results</th><th>Mean signed error</th><th>Mean absolute error</th><th>Maximum absolute error</th></tr></thead><tbody>'+ 
      study.methodGroups.map(g=>'<tr><td>'+esc(g.id)+'<small>Grid '+esc(g.resolution)+'</small></td><td>'+esc(g.computed)+' / '+esc(g.attempted)+'</td><td>'+esc(g.participantsWithResults)+'</td><td>'+value(g.meanSignedErrorCm)+'</td><td>'+value(g.meanAbsoluteErrorCm)+'</td><td>'+value(g.maximumAbsoluteErrorCm)+'</td></tr>').join('')+
      '</tbody></table></div><p>Signed error is surface minus tape. These descriptive statistics are grouped by method, model, compute delegate and resolution. Multiple scans do not imply multiple people. Rejected observations are listed below and excluded from error averages.</p>'+ 
      '<div class="scroll"><table><thead><tr><th>Scan / participant code</th><th>Floor level</th><th>Tape</th><th>Surface</th><th>Signed error / rejection</th></tr></thead><tbody>'+ 
      study.rows.map(r=>'<tr><td>'+esc(r.id)+' / '+esc(r.participantCode)+'</td><td>'+value(r.planeCm)+'</td><td>'+value(r.referenceCm)+'</td><td>'+value(r.surfacePerimeterCm)+'</td><td>'+esc(r.status==='computed'?value(r.signedErrorCm):r.reason)+'</td></tr>').join('')+
      '</tbody></table></div><h2>Capability evidence and remaining work</h2><p>'+esc(progress.method)+'</p><div class="scroll"><table><thead><tr><th>Capability</th><th>Stage</th><th>Recorded evidence / remaining limits</th></tr></thead><tbody>'+ 
      categories.map(c=>'<tr><td>'+esc(c.id)+' · '+esc(c.name)+'</td><td>'+esc(c.stage*100)+'%</td><td>'+esc(c.evidence)+'</td></tr>').join('')+
      '</tbody></table></div><h2>Limits of this evidence</h2><ul>'+study.limitations.map(s=>'<li>'+esc(s)+'</li>').join('')+
      '</ul><h2>Source traceability</h2><p>Fingerprints match local mesh files; they do not authenticate capture history or ownership. Geometry and photos are not embedded in this brief. Treat participant codes and measurements as sensitive derived data.</p>'+ 
      study.methodGroups.map(g=>'<p><strong>'+esc(g.id)+'</strong><br>'+g.models.map(m=>esc(m.view)+': '+esc(m.model)+' / '+esc(m.delegate)).join('<br>')+'</p>').join('')+
      study.rows.filter(r=>r.meshSha256).map(r=>'<p>'+esc(r.id)+' · '+esc(r.methodGroup)+'<br><code>'+esc(r.meshSha256)+'</code></p>').join('')+
      '</html>';
  }
  if(typeof module==='object'&&module.exports)module.exports={render};else root.EvidenceReport={render};
})(globalThis);
