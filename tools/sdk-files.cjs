// Explicit release allowlist. Never traverse the repository to collect SDK files.
const SDK_FILES = Object.freeze([
  'body-section-worker.js','mesh-section.js','surface-section.js','body-surface-report.mjs','body-surface-repeat.mjs','body-sdk-report.mjs','body-sdk-record.mjs','body-sdk-supabase.mjs','body-sdk-reference-import.mjs','body-sdk-reference-supabase.mjs','body-sdk-reference-history.mjs','body-composition-contract.mjs','body-composition-validation.mjs','body-composition-record.mjs','body-composition-supabase.mjs',
  'body-sdk.mjs','body-sdk-worker.js','body-sdk-surface.mjs','surface-review.mjs',
  'surface-worker.js','visual-hull.js','body-outputs.js','photo-identity.js',
  'photo-quality.js','pose-measure.js','photo-import.mjs','photo-import-worker.js','heic-decode.js',
]);
const BUNDLE_FILES = Object.freeze([
  ...SDK_FILES.map(name=>'js/'+name),
  'tools/sdk-demo.cjs','tools/sdk-demo.html','tools/sdk-demo.mjs','company-persistence-demo.html','tools/company-persistence-demo.mjs',
  'tools/sdk-files.cjs','tools/sdk-verify.cjs','supabase/migrations/20260910001500_company_body_assessments.sql','supabase/migrations/20260910033000_company_adult_reference_assessments.sql','supabase/migrations/20260910190000_company_composition_results.sql','BODY-SDK.md','HEIC-IMPORT.md','README.md',
]);
module.exports={SDK_FILES,BUNDLE_FILES};
