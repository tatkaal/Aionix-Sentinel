# Benchmark Datasets & Vocabularies

`npm run data:datasets` writes samples into `data/datasets/`. The Workbench and `npm run bench` read them from there.

All sampling is seeded, so re-running the script produces the same rows.

## Benchmark corpora

| Dataset | Source | Licence | Committed? | Role |
|---|---|---|---|---|
| Enron Email Corpus | [`LLM-PBE/enron-email`](https://huggingface.co/datasets/LLM-PBE/enron-email) (CMU Enron emails, via the HF datasets-server rows API) | Apache-2.0 (dataset card) | Yes (sample) | Benign enterprise stress test; measures the false-positive rate (FPR) |
| Presidio synthetic PII | [`synth_dataset_v2.json`](https://github.com/data-privacy-stack/presidio-research/blob/main/data/synth_dataset_v2.json) (`presidio-research`) | MIT | Yes | Mixed PII; tests precision on PII outside our block policy and recall on cards/SSN/IBAN |
| AI4Privacy PII-200k | [`ai4privacy/pii-masking-200k`](https://huggingface.co/datasets/ai4privacy/pii-masking-200k) | No licence stated on the card | **No** (gitignored; fetched at setup/CI) | Multilingual (en/fr/de/it) spans, plus obfuscation augmentation |
| Stakeholder edge cases | Hand-authored from the blueprint (see [edge-cases.md](edge-cases.md)) | Project | Yes | 24 mandatory acceptance scenarios |

### Labelling policy

- **Ground truth is a document-level `block` / `allow` label plus the expected categories.** Labels are mapped from each dataset's own annotations. The engine is never used to label data.
- **Presidio:** rows with `CREDIT_CARD`, `US_SSN`, `US_DRIVER_LICENSE` or `IBAN_CODE` are `block`. Rows that contain only names, addresses, emails, phones or dates are `allow`, because ordinary PII is outside the 10-category block policy.
- **Enron:** every row defaults to `allow`. Rows the engine flags are reviewed by hand and recorded in `data/datasets/enron-adjudications.json`, with the reason and the corrected label. This keeps FPR honest without letting the engine label itself.
- **AI4Privacy:** high-risk labels map to the matching category, e.g. `CREDITCARDNUMBER` → 5, `PASSWORD` → 2, `SSN` → 3, `IBAN` → 5, `ACCOUNTNUMBER` → 8 only when a name is present. Rows with only low-risk labels are `allow`.
- **Augmentation is labelled as augmentation.** It adds checksum-valid AU TFN, ABN, Aadhaar and PAN rows, Category 8 and 9 rows, and obfuscation (spacing, dashes, JSON/CSV/code wrapping). Every augmented row carries `augmented: true` and is reported both separately and combined.
- **Checksum policy:** synthetic card or ID numbers that fail their checksum are reported in a separate bucket. They are not real cards or IDs, so blocking them would be a false positive.

## Tier 2 Path A vocabularies

| Vocabulary | Source | Licence | Use |
|---|---|---|---|
| ICD-10-CM 2026 code descriptions | [CMS `2026-code-descriptions-tabular-order.zip`](https://www.cms.gov/files/zip/2026-code-descriptions-tabular-order.zip) (74,719 codes) | Public domain (US Government) | Medical-condition terms |
| RxNorm Current Prescribable Content | [NLM `RxNorm_full_prescribe_*.zip`](https://www.nlm.nih.gov/research/umls/rxnorm/docs/prescribe.html) (IN / PIN / BN term types) | Freely available; no UMLS licence required | Medication names |
| MiniLM-L6-v2 INT8 | [`Xenova/all-MiniLM-L6-v2`](https://huggingface.co/Xenova/all-MiniLM-L6-v2) | Apache-2.0 | Context validator + Tier 3B embeddings |
