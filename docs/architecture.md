# Aionix Sentinel — Architecture

## 1. Runtime topology (Manifest V3)

```
portal page (claude.ai / chatgpt.com / gemini.google.com)
├─ MAIN world:     main-world-interceptor.js   window.fetch backstop (bundled Tier 1)
└─ ISOLATED world: content-script.js           selectors, key/click/paste hooks, chip shadow store,
                                               Tier 1 (sync) + Tier 3 Path A (sync), Shadow DOM drawer
        │ chrome.runtime messages
        ▼
background-sw.js   offscreen lifecycle, routing, zero-knowledge telemetry (chrome.storage.local)
        │
        ▼
offscreen.html → offscreen-onnx-worker.js
        Tier 2 Path A (FST lexicon + MiniLM validator)  — CPU, always available
        Tier 2 Path B (openai/privacy-filter, WebGPU)   — only when the hardware probe passes
        Tier 3 Path B (Orama vectors + CRM tuple hashes)
        memory governor
```

The Workbench runs the same `src/engine/` modules: Tier 1/3A on the main thread and Tier 2/3B in `engine.worker.ts`.

## 2. Category taxonomy

| # | Category | Primary tier |
|---|---|---|
| 1 | API keys & access tokens | Tier 1 |
| 2 | Passwords & secrets (labelled, multilingual, high-entropy) | Tier 1 (+ Path B `secret`) |
| 3 | Government IDs (SSN, passport, driver licence) | Tier 1 |
| 4 | Australian Tax File Number | Tier 1 |
| 5 | Payment cards & bank accounts (Luhn cards, IBAN, BSB + account) | Tier 1 |
| 6 | Business & national IDs (ABN, PAN, Aadhaar) | Tier 1 |
| 7 | Database credentials (connection strings with inline secrets) | Tier 1 |
| 8 | Customer financial records tied to an identifiable person | Tier 2, Tier 3B (CRM rows) |
| 9 | Medical records tied to an identifiable person | Tier 2 |
| 10 | Corporate IP & proprietary documents | Tier 3 |

## 3. Architecture decision records

### ADR-001 — Tier 2 redesign: FST lexicon (Path A) + WebGPU neural (Path B)

**Context.** The blueprint paired an INT4 MoE on WebGPU with `gliner_small-v2.1` INT8 on WASM, with a < 80 MB WASM budget. Verified on the Hugging Face Hub (2026-10-30):

- The smallest `onnx-community/gliner_small-v2.1` build is 183 MB (`model_int8.onnx`), so it cannot meet < 80 MB. Paired with MiniLM, it breaks the 150 MB offscreen ceiling.
- `openai/privacy-filter` is real: Apache-2.0, 1.5B total / 50M active parameters, 128k context, Transformers.js `token-classification`. Its weights are about 917 MB (`q4`) or 809 MB (`q4f16`). Its 8 labels are `private_person, account_number, private_address, private_email, private_phone, private_url, private_date, secret`. It has **no medical label**.

**Decision (user-directed).**

- **Path A — Hybrid Lexicon-Automata.**
  - ICD-10-CM 2026 conditions (CMS, public domain) and RxNorm prescribable drug names (NLM, no UMLS licence needed) are compiled into a minimal acyclic FST (DAFSA with minimal-perfect-hash outputs), stored as `assets/engine/medical.fst.bin`.
  - The runtime walks a `Uint32Array` with no per-token allocation.
  - A clinical or financial hit is only escalated when two things hold:
    1. a non-public person node sits within 30 tokens of it (proximity graph);
    2. the shared MiniLM-L6 INT8 context validator classifies the surrounding window as a personal disclosure rather than a general question.
- **Path B — WebGPU with hardware-aware degradation.**
  - `hardware-probe.ts` checks the adapter (non-fallback, `maxStorageBufferBindingSize`, `maxBufferSize`, `shader-f16`) and `navigator.deviceMemory`.
  - When the probe passes, `openai/privacy-filter` runs on WebGPU. Its `private_person` and `account_number` spans become graph nodes, and `secret` supplements Category 2. Medical nodes still come from the FST.
  - Any probe failure, session OOM, device loss, or a post-load host footprint above the ceiling degrades to Path A, and the reason is surfaced.
- **Contingency (not built).** A custom MobileBERT clinical NER (Q4F16, < 50 MB) fine-tuned on MIMIC-III. It needs credentialed PhysioNet access and an MLOps pipeline, so it is only pursued if Path B cannot run in the offscreen document.

**Consequences.**

- Path A is deterministic, fast and small, but its recall on colloquial phrasing depends on lexicon coverage.
- Path B adds neural person and account detection on capable hardware.
- Both paths are benchmarked side by side.
- Path B passes about 0.8–0.9 GB of weights through host memory, and in the offscreen document that cost is not transient: the host footprint measured 958 MB after load. Under the 150 MB ceiling the governor therefore evicts Path B in the extension (ADR-002), so the shipping extension runs Path A. Path B is evaluated in the Workbench, which reports the ceiling but does not enforce it.
- That measurement is the condition the contingency names. A Path B that fits the extension needs a small model (the MobileBERT route, or a distilled token classifier), not a different runtime.

### ADR-002 — Memory governance

- **Ceiling.** The ceiling is 150 MB for the offscreen document, with a warning watermark at 105 MB. Path A targets < 50 MB steady state.
- **Measurement.** `performance.measureUserAgentSpecificMemory()` is used when the page is `crossOriginIsolated`. The manifest sets COOP/COEP for extension pages, and the Workbench dev/preview server sends them too. Otherwise the governor falls back to `performance.memory` plus tracked model/ArrayBuffer sizes, and labels the method it used.
- **Path A runtime.** Path A uses `onnxruntime-web/wasm` (the CPU-only 14 MB wasm) with a built-in WordPiece tokenizer. It does not use Transformers.js, which would pull in the 27 MB asyncify/WebGPU wasm.
  - Tokenisation is verified identical to Transformers.js.
  - Embeddings match to cosine 1.000000.
- **Threads.** ORT uses up to 4 threads when the page is cross-origin isolated. In Chrome, one short MiniLM embedding measured about 72 ms on 1 thread versus about 26 ms on 4.
- **One text per inference.** The INT8 model quantises activations with one scale per batch, so batching shifts vectors by about 1%. Embedding one text per inference keeps index-time and query-time vectors bit-identical. An LRU cache shares paragraph embeddings between Tier 2's validator and Tier 3's EDM.
- **Measured numbers.** These are recorded in the table below as they are measured.

| Component | Budget | Measured | How |
|---|---|---|---|
| `corporate-vault.bin` (Tier 3A) | sized to vault | 7.2 KB | file size (4 assets, per-asset Bloom p ≈ 1e-4) |
| `vault-edm.bin` (Tier 3B) | — | 200 KB | file size (105 vectors, 250 salted field hashes) |
| `medical.fst.bin` | ≤ 10 MB | 3.20 MB | file size (54,103 entries, 400,259 states) |
| MiniLM-L6 INT8 weights | ~23 MB | 21.9 MB | file size |
| MiniLM session in ONNX Runtime wasm | — | ≈ 80 MB | bare-page probe: 24.5 MB → 103 MB with graph optimisation, → 83.6 MB without |
| **Offscreen Path A steady state** | **< 50 MB target · 150 MB ceiling** | **86.7 MB** | `measureUserAgentSpecificMemory` after a forced GC, inside the offscreen document (raw CDP), after 20 prompts |
| Offscreen with Path B loaded (q4f16) | < 150 MB (else degrade) | **958 MB → evicted** | the governor's own post-load `measureUserAgentSpecificMemory` reading, which triggered the eviction |
| Offscreen after eviction, same document | — | 999.8 MB | as the Path A row, in a run before recycling was added; session disposed, wasm heap retained |
| Offscreen after eviction, recycled document | 150 MB ceiling | **86.7 MB** | as the Path A row (`bench-results/extension-measurements-path-b.json`) |

- **Path A misses its < 50 MB target.** The MiniLM INT8 session alone costs about 80 MB of wasm memory in ONNX Runtime Web. Everything else (FST, EDM, Orama, validator anchors) adds about 7 MB. It stays under the 150 MB ceiling.
- **Graph optimisation is disabled** for the browser embedder. It saved about 20 MB, and embeddings are unchanged.
- **Transient readings during initialisation** reached about 263 MB while model buffers were in flight. The governor therefore never measures before Path A is ready, and its eviction decision waits for a reading taken *after* Path B loads (`measureFresh`).
- **Eviction.** Path B is not routable until that post-load check passes. Above the ceiling, the sequence is:
  1. The host disposes the session.
  2. The offscreen document asks the background worker to recycle it. Disposing alone left 999.8 MB allocated, because wasm linear memory never shrinks.
  3. The eviction is remembered in the document's `localStorage`, so the replacement starts on Path A without re-downloading the weights.
  4. *Force WebGPU* clears the memory and re-measures. A route change in flight during a recycle is answered with status, never resent, so it cannot loop.
- **Fallback estimate.** If no browser reading arrives, the governor uses the `performance.memory` JS heap floored at the tracked model bytes. Chrome's heap figure already includes ArrayBuffer and wasm backing stores, so the two are never added together.

### ADR-003 — Build & packaging

- One npm package with two build targets. `scripts/build-extension.mjs` uses the Vite build API:
  - content scripts → IIFE, since MV3 content scripts cannot be ES modules;
  - the service worker, popup and offscreen document → ESM;
  - output is unminified so reviewers can read what ships.
- `vite.config.ts` builds the Workbench and copies `dist-extension/` into `dist/extension/`, so the Source workspace can ZIP it client-side with fflate.
- The ORT `wasmPaths` default points at jsDelivr (remote code). It is always overridden with extension-local URLs.

### ADR-004 — Interception strategy

- **Capture-phase hooks.** The content script installs capture-phase `keydown` (Enter without Shift, not composing), `click` (send buttons) and `submit` listeners at `document_start`.
- **On send:**
  1. Tier 1 and Tier 3A run synchronously.
  2. A high-risk result blocks immediately.
  3. Otherwise the send is held while Tier 2 and 3B run in the offscreen document.
  4. On a clean verdict, a one-shot bypass re-dispatches `sendButton.click()`.
- **Large pastes.** A paste of 1,200 characters or more is captured into the `AttachmentShadowStore` before the portal turns it into a `pasted-content.txt` chip. A MutationObserver lifts the block when a flagged chip is removed.
- **Fetch backstop.** The MAIN-world `fetch` wrapper only allows prompt bodies whose digest the content script has verified. Unverified bodies get a bundled Tier 1 scan.
- **Redaction.** Raw offsets are mapped to DOM Ranges, and `execCommand('insertText')` is applied last-to-first so ProseMirror/Quill editor state stays consistent.

### ADR-005 — Tier 2 latency budget

- **Context.** The send path promises a verdict within 1,000 ms. On integrated GPUs, `openai/privacy-filter` can take longer than that on long prompts. If Tier 2 times out, the content script fails open on the already-clean Tier 1/3A verdict.
- **Decision.** Path B gets a 650 ms Tier 2 budget (`PATH_B_BUDGET_MS`). Past it, Path A (CPU, about 20–40 ms) decides that prompt and the result carries a `degradedReason`. ONNX Runtime cannot cancel a run, so the in-flight Path B inference finishes and is discarded.
- **Benchmarks** call the host with `strictRoute`, so Path B quality and latency are measured as they are, never padded by Path A.

### ADR-006 — Benchmark methodology

- **One harness everywhere.** `src/engine/bench/harness.ts` runs the full cascade in Node (`npm run bench`) and in the Workbench worker. Both produce the same Path A detections.
- **Ground truth** comes from each dataset's own annotations. Dev splits were used for error analysis; held-out splits were drawn later from different offsets and are only evaluated.
- **Adjudications** correct genuinely wrong labels only, never engine behaviour. Each one carries a reason and lives in `data/datasets/enron-adjudications.json`.
- **The CI gate** (`bench-gate.json`) is a regression guard just below measured performance. Blueprint targets are reported separately.

## 4. Known risks

- **Selector and endpoint drift.** Live portal DOM selectors and completion endpoints change without notice. They are isolated per portal in `content/adapters/`.
- **Gemini request bodies** (`f.req`) are nested, form-encoded JSON. The extractor is best-effort and falls back to scanning the whole body.
- **ICD-10 ambiguity.** Some terms are ambiguous ("fall", "cold"). This is handled by a stoplist, the proximity rule and the validator, and precision is measured rather than assumed.
