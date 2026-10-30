<p align="center">
  <img src="assets/brand/aionix-mark.svg" alt="" height="56" />
</p>

<h1 align="center">Aionix Sentinel</h1>

<p align="center">Enterprise AI prompt guard: a Manifest V3 Chrome extension with a hardware-aware, 3-tier local DLP engine and an operational benchmarking workbench.</p>

---

Aionix Sentinel inspects what employees type or paste into **Claude.ai**, **ChatGPT** and **Gemini**. It blocks high-risk corporate data before any byte leaves the browser. All inspection runs locally: there is no server round-trip and no remote code.

## What's inside

| Surface | Description |
|---|---|
| **Chrome extension (MV3)** | Isolated-world content script (Tier 1 + Tier 3A), MAIN-world `fetch` backstop, background service worker, offscreen inference document (Tier 2 + Tier 3B), branded popup and Shadow DOM block drawer with one-click redaction |
| **Workbench** | Live Sandbox · Corporate Vault · Benchmarks · Telemetry · Extension Source & ZIP · Stakeholder Presentation |

## Detection engine

| Tier | Categories | How |
|---|---|---|
| **Tier 1**: deterministic & mathematical (sync, content script) | 1–7: API keys, passwords/secrets, government IDs, AU TFN, cards/bank, ABN/PAN/Aadhaar, DB credentials | Offset-preserving normalizer, O(n) pattern automata, Luhn (test cards exempt), TFN Mod-11, ABN Mod-89, Aadhaar Verhoeff, IBAN Mod-97, Shannon entropy, multilingual password labels |
| **Tier 2 Path A**: lexicon-automata (CPU, always on) | 8–9: customer financial and medical records tied to a person | ICD-10-CM + RxNorm compiled into an FST; 30-token person ↔ term proximity graph; MiniLM-L6 INT8 context validator |
| **Tier 2 Path B**: WebGPU neural (hardware-gated) | 8–9 (+2) | `openai/privacy-filter` via Transformers.js on WebGPU; degrades to Path A on weak hardware, OOM or memory pressure |
| **Tier 3 Path A**: document fingerprinting (sync) | 10: corporate IP | 5-gram shingles, Bloom filter + 64-permutation MinHash over `corporate-vault.bin` |
| **Tier 3 Path B**: exact data match (offscreen) | 8, 10 | Orama in-memory vector index (MiniLM embeddings, cosine > 0.95) + salted CRM tuple hashes |

The design decisions, memory budgets and trade-offs are in [docs/architecture.md](docs/architecture.md).

## Quick start

```bash
npm install
npm run data:models && npm run data:datasets   # MiniLM INT8 + ONNX Runtime wasm, benchmark datasets (network)
npm run dev                                    # Workbench at http://localhost:5173
npm run build                                  # dist-extension/ (load unpacked) + dist/ (Workbench)
```

The compiled engine indexes (`assets/engine/*`) are committed. `npm run setup` rebuilds everything from source: the ICD-10-CM / RxNorm FST, the vault indexes and the icons.

To install the extension: open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, then select `dist-extension/`.

## Quality gates

```bash
npm run typecheck
npm test                                     # unit suites + the 24 edge cases through the full cascade
npm run bench:gate                           # all datasets, full cascade, Path A → bench-results/path-a.json
npm run build:ext:test && npm run test:e2e   # Playwright drives the real extension on portal fixtures
```

`.github/workflows/release-gate.yml` runs the same gates in CI.

In-extension memory and latency come from `npm run build:ext:test && npm run measure:ext` (add `-- --path-a-only` to disable the GPU); `npm run report` regenerates the results section below from `bench-results/`.

> Every figure shown in the Benchmarks, Telemetry and Presentation workspaces comes from an actual run of the shipping engine. Blueprint targets are shown only as labelled targets.

## Measured results

<!-- results:start -->
Document-level detection, positive = "must block". **Dev** splits were used for error analysis while developing rules (optimistic); **held-out** splits were never inspected or tuned on.

| Dataset | Split | n | Path A P / R | Path A F2 | Path A FPR | Path A p50 / p95 | Path B F2 | Path B FPR | Path B p50 / p95 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 24 Stakeholder Edge Cases | curated | 25 | 1.000 / 1.000 | 1.000 | 0.00% | 27 ms / 124 ms | 1.000 | 0.00% | 265 ms / 1015 ms |
| Enron Email Corpus | dev | 300 | 1.000 / 1.000 | 1.000 | 0.00% | 108 ms / 428 ms | 0.250 | 5.02% | 688 ms / 2405 ms |
| Presidio Synthetic PII | dev | 488 | 1.000 / 1.000 | 1.000 | 0.00% | 17 ms / 32 ms | 0.988 | 4.64% | 252 ms / 416 ms |
| AI4Privacy Multilingual | dev | 584 | 1.000 / 0.812 | 0.844 | 0.00% | 31 ms / 52 ms | 0.867 | 14.25% | 332 ms / 472 ms |
| Enron · held-out | holdout | 300 | 0.200 / 1.000 | 0.556 | 1.34% | 37 ms / 130 ms | 0.208 | 6.35% | 717 ms / 2158 ms |
| AI4Privacy · held-out | holdout | 500 | 0.914 / 0.646 | 0.687 | 1.20% | 12 ms / 20 ms | 0.770 | 14.83% | 340 ms / 481 ms |

Blueprint targets (F2 ≥ 0.978, FPR < 0.02%), on Path A:
- Met: 24 Stakeholder Edge Cases, Enron Email Corpus, Presidio Synthetic PII.
- **Not met: AI4Privacy Multilingual, Enron · held-out, AI4Privacy · held-out.**

- **Path B trade-off.** Path B raises held-out AI4Privacy recall, but its false alarms are much higher. Across its 168 false positives, the most frequent finding types are `CUSTOMER_IDENTITY` (114), `SECRET` (47), `PATIENT_IDENTITY` (17).
  - Diagnosis: privacy-filter `account_number` spans are used both as identifiers and as financial values, so two unrelated numbers can form a "customer record".
  - Next step: treat neural account numbers as financial values only, then re-benchmark.
- **Browser runs:** recorded 2026-10-30 in the Workbench engine worker (the same modules as the offscreen document).
  - Path A: ONNX Runtime wasm (CPU) · 20 logical cores.
  - Path B: openai/privacy-filter (q4f16, WebGPU) · intel · gen-12lp.
  - Latency is end-to-end per observation: Tier 1 + 3A on the main thread, plus the worker round-trip for Tier 2 + 3B.
- **Node CI baseline:** 2026-10-30, Node v22.14.0, 12th Gen Intel(R) Core(TM) i7-12700H. It produces the same Path A detections as the browser run.
- **Inside the extension** (path-a-only (GPU disabled), Chromium via Playwright):
  - Offscreen memory: 86.7 MB (measureUserAgentSpecificMemory after forced GC (raw CDP, offscreen document)).
  - Tier 2 route(s): A. Path B: unavailable.
  - Tier 2 p50 / p95: 6.5 ms / 9.3 ms. Tier 3B p50 / p95: 0.3 ms / 7.5 ms.
- **Inside the extension** (auto (Path B allowed), Chromium via Playwright):
  - Offscreen memory: 86.7 MB (measureUserAgentSpecificMemory after forced GC (raw CDP, offscreen document)).
  - Tier 2 route(s): A. Path B: evicted.
  - Path B outcome: Degraded → Path A: host memory 958 MB > 150 MB ceiling (measureUserAgentSpecificMemory) (remembered — choose Force WebGPU to retry).
  - Tier 2 p50 / p95: 6.5 ms / 9.6 ms. Tier 3B p50 / p95: 0.3 ms / 5.8 ms.
<!-- results:end -->

## Known limitations

- **Live portal DOM drift.** Selectors and prompt endpoints for Claude, ChatGPT and Gemini change without notice. They live only in `src/extension/content/adapters/` and are verified against structural fixtures, not the live sites.
- **Held-out recall on AI4Privacy is the weak spot.** Unlabelled national IDs and unlabelled passwords without login cues are not detectable by rules. Path B and future larger held-out calibration are the levers (see `docs/datasets.md`).
- **Path B does not fit the extension.** With `openai/privacy-filter` loaded, the offscreen document measured 958 MB against a 150 MB ceiling. The governor evicts it, recycles the document (back to 86.7 MB) and remembers the eviction, so the shipping extension runs Path A. Path B is evaluated in the Workbench, which reports the ceiling without enforcing it. A Path B that fits needs a much smaller model (see ADR-001).
- **Path B cost.** On modest GPUs a send that hits Path B can exceed its 650 ms Tier 2 budget. Path A then decides that prompt, and the degradation is recorded in telemetry.
- **Memory readings.** The extension offscreen document reports `measureUserAgentSpecificMemory()`. A plain Web Worker cannot, so the Workbench reports page + worker together.

## Datasets & licences

Benchmark corpora and vocabularies (Enron, Presidio, AI4Privacy, ICD-10-CM, RxNorm, MiniLM) are documented in [docs/datasets.md](docs/datasets.md), including licence notes and labelling policy.
