#!/usr/bin/env node
'use strict';

const EXPECTED_CACHE = 'pp-v111';
const required = [
  ['/', /Parent Playbook/i],
  ['/sw.js', new RegExp(`const CACHE = ['"]${EXPECTED_CACHE}['"]`)],
  ['/js/org-insights.js', /openOrgReferenceAssessment/],
  ['/js/body-sdk-record.mjs', /PP_COMPANY_BODY_ASSESSMENT_V1/],
  ['/js/body-sdk-report.mjs', /summarizeMeasurementResult/],
  ['/js/body-sdk-supabase.mjs', /company_body_assessments/],
  ['/css/body-insights.css', /bi-page/],
  ['/company-sdk-demo', /Company SDK demo/],
  ['/friday-demo', /Body intelligence that stays connected/],
  ['/company-persistence-demo', /company-persistence-demo\.mjs\?v=81/],
  ['/company-persistence-demo.mjs', /createSupabaseCompanyReferenceAdapter/],
  ['/js/body-sdk-reference-supabase.mjs', /company_reference_assessments/],
  ['/js/body-sdk-reference-import.mjs', /parseAdultReferenceExport/],
  ['/js/body-sdk-reference-history.mjs', /compareCompanyAssessmentRecords/],
  ['/company-composition-demo', /Provider not configured/],
  ['/company-composition-demo.mjs', /evaluateCompositionValidationStudy/],
  ['/js/body-composition-contract.mjs', /validateCompositionEstimate/],
  ['/js/body-composition-validation.mjs', /descriptive_not_qualified/],
  ['/js/body-composition-record.mjs', /PP_COMPANY_COMPOSITION_RESULT_V1/],
  ['/js/body-composition-supabase.mjs', /company_composition_results/],
  ['/js/reference-cohorts.js', /const REFERENCE_COHORTS = \[\];/],
  ['/js/reference-cohort.mjs', /EQUIVALENCE_NOT_ESTABLISHED/],
  ['/sdk-demo.mjs', /createBodyScanner/],
  // The PUBLIC signing key must stay reachable. A buyer verifying a signed SDK archive
  // needs it from a route the archive cannot influence, and the repository is private, so
  // this URL IS that route. If it ever stops serving, the instruction printed inside every
  // archive becomes a dead end and the signature stops being checkable by anyone outside.
  ['/SIGNING-KEY.pub.pem', /BEGIN PUBLIC KEY/],
];
const forbidden = [
  // AUDIT.md is named here rather than left to the *.md rule in .dockerignore because it
  // is the one that mattered: it was reachable at playbook.chimaura.com/AUDIT.md, 60-odd KB
  // describing every vulnerability found in this app and how each was fixed, which is a
  // roadmap for anyone probing it. The .vercelignore comment records that it served 200
  // before that file existed. One line of ignore config is now the only thing standing
  // between that file and the public, so the smoke asserts the outcome rather than trusting
  // the config.
  '/AUDIT.md',
  '/BODY-SDK.md',
  '/supabase/migrations/20260910014500_company_body_active_consent_rpc.sql',
  '/supabase/migrations/20260910190000_company_composition_results.sql',
  '/.env.local',
];

function normalizeBase(value) {
  let url;
  try { url = new URL(value); } catch { throw Error('Pass an absolute http(s) deployment URL.'); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw Error('Pass an absolute http(s) deployment URL without credentials, query text or a fragment.');
  }
  url.pathname = url.pathname.replace(/\/+$/, '') + '/';
  return url;
}

async function request(base, pathname) {
  const response = await fetch(new URL(pathname.replace(/^\//, ''), base), {
    redirect: 'manual',
    headers: { 'user-agent': 'ParentPlaybook-Deployment-Smoke/1.0' },
  });
  return { response, body: await response.text() };
}

// A deploy swaps containers, and a request made during the swap can reach the old
// container, the new one, or a half-swapped state. That is what produced a 26/27 run
// against pp-v94 which then passed on every run afterwards: not a regression, a snapshot
// taken too early. A single pass cannot tell those apart, so a failure is not reported
// until it has survived a recheck a few seconds later.
//
// A check that only needed the deploy to settle passes, but says so through
// settledAfterMs, and the result carries a settled count and a note. Letting it pass
// silently would trade one misleading result for another: the point is to be able to
// tell a rollout apart from a regression, not to make rollouts look clean.
const SETTLE_ATTEMPTS = 3;
const SETTLE_DELAY_MS = 2000;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function evaluate(base, item) {
  try {
    const { response, body } = await request(base, item.pathname);
    if (item.expectation === 'required') return { status: response.status, ok: response.status === 200 && item.token.test(body) };
    return { status: response.status, ok: response.status === 404 };
  } catch (error) {
    return { status: null, ok: false, error: error.message };
  }
}

async function run(baseValue) {
  const base = normalizeBase(baseValue);
  // One plan, index-parallel with checks, so a recheck re-runs the same expectation
  // rather than matching a row back by path.
  const plan = [
    ...required.map(([pathname, token]) => ({ pathname, token, expectation: 'required' })),
    ...forbidden.map(pathname => ({ pathname, token: null, expectation: 'not-public' })),
  ];
  const checks = [];
  for (const item of plan) {
    const { status, ok, error } = await evaluate(base, item);
    checks.push({ pathname: item.pathname, expectation: item.expectation, status, ok, ...(error ? { error } : {}) });
  }
  // Recheck only what failed, so a clean run costs exactly what it did before: no delay
  // is waited and no extra request is made unless something is already failing.
  let waitedMs = 0;
  for (let attempt = 1; attempt <= SETTLE_ATTEMPTS && checks.some(row => !row.ok); attempt++) {
    await delay(SETTLE_DELAY_MS);
    waitedMs += SETTLE_DELAY_MS;
    for (let i = 0; i < checks.length; i++) {
      if (checks[i].ok) continue;
      const { status, ok, error } = await evaluate(base, plan[i]);
      checks[i].status = status;
      checks[i].ok = ok;
      if (error) checks[i].error = error; else delete checks[i].error;
      if (ok) checks[i].settledAfterMs = waitedMs;
    }
  }
  const settled = checks.filter(row => row.settledAfterMs).length;
  return {
    schema: 'PP_DEPLOYMENT_SMOKE_V1',
    base: base.origin,
    expectedCache: EXPECTED_CACHE,
    ok: checks.every(row => row.ok),
    settled,
    ...(settled ? { settleNote: settled + ' check(s) failed on the first pass and passed once the deploy settled; this run overlapped a rollout and should be repeated for a clean reading' } : {}),
    checks,
  };
}

if (require.main === module) {
  run(process.argv[2] || 'https://playbookbp.com/').then(result => {
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  }).catch(error => {
    console.error(JSON.stringify({ schema: 'PP_DEPLOYMENT_SMOKE_V1', ok: false, error: error.message }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = { EXPECTED_CACHE, SETTLE_ATTEMPTS, SETTLE_DELAY_MS, normalizeBase, run };
