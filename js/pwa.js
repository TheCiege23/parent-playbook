if('serviceWorker' in navigator){ window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{})); }

// ---- Add to Home Screen (install without an app store) ----
(function(){
  var KEY='pp_a2hs_dismissed';
  var el=document.getElementById('a2hs'); if(!el) return;
  var go=document.getElementById('a2hsGo'), x=document.getElementById('a2hsX'),
      sub=document.getElementById('a2hsSub'), steps=document.getElementById('a2hsSteps');
  var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone===true;
  var dismissed=false; try{ dismissed=localStorage.getItem(KEY)==='1'; }catch(e){}
  if(standalone || dismissed) return;
  function show(){ el.classList.add('show'); }
  function hide(persist){ el.classList.remove('show'); if(persist){ try{localStorage.setItem(KEY,'1');}catch(e){} } }
  x.onclick=function(){ hide(true); };
  var deferred=null;
  window.addEventListener('beforeinstallprompt', function(e){
    e.preventDefault(); deferred=e; go.hidden=false; steps.hidden=true;
    sub.textContent='One-tap access — no app store needed'; show();
  });
  window.addEventListener('appinstalled', function(){ hide(true); });
  go.onclick=async function(){
    if(!deferred) return;
    deferred.prompt();
    try{ await deferred.userChoice; }catch(e){}
    deferred=null; hide(true);
  };
  // iOS Safari can't prompt — show the manual Share → Add to Home Screen steps
  var ua=navigator.userAgent||'';
  var isIOS=/iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  var isSafari=/^((?!chrome|crios|fxios|edgios|android).)*safari/i.test(ua);
  if(isIOS && isSafari){
    go.hidden=true;
    sub.textContent='Keep it one tap away on your phone';
    steps.hidden=false;
    steps.innerHTML='Tap the <b>Share</b> button <svg class="shr" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#2F6FB0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M8 8l4-4 4 4M4 14v4a2 2 0 002 2h12a2 2 0 002-2v-4"/></svg>, then <b>“Add to Home Screen.”</b>';
    setTimeout(show, 1400);
  }
})();
