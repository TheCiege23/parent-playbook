// ===================================================================
//  LANDING PAGE — marketing shell in front of the SPA
// ===================================================================
// The landing page and the app share one URL (see the routing note in the design
// handoff): an installed phone has start_url:"/" baked into the manifest it cached
// at install time, so moving the app to /app would make every existing home-screen
// icon open the marketing page. Instead both live in index.html and the app boots
// on demand.
//
// Nothing above the fold depends on this file. If it never loads, the page still
// renders and reads correctly — only the CTAs stop working.

(function(){
  var landing = document.getElementById('landing');
  var root    = document.getElementById('root');

  // ---- boot the app ----
  var booted = false;
  function enterApp(mode){
    if(booted){ if(mode==='signup' && typeof renderAuth==='function' && !state.user) renderAuth('signup'); return; }
    booted = true;
    if(landing) landing.hidden = true;
    if(root) root.hidden = false;
    document.body.classList.add('in-app');
    document.documentElement.classList.add('pp-boot');
    // Keep a real tab hash if there is one — overwriting /#journey with '#app' is what
    // broke deep links. Only stamp '#app' when the URL carries nothing useful.
    if(APP_HASHES.indexOf(location.hash) === -1){
      try{ history.pushState({app:1},'','#app'); }catch(e){}
    }
    if(typeof initInstallBanner==='function') initInstallBanner();
    if(typeof handleStripeReturn==='function') handleStripeReturn();
    if(typeof boot==='function') boot(mode);
  }
  window.enterApp = enterApp;

  // ---- who skips the marketing page ----
  // Installed users, anyone already signed in, and anyone arriving on a link that
  // only means something inside the app.
  function isInstalledMode(){
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
        || navigator.standalone === true;
  }
  // Every in-app tab, not just '#app'. Without the rest of these, opening
  // /#journey while signed in fell through to hasStoredSession(), and enterApp then
  // REPLACED the hash with '#app' — so #journey and #profile both silently landed on
  // the week screen. Deep links to a tab are the most natural thing to paste.
  var APP_HASHES = ['#app','#week','#growth','#journey','#profile','#account','#activity'];
  function isAppLink(){
    var h = location.hash || '', s = location.search || '';
    return APP_HASHES.indexOf(h) !== -1
        || h.indexOf('type=recovery') !== -1
        || h.indexOf('access_token=') !== -1     // Supabase drops its auth hash here
        || s.indexOf('invite=') !== -1
        || s.indexOf('source=pwa') !== -1        // the manifest's start_url
        || s.indexOf('paid=') !== -1 || s.indexOf('paycancel=') !== -1 || s.indexOf('stripe=') !== -1
        // A direct sign-in entry point for someone who isn't converting off THIS page's
        // own CTAs — e.g. coaches.html's "Already connected? Log in", where the visitor
        // already has an account and the marketing pitch below would just be in the way.
        || s.indexOf('login=1') !== -1;
  }
  // A synchronous guess at "is there a session" so a returning parent never sees a
  // flash of marketing. Supabase keeps its session under sb-<ref>-auth-token; the
  // real check still happens in boot(), this only decides what to paint first.
  function hasStoredSession(){
    try{
      for(var i=0;i<localStorage.length;i++){
        var k=localStorage.key(i);
        if(k && k.indexOf('sb-')===0 && k.indexOf('-auth-token')!==-1 && localStorage.getItem(k)) return true;
      }
    }catch(e){}
    return false;
  }
  if(isInstalledMode() || isAppLink() || hasStoredSession()){ enterApp(); return; }

  // ---- CTAs ----
  // Every conversion action on this page lands on signup, not login.
  document.querySelectorAll('[data-start]').forEach(function(el){
    el.addEventListener('click', function(e){ e.preventDefault(); enterApp('signup'); });
  });
  document.querySelectorAll('[data-login]').forEach(function(el){
    el.addEventListener('click', function(e){ e.preventDefault(); enterApp('login'); });
  });

  // ---- smooth scroll (sections carry scroll-margin-top for the fixed header) ----
  document.querySelectorAll('[data-scroll]').forEach(function(el){
    el.addEventListener('click', function(e){
      var t = document.querySelector(el.getAttribute('data-scroll'));
      if(!t) return;
      e.preventDefault();
      t.scrollIntoView({ behavior:'smooth', block:'start' });
    });
  });

  // ---- FAQ accordion ----
  // Single-open, first item open, clicking the open item closes it. Answers stay in
  // the DOM (collapsed with max-height) so they remain indexable and match the
  // FAQPage structured data in the head.
  var qs = Array.prototype.slice.call(document.querySelectorAll('.lp-q'));
  qs.forEach(function(q, i){
    var btn = q.querySelector('button');
    var panel = q.querySelector('.lp-a');
    if(!btn || !panel) return;
    btn.addEventListener('click', function(){
      var open = q.getAttribute('data-open') === '1';
      qs.forEach(function(o){
        o.setAttribute('data-open','0');
        o.querySelector('button').setAttribute('aria-expanded','false');
        o.querySelector('.lp-a').setAttribute('aria-hidden','true');
      });
      if(!open){
        q.setAttribute('data-open','1');
        btn.setAttribute('aria-expanded','true');
        panel.setAttribute('aria-hidden','false');
      }
    });
  });

  // ---- install prompt ----
  // Chrome fires beforeinstallprompt once, early. Stash it so both the landing
  // page's Install button and the in-app banner can use it.
  var installBtn = document.getElementById('lpInstall');
  window.addEventListener('beforeinstallprompt', function(e){
    e.preventDefault();
    window.__ppInstallPrompt = e;
    if(installBtn) installBtn.hidden = false;
  });
  if(installBtn) installBtn.addEventListener('click', async function(){
    var d = window.__ppInstallPrompt;
    if(!d) return;
    d.prompt();
    try{ await d.userChoice; }catch(e){}
    window.__ppInstallPrompt = null;
    installBtn.hidden = true;
  });
  window.addEventListener('appinstalled', function(){
    window.__ppInstallPrompt = null;
    if(installBtn) installBtn.hidden = true;
  });
})();
