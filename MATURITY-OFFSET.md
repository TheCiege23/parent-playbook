# Estimated maturity offset and PHV timing

Parent Playbook now has a separate manual workflow for athletes age 8–16. A parent records standing height, sitting height and body mass in one session. The app combines those measurements with chronological age and sex at birth using the sex-specific combined-sample equations published by Mirwald et al. in 2002. The photo scanner does not generate these inputs or this result.

The output includes the estimated maturity offset in years, estimated age at peak height velocity, one of three broad timing descriptions, the measurement date and the equation version. The parent Growth screen and Body Insights show it. An authorized organization can see the same scalar context in an individual athlete view; it is excluded from roster CSV export and cannot be used to sort or rank athletes.

## Data contract

The three source rows are manual `measurements` with keys `height`, `sitting_height` and `weight`. They share a `PP_MATURITY_INPUT_V1` note with one batch ID and one recording date. The calculation refuses incomplete batches, duplicate keys, mixed dates, unknown versions, ages outside 8–16 and implausible dimensions. A database migration adds `sitting_height` to the general metric catalog.

No maturity estimate is stored as a measurement. It is recomputed from the authorized source batch so provenance and later corrections remain visible. Photo results, landmarks and reconstructed geometry are not inputs.

## Limits shown in the product

The UI displays a minimum ±1-year uncertainty band. The original cross-validation reported standard deviations of prediction differences of about 0.65 years in boys and 0.68 years in girls and recommended caution and categorical use. A later independent longitudinal validation found systematic bias for early and late maturers, substantial within-person variation, a narrow useful window for average-maturing boys around ages 13–15, and no corresponding window for average-maturing girls.

The estimate is context for a conversation. It does not diagnose puberty, establish skeletal maturity, determine talent, select a roster, prescribe training, or set a body-weight goal. The app's observed height velocity remains the input that can lighten the parent training plan.

## Sources

- Mirwald RL, Baxter-Jones ADG, Bailey DA, Beunen GP. “An assessment of maturity from anthropometric measurements.” *Medicine & Science in Sports & Exercise*. 2002;34(4):689–694. DOI: 10.1097/00005768-200204000-00020. [PubMed](https://pubmed.ncbi.nlm.nih.gov/11932580/)
- Malina RM et al. “Modified Maturity Offset Prediction Equations: Validation in Independent Longitudinal Samples of Boys and Girls.” *Sports Medicine*. 2016/2018. [Full text at PubMed Central](https://pmc.ncbi.nlm.nih.gov/articles/PMC5752743/)

Five automated tests cover both sex-specific equations, invalid inputs, exact batch coherence, report derivation, and the parent save flow. Organization tests cover authorized scalar display derivation and exclusion from roster CSV.
