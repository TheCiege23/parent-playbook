// ===================================================================
//  ERROR MONITORING
//  75 console.error call sites reported to nobody. A parent hits a bug,
//  sees a friendly message, and quietly leaves — and we never find out.
//  That is how the "check your inbox" signup bug survived to production.
//
//  This app stores data about children, so the reporting is deliberately
//  narrower than a normal Sentry install:
//
//    · NO session replay        — it would record a screen showing a
//                                 child's name, birthdate and photos.
//    · NO PII                   — sendDefaultPii stays off; we never
//                                 attach the parent's email or the
//                                 child's name to an event.
//    · NO console breadcrumbs   — console.error(err) frequently carries
//                                 row data straight out of the database.
//    · Network breadcrumbs are  — query strings can carry ids and, on
//      stripped to path only      some endpoints, names.
//    · A last-pass scrub redacts anything that still looks like an
//      email address or a bearer token before the event leaves.
//
//  What we DO get: the error, the stack, the file, and the browser.
//  That is enough to fix a bug and nothing more than is needed to.
// ===================================================================

// Uses Sentry's Loader Script (the recommended setup for an app with no build step).
// The loader carries the DSN in its own URL — see index.html — so there is no key to
// keep in sync here. This file must load BEFORE the loader: the loader calls
// window.sentryOnLoad if we have defined it, and that is our only chance to configure
// the SDK. If the loader never arrives, nothing here runs and the app is unaffected.
(function initMonitoring(){
  // Don't report from local development — it's noise, and it burns quota.
  const host = location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');

  const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/gi;
  const TOKEN = /(bearer\s+|apikey=|access_token=|refresh_token=)[\w.\-]+/gi;
  const scrub = s => (typeof s === 'string'
    ? s.replace(EMAIL, '[email]').replace(TOKEN, '$1[redacted]')
    : s);

  // Walk a value and scrub every string in it, depth-capped so a cyclic or huge
  // object can't hang the reporter.
  function deepScrub(v, depth){
    if(depth > 4 || v == null) return v;
    if(typeof v === 'string') return scrub(v);
    if(Array.isArray(v)) return v.map(x => deepScrub(x, depth+1));
    if(typeof v === 'object'){
      const out = {};
      for(const k of Object.keys(v)) out[k] = deepScrub(v[k], depth+1);
      return out;
    }
    return v;
  }

  // The loader invokes this once the SDK is on the page, before flushing any errors it
  // buffered during load. Everything below is the ONLY configuration the SDK gets.
  window.sentryOnLoad = function(){
    try{
    Sentry.init({
      environment: 'production',
      enabled: !isLocal,
      // Errors only. No tracing, no profiling, no replay — see the header.
      tracesSampleRate: 0,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
      sendDefaultPii: false,
      // Explicit collection controls (SDK 10+). These stop the data being GATHERED;
      // beforeSend below is the second line of defence for anything that slips past.
      // Every one of these defaults to ON, which is wrong for an app holding data
      // about children — each line below is switching something off, not tuning it.
      dataCollection: {
        userInfo: false,        // default true — would attach id/email/ip
        cookies: false,         // default true
        httpHeaders: false,     // default true, request AND response
        urlQueryParams: false,  // default true — ids and grant types live here
        // Default collects ALL FOUR of incoming/outgoing request/response bodies.
        // The onboarding POST body is literally the child's name and birthdate.
        httpBodies: [],
        // Default true: captures local variables into stack frames. An error thrown
        // inside finishOnboarding would carry the whole athlete object with it.
        stackFrameVariables: false,
      },
      // Drop replay and tracing entirely. Breadcrumbs are KEPT — knowing what happened
      // in the seconds before an error is most of their debugging value — but they are
      // filtered hard in beforeBreadcrumb below rather than removed wholesale.
      integrations: (defaults) =>
        defaults.filter(i => i.name !== 'Replay' && i.name !== 'BrowserTracing'),
      // Extensions, injected scripts and offline noise we can neither see nor fix.
      ignoreErrors: [
        'ResizeObserver loop limit exceeded',
        'ResizeObserver loop completed with undelivered notifications',
        'Non-Error promise rejection captured',
        'Failed to fetch',
        'NetworkError when attempting to fetch resource',
        'Load failed',
        'AbortError',
      ],
      denyUrls: [/extensions\//i, /^chrome:\/\//i, /^moz-extension:\/\//i],

      beforeBreadcrumb(crumb){
        if(!crumb) return null;
        // Console output is the most likely place for a child's name to leak.
        if(crumb.category === 'console') return null;
        // UI breadcrumbs record what was clicked or typed into. A button or field can
        // be labelled with the child's name, so drop them rather than reason about it.
        if(typeof crumb.category === 'string' && crumb.category.indexOf('ui.') === 0) return null;
        // Keep the fact that a request happened and how it went; drop the query
        // string, which can carry identifiers.
        if(crumb.category === 'fetch' || crumb.category === 'xhr'){
          const url = crumb.data && crumb.data.url;
          if(typeof url === 'string'){
            try{ const u = new URL(url, location.origin); crumb.data.url = u.origin + u.pathname; }
            catch(e){ crumb.data.url = '[url]'; }
          }
        }
        crumb.message = scrub(crumb.message);
        return crumb;
      },

      beforeSend(event){
        try{
          // Never identify the parent or the child.
          delete event.user;
          if(event.request){
            delete event.request.cookies;
            delete event.request.headers;
            if(typeof event.request.url === 'string'){
              try{ const u = new URL(event.request.url); event.request.url = u.origin + u.pathname; }
              catch(e){ /* leave it */ }
            }
            delete event.request.query_string;
            delete event.request.data;
          }
          if(event.message) event.message = scrub(event.message);
          if(event.exception && event.exception.values){
            event.exception.values.forEach(v => { if(v.value) v.value = scrub(v.value); });
          }
          if(event.extra)   event.extra   = deepScrub(event.extra, 0);
          if(event.contexts) event.contexts = deepScrub(event.contexts, 0);
        }catch(e){ /* a reporter that throws must never break the app */ }
        return event;
      },
    });
    }catch(e){ /* monitoring is best-effort, never fatal */ }
  };
})();

// Report a handled error without surfacing anything to the parent. Use this where
// the app already shows its own friendly message but we still want to know.
function reportError(err, where){
  try{
    if(typeof Sentry === 'undefined' || !Sentry.captureException) return;
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)), {
      tags: where ? { where } : undefined,
    });
  }catch(e){ /* never throw from the reporter */ }
}
