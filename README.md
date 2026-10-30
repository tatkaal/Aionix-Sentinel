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
npm run setup        # models, ORT wasm, medical FST, vault index, datasets, icons (network required)
npm run dev          # Workbench at http://localhost:5173
npm run build        # dist-extension/ (load unpacked in chrome://extensions) + dist/ (Workbench)
```

To install the extension: open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, then select `dist-extension/`.

## Quality gates

```bash
npm run typecheck
npm test                                  # unit + 24 edge cases (Path A)
npm run bench                             # Enron / Presidio / AI4Privacy / edge cases → bench-results/
npm run build:ext:test && npm run test:e2e   # Playwright with the extension loaded
```

> Every figure shown in the Benchmarks, Telemetry and Presentation workspaces comes from an actual run of the shipping engine. Blueprint targets are shown only as labelled targets.

## Datasets & licences

Benchmark corpora and vocabularies (Enron, Presidio, AI4Privacy, ICD-10-CM, RxNorm, MiniLM) are documented in [docs/datasets.md](docs/datasets.md), including licence notes and labelling policy.
