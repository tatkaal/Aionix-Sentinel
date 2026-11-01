# Benchmark Datasets & Vocabularies

`npm run data:datasets` writes samples into `data/datasets/`. The Workbench and `npm run bench` read them from there.

All sampling is seeded, so re-running the script produces the same rows.

## Benchmark corpora

| Dataset | Source | Licence | Committed? | Role |
|---|---|---|---|---|
| Enron Email Corpus | [`LLM-PBE/enron-email`](https://huggingface.co/datasets/LLM-PBE/enron-email) (CMU Enron emails, via the HF datasets-server rows API) | Apache-2.0 (dataset card) | Yes (sample) | Benign enterprise stress test; measures the false-positive rate (FPR) |
| Presidio synthetic PII | [`synth_dataset_v2.json`](https://github.com/data-privacy-stack/presidio-research/blob/main/data/synth_dataset_v2.json) (`presidio-research`) | MIT | Yes | Mixed PII; tests precision on PII outside our block policy and recall on cards/SSN/IBAN |
| AI4Privacy PII-200k | [`ai4privacy/pii-masking-200k`](https://huggingface.co/datasets/ai4privacy/pii-masking-200k) | No licence stated on the card | **No** (gitignored; fetched at setup/CI) | Multilingual (en/fr/de/it) spans, plus obfuscation augmentation |
| Stakeholder edge cases | Written from the brief's edge-case list (see [edge-cases.md](edge-cases.md)) | Project | Yes | 24 mandatory acceptance scenarios |
| English disclosure probes | Hand-authored after the stakeholder reported `my current psw is …` passing (`scripts/datasets/english-probes.ts`) | Project | Yes | 137 English phrasings across Categories 1–10 plus benign near-misses, incl. the stakeholder brief's formats (spaces/dashes, code blocks, JSON, CSV, unlabelled passwords, code that names a password field). Used to find and fix gaps, so it is a regression suite (`curated`), not an unbiased estimate |

### Labelling policy

- **Ground truth is a document-level `block` / `allow` label plus the expected categories.** Labels are mapped from each dataset's own annotations. The engine is never used to label data.
- **Presidio:** rows with `CREDIT_CARD`, `US_SSN`, `US_DRIVER_LICENSE` or `IBAN_CODE` are `block`. Rows that contain only names, addresses, emails, phones or dates are `allow`, because ordinary PII is outside the 10-category block policy.
- **Enron:** every row defaults to `allow`. Rows the engine flags are reviewed by hand and recorded in `data/datasets/enron-adjudications.json`, with the reason and the corrected label. This keeps FPR honest without letting the engine label itself.
- **AI4Privacy:** high-risk labels map to the matching category, e.g. `CREDITCARDNUMBER` → 5, `PASSWORD` → 2, `SSN` → 3, `IBAN` → 5, `ACCOUNTNUMBER` → 8 only when a name is present. Rows with only low-risk labels are `allow`.
  - This mapping was fixed before the stakeholder's raw brief arrived. The brief's Category 5 covers bank account numbers, so since 2026-11-01 the engine also blocks a labelled account number in a banking context ("Savings Account number 80536240"). AI4Privacy still scores that as a false positive (1 dev row); the mapping was deliberately not changed after seeing engine output.
- **Augmentation is labelled as augmentation.** It adds checksum-valid AU TFN, ABN, Aadhaar and PAN rows, Category 8 and 9 rows, and obfuscation (spacing, dashes, JSON/CSV/code wrapping). Every augmented row carries `augmented: true` and is reported both separately and combined.
- **Checksum policy:** synthetic card or ID numbers that fail their checksum are reported in a separate bucket. They are not real cards or IDs, so blocking them would be a false positive.

## Dev vs held-out splits (read before quoting numbers)

- **Dev splits were used for error analysis.** These are `enron`, `presidio` and `ai4privacy`. I studied their misclassifications and refined the detectors on them:
  - an IMEI exclusion;
  - stricter unlabelled-secret shapes;
  - financial-record linking rules;
  - multilingual national-ID labels;
  - single-word ICD headings filtered against everyday English.

  Their scores are therefore **optimistic, in-sample** numbers.
- **Held-out splits** (`enron-holdout`, `ai4privacy-holdout`) were drawn from different corpus offsets after rule development finished. They are only ever *evaluated*. Their misclassifications are reviewed solely to fix wrong ground-truth labels, never to change rules. **Quote the held-out numbers** as the expected real-world behaviour.
- **Adjudications** are recorded in `data/datasets/enron-adjudications.json`, each with its reason. Two Enron emails turned out to share real credentials (`Password: WELCOME`, `password is ENRON`) and are labelled `block`.
- **Release gate.** `bench-gate.json` is a regression guard set just below the measured results. The design targets from the original plan (F2 ≥ 0.978, FPR < 0.02 %) are shown separately as targets and are not yet met on held-out data.

### Known failure modes on held-out data

These were observed but not tuned away:

- Password-*scheme* descriptions ("Your Password: Date of Birth") are read as labelled passwords.
- Phone-number fragments with dashes can pass the TFN Mod-11 checksum.
- Charity or health event notices that name a volunteer near a disease term are read as a patient link.
- Unlabelled national IDs and unlabelled passwords without login cues are missed. These dominate AI4Privacy recall.

## Tier 2 Path A vocabularies

| Vocabulary | Source | Licence | Use |
|---|---|---|---|
| ICD-10-CM 2026 code descriptions | [CMS `2026-code-descriptions-tabular-order.zip`](https://www.cms.gov/files/zip/2026-code-descriptions-tabular-order.zip) (74,719 codes) | Public domain (US Government) | Medical-condition terms |
| RxNorm Current Prescribable Content | [NLM `RxNorm_full_prescribe_*.zip`](https://www.nlm.nih.gov/research/umls/rxnorm/docs/prescribe.html) (IN / PIN / BN term types) | Freely available; no UMLS licence required | Medication names |
| MiniLM-L6-v2 INT8 | [`Xenova/all-MiniLM-L6-v2`](https://huggingface.co/Xenova/all-MiniLM-L6-v2) | Apache-2.0 | Context validator + Tier 3B embeddings |
| US surnames (top 1,000) | [US Census Bureau 2010 surname file](https://www2.census.gov/topics/genealogy/2010surnames/names.zip) → `data/lexicons/surnames.txt` | Public domain | Name parts after a known first name ("Sarah Mitchell") even when the surname is also a vocabulary word |
| Multilingual everyday words | Whole-word pieces of the XLM-R vocabulary (`tokenizer.json` of `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`) | Apache-2.0 | Never fuzzy-match these against drug names; drop brand names that are everyday words |

## Live test kit data

`data/test-kit/` holds four **fictional** samples (Halcyon settlement code, pricing memo, customer CSV, patient CSV). They are protected inside the extension during live tests (options page), and compiled with the category prompts and the 24 edge cases into `assets/engine/test-kit.json` by `npm run data:test-kit`.

## Tier 2 Path B model and training data

The shipped Path B tagger (`assets/engine/pathb/`) is trained by `scripts/ml/` (see ADR-007 in [architecture.md](architecture.md)). Only permissively licensed data is used to train it. None of the benchmark corpora above are used for training or for selecting checkpoints.

| Asset | Source | Licence | Use |
|---|---|---|---|
| Multilingual-MiniLM-L12-H384 | [`microsoft/Multilingual-MiniLM-L12-H384`](https://huggingface.co/microsoft/Multilingual-MiniLM-L12-H384) | MIT | Encoder (vocabulary trimmed to the training corpus) |
| XLM-R tokenizer | `tokenizer.json` from [`sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2) (same 250k vocabulary) | Apache-2.0 | Source of the trimmed Unigram vocabulary |
| Nemotron-PII | [`nvidia/Nemotron-PII`](https://huggingface.co/datasets/nvidia/Nemotron-PII), train split (100k synthetic English documents, 30 domains) | CC BY 4.0 (attribution) | Training (97k rows) and validation slice |
| Gretel synthetic PII finance | [`gretelai/synthetic_pii_finance_multilingual`](https://huggingface.co/datasets/gretelai/synthetic_pii_finance_multilingual), train split (en, fr, de, it, es, nl, sv) | Apache-2.0 | Training (49k rows) and validation slice |

Bake-off candidates: these were benchmarked and not shipped. Weights are downloaded to `.cache/ml/`.

| Candidate | Source | Licence |
|---|---|---|
| Ettin-17M / 32M Nemotron-PII fine-tunes | [`kalyan-ks/ettin-17m-nemotron-pii`](https://huggingface.co/kalyan-ks/ettin-17m-nemotron-pii), [`kalyan-ks/ettin-32m-nemotron-pii`](https://huggingface.co/kalyan-ks/ettin-32m-nemotron-pii) | MIT |
| OpenMed PII ClinicalE5-Small (33M) | [`OpenMed/OpenMed-PII-ClinicalE5-Small-33M-v1`](https://huggingface.co/OpenMed/OpenMed-PII-ClinicalE5-Small-33M-v1) | Apache-2.0 |
| openai/privacy-filter | [`openai/privacy-filter`](https://huggingface.co/openai/privacy-filter) | Apache-2.0 (the earlier Path B; evicted in the extension at 958 MB) |

AI4Privacy is never used for training. Its datasets carry a non-commercial licence, and its splits are our multilingual benchmark.
