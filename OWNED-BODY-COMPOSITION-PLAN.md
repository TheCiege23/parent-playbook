# Owned body-composition system plan

Updated: 2026-09-11

## Goal

Build an independently operable body-composition capability without a photo-estimation vendor. The
first product will combine user-authorized external measurements with an owned statistical model
trained on public-use NHANES DXA data. Keep the existing provider boundary so a future licensed or
buyer-supplied model can be added without changing the product or database again.

This does not create image-derived body composition. The owned model uses entered age, height,
weight and any accepted optional measurements. Its outputs must be described as population-based,
informational estimates until a separate intended-population study supports stronger language.

## Product decisions

1. Release imported measurements before releasing an estimate.
2. Keep reference measurements and model estimates as different record types.
3. Start model development with adults. Permit youth reference imports with guardian consent, but
   do not release youth estimates until youth-specific holdout and independent evidence pass.
4. Initial model outputs are body-fat percentage, fat mass and lean mass. Add bone mineral content
   only if the selected NHANES cycles support it consistently. Do not call DXA lean mass skeletal
   muscle mass.
5. Use race and ethnicity for evaluation, not as product inputs.
6. Never use an estimate for diagnosis, eligibility, team selection, athletic-potential ranking,
   weight-loss targets or automatic training prescriptions.
7. Compare trends only when method, device/provider and units are compatible. Otherwise show both
   readings without calculating a change.

## What already exists

- A strict body-composition metric and model-manifest contract.
- Provider registration and revocation.
- Organization-scoped result storage and history.
- Consent, tenant isolation, audit logging and bounded retention.
- Validation calculations for bias, MAE, RMSE and maximum absolute error.
- A provider-not-configured company demonstration.

Preserve these controls. Do not register the owned provider or store its estimates until its model
manifest truthfully satisfies the existing contract.

## Phase 1 — external reference measurements

### 1. Define the reference record

Add a new versioned contract for externally measured or device-estimated composition. Required
fields:

- record, subject and assessment identifiers;
- adult-reference or child-athlete scope;
- organization and actor identifiers when organization-owned;
- measurement time, save time and retention deadline;
- consent reference;
- source class: `dexa`, `bia_clinical`, `smart_scale`, `health_platform`, or `manual_report`;
- manufacturer, device/model, facility and operator when known;
- method label and source-reported software version;
- output key, original value/unit and normalized value/unit;
- measured, device-estimated or calculated status per output;
- report attachment reference, verification status and verifier when applicable;
- limitations and provenance text.

Do not put a source report, patient name, image, or raw file bytes in the JSON result. Store an
optional report in a private object-storage bucket and keep only its opaque storage reference.

### 2. Add database storage

Create separate tables for external composition records and attachments. Add:

- row-level policies for the parent/guardian, authorized organization administrator and platform
  verifier;
- a rule that child records require a real athlete ID and live guardian consent;
- unit and physiological-range checks;
- immutable source provenance after verification;
- mutation audit entries;
- bounded retention and a scheduled deletion sweep;
- duplicate protection using subject, source, measurement time and source record ID;
- attachment deletion when its owning record expires or is deleted.

Do not route these rows through the model-provider foreign key. They are evidence inputs, not model
outputs.

### 3. Build import interfaces

Ship in this order:

1. Manual structured entry.
2. CSV template and preview.
3. Versioned JSON import.
4. Private PDF/report attachment.
5. Device/API connectors later.

The preview must show normalized units, missing fields, duplicates and rejected values before save.
PDF extraction is a later convenience; the first release should ask a person to transcribe and
verify the relevant values rather than trusting unreviewed OCR.

### 4. Add parent and organization screens

In Body Insights, add an `External body composition` section with:

- the newest measurement and its source;
- source/date/device details;
- measured-versus-estimated labels;
- history by compatible method;
- the original report when the viewer has permission;
- export, correction and deletion actions;
- a share/revoke control for organizations.

In the organization portal, add completion and permission status, individual history, source filters
and scoped exports. Do not add child rankings or team body-fat leaderboards.

### 5. Verify phase 1

- Contract rejects unknown fields, units, impossible values and misleading method labels.
- Cross-tenant and revoked-consent reads fail.
- Duplicate imports remain idempotent.
- Private attachments cannot be opened with a public URL.
- Export identifies every value's source and method.
- Deleting a record deletes or schedules deletion of its attachment and writes an audit event.
- A DEXA import never appears as a Parent Playbook estimate.

## Phase 2 — reproducible NHANES data pipeline

### 1. Freeze the research question

Before viewing final holdout results, write the intended population, inputs, outputs, exclusions,
candidate models, subgroup checks and release criteria. Initial intended use is informational adult
longitudinal context. Youth is a later, separate release decision.

### 2. Acquire and inventory public-use data

Use official CDC/NCHS files only. Inventory candidate NHANES cycles containing:

- demographics;
- body measurements;
- whole-body DXA status and outputs;
- examination weights, strata and primary sampling units.

Record source URLs, release dates, codebook versions, file sizes and SHA-256 hashes. Keep original
downloads immutable and outside the public web package.

### 3. Create the analysis dataset

- Join components using the NHANES participant identifier.
- Apply published eligibility and DXA-validity rules.
- Preserve age, sex, height, weight, BMI and optional waist circumference.
- Preserve DXA body-fat percentage, fat mass and lean mass.
- Harmonize units and definitions across cycles.
- Record every exclusion and missing-value reason.
- Keep survey design variables for weighted evaluation.
- Remove participant identifiers from the model-ready export.

Produce a data dictionary, cohort-flow report and cycle-by-cycle count table.

### 4. Split before training

Choose the split after the inventory confirms usable counts. Prefer a later untouched survey cycle
as the final holdout and earlier cycles for development. Inside the development set, create
participant-level training and calibration partitions. Never tune on the final holdout.

### 5. Automate reproducibility

Create one command that downloads or verifies source files, builds the de-identified analysis data,
trains candidate models, evaluates them and produces a signed/hashable evidence bundle. A new source
file, feature list or exclusion rule must change the pipeline version.

## Phase 3 — owned model development

### 1. Establish baselines

Build and retain these baselines:

- population mean by supported age/sex band;
- linear age/sex/height/weight model;
- BMI-based regression;
- optional waist-enhanced regression.

This proves whether a more complicated method actually improves performance.

### 2. Train bounded candidate models

Compare interpretable regularized regression or spline models with one stronger tabular model. Limit
features to values the product can obtain consistently. Do not use health outcomes, diagnoses,
race/ethnicity or identifiers as inference inputs.

### 3. Derive outputs correctly

Predict a primary quantity such as body-fat percentage or fat mass, then enforce mass consistency:

- fat mass cannot be negative or exceed total mass;
- lean mass plus fat mass must reconcile with the model's documented definition;
- uncertainty bounds must contain the estimate and stay inside accepted ranges;
- unsupported or missing inputs return no estimate, not a default.

Do not derive skeletal muscle mass from DXA lean mass.

### 4. Evaluate without marketing language

For calibration and final holdout sets, report:

- participant and observation counts;
- signed bias;
- MAE and RMSE;
- maximum absolute error;
- calibration slope/intercept;
- error distributions and failure rate;
- results by age band, sex, BMI range and race/ethnicity audit group;
- performance with and without optional waist input.

Have a statistician or qualified research reviewer approve thresholds and sample adequacy. If a
subgroup fails, narrow the supported population instead of hiding the result.

### 5. Freeze the release artifact

Create an immutable model package containing:

- model coefficients/weights;
- input and output schemas;
- preprocessing rules;
- supported population and refusal conditions;
- training-data and code versions;
- holdout report;
- model card;
- software license and ownership statement;
- package checksum and signature.

The package must run in a clean buyer-controlled environment without private developer files.

## Phase 4 — provider-neutral inference

### 1. Implement the common provider interface

Define one adapter interface for the owned model and any future vendor:

- provider metadata and manifest;
- eligibility check;
- estimate request;
- normalized estimate response;
- uncertainty response;
- health/status check;
- stable retry identifier;
- deletion capability when a provider retains data.

### 2. Implement the owned adapter

Register `parent-playbook-nhanes` only after the model manifest passes the existing evidence gate.
Run inference in an authenticated server function or service, keep the model version immutable, and
return only normalized scalar outputs and provenance. Do not send child or company data to an
external service.

### 3. Preserve future vendor support

Future vendor adapters must translate into the same response contract. Vendor credentials stay
server-side. A vendor registration must state rights, expiry, supported outputs, population,
retention and deletion behavior. Revoking a provider stops new estimates without corrupting history.

### 4. Verify the boundary

- The owned and synthetic test adapters pass the same conformance suite.
- Unknown outputs and changed model versions fail closed.
- Retries cannot duplicate results.
- A session or consent change during inference blocks the save.
- A provider cannot write beyond its registered outputs or population.

## Phase 5 — product experience

### 1. Add the estimate flow

Ask for date of birth/age, supported sex input, measured height, measured weight and optional waist.
Explain why each input is needed. Show the source date for height and weight and refuse stale or
unsupported inputs according to the frozen model rules.

### 2. Show results responsibly

Display:

- `Population-based estimate` as the method;
- model and evidence version;
- estimate and uncertainty range;
- supported-population statement;
- measured external result beside it when one exists;
- no diagnosis, ideal range, score, rank or prescribed body target.

### 3. Build longitudinal comparison

Compare like with like. Separate externally measured DEXA, device BIA and owned-model series. A
method change gets a visible break in the chart. Show the amount of time between readings and avoid
significance claims the evidence does not support.

### 4. Connect to Parent Playbook

The parent receives neutral context and conversation prompts. The result must not automatically
increase training, restrict food, recommend weight loss or judge athletic potential. A parent may
choose to share it with an existing coach or organization under the current access model.

## Phase 6 — independent evidence

Public-data holdout performance is internal validation, even when the holdout was untouched. Plan a
separate intended-population study before making equivalence or accuracy claims.

1. Write and pre-register the protocol and thresholds.
2. Obtain appropriate consent and youth guardian permission where applicable.
3. Determine sample size with a qualified statistician.
4. Collect same-window product inputs and reference DXA results.
5. Keep study participants out of all training and tuning.
6. Record failures and withdrawals.
7. Run the existing composition-validation report plus agreement and calibration analysis.
8. Obtain independent review.
9. Narrow claims to the populations and outputs that passed.
10. Repeat the evidence gate for every material model change.

## Phase 7 — company and acquisition release

- Add organization composition history, source filters and permission states.
- Add aggregate reporting only with a documented minimum group size.
- Add model-version and provider-health monitoring.
- Complete backup restore, retention sweep and deletion rehearsals.
- Export all normalized customer-owned results and audit history.
- Exclude raw NHANES source files and private health reports from the public SDK package.
- Include the model package, model card, data-source manifest, tests and operating instructions in
  the buyer handover.
- Demonstrate deployment and inference on a clean buyer-controlled host.
- Update the presentation claim register from actual evidence.

## Proposed delivery sequence

### Sprint 1 — measured imports

Ship the external record contract, database tables, manual entry, history, authorization, export and
deletion. This creates useful product behavior without waiting on a model.

### Sprint 2 — data pipeline

Ship the official-source inventory, reproducible join/exclusion pipeline, data dictionary, cohort
flow and frozen train/calibration/holdout split.

### Sprint 3 — model and evidence

Ship baselines, candidate comparison, subgroup evaluation, uncertainty method, frozen owned model,
model card and clean inference package.

### Sprint 4 — product integration

Ship the owned provider adapter, authenticated inference, parent and organization screens,
longitudinal comparison and provider conformance suite.

### Sprint 5 — acquisition and study readiness

Ship the independent-host package, restore/deletion evidence, study intake/export workflow and
buyer presentation. The independent real-world study continues on its own schedule.

## Definition of done

The inexpensive owned path is complete when:

- external DEXA/BIA results can be imported, viewed, exported and deleted with traceable source;
- the public-data pipeline is reproducible from official files;
- the final holdout remained untouched until the release candidate was frozen;
- the owned model returns only supported outputs with uncertainty and refusal conditions;
- parent and organization access obey consent and tenant boundaries;
- imported references and estimates can never be confused;
- model package, rights, evidence and operating instructions transfer to a buyer;
- production backup restore, retention and deletion have been rehearsed;
- claims remain limited to the evidence actually obtained.

## Score treatment

Do not change the current 40 parity points (rubric version 2) for planning work, imports or an unqualified model.
FM05 can advance only when the fixed rubric supports it: a real output exists, the model has lawful
deployment rights, its provenance is truthful, and the required test/evidence stage has been met.
