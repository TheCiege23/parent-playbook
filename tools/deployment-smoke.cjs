#!/usr/bin/env node
'use strict';

const EXPECTED_CACHE = 'pp-v91';
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
];
const forbidden = [
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

async function run(baseValue) {
  const base = normalizeBase(baseValue);
  const checks = [];
  for (const [pathname, token] of required) {
    try {
      const { response, body } = await request(base, pathname);
      const ok = response.status === 200 && token.test(body);
      checks.push({ pathname, expectation: 'required', status: response.status, ok });
    } catch (error) {
      checks.push({ pathname, expectation: 'required', status: null, ok: false, error: error.message });
    }
  }
  for (const pathname of forbidden) {
    try {
      const { response } = await request(base, pathname);
      checks.push({ pathname, expectation: 'not-public', status: response.status, ok: response.status === 404 });
    } catch (error) {
      checks.push({ pathname, expectation: 'not-public', status: null, ok: false, error: error.message });
    }
  }
  return { schema: 'PP_DEPLOYMENT_SMOKE_V1', base: base.origin, expectedCache: EXPECTED_CACHE, ok: checks.every(row => row.ok), checks };
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

module.exports = { EXPECTED_CACHE, normalizeBase, run };
