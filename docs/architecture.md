# Aionix Sentinel — Architecture

## 1. Runtime topology (Manifest V3)

```
portal page (claude.ai / chatgpt.com / gemini.google.com)
├─ MAIN world:     main-world-interceptor.js   fetch / XHR backstop: Tier 1 here, then the rest of the
│                                              cascade through the content script, for any unverified prompt
└─ ISOLATED world: content-script.js           selectors, key/click/paste hooks, chip shadow store,
                                               Tier 1 (sync) + Tier 3 Path A (sync), Shadow DOM drawer
        │ chrome.runtime messages
        ▼
background-sw.js   offscreen lifecycle (created once, outlives the worker), routing, zero-knowledge telemetry
        │
        ▼
offscreen.html → offscreen-onnx-worker.js
        Tier 2 Path A (FST lexicon + MiniLM validator)  — CPU, always available
        Tier 2 Path B (multilingual MiniLM tagger, INT8) — packaged, CPU, any hardware (ADR-007)
        Tier 3 Path B (Orama vectors + CRM tuple hashes)
        memory governor
```

The Workbench runs the same `src/engine/` modules: Tier 1/3A on the main thread and Tier 2/3B in `engine.worker.ts`.

## 2. Category taxonomy

| # | Category | Primary tier |
|---|---|---|
| 1 | API keys & access tokens | Tier 1 |
| 2 | Passwords & secrets (labelled, multilingual, high-entropy, strength questions, private keys) | Tier 1 |
| 3 | Government IDs (SSN, passport, driver licence, national IDs, UK NINO, AU Medicare) | Tier 1 |
| 4 | Australian Tax File Number | Tier 1 |
| 5 | Payment cards & bank accounts (Luhn cards, IBAN, BSB / routing + account, labelled accounts in a banking context) | Tier 1 |
| 6 | Business & national IDs (ABN, PAN, Aadhaar) | Tier 1 |
| 7 | Database credentials (connection strings with inline secrets) | Tier 1 |
| 8 | Customer financial records tied to an identifiable person | Tier 2, Tier 3B (CRM rows) |
| 9 | Medical records tied to an identifiable person | Tier 2, Tier 3B (patient rows) |
| 10 | Corporate IP & proprietary documents | Tier 3 |

**How Categories 8–10 are decided, and why** (the brief leaves this to us):

- **8 and 9 are about a *person*, not about vocabulary.** "What are the symptoms of diabetes?" and "Warren Buffett's net worth" must pass; "patient Linda Park, breast cancer, tamoxifen 20 mg" must not. So a block needs both:
  - a non-public person (a name, MRN, DOB or customer ID);
  - a sensitive fact within 30 tokens: an ICD-10-CM condition, an RxNorm drug or a dose for 9; an account, or an amount plus a financial attribute, for 8.
- **Who decides whether that pairing is a record:**
  - **Record subjects:** a name after a record role (patient, client, customer, policyholder …), or a record identifier, is a record by construction.
  - **Uncued names:** the MiniLM validator decides between a disclosure and a general question.
  - **Why the split:** keyword lists alone over-block, and a model alone is unexplainable and slow.
- **10 is about *what the organisation owns*,** which no general rule can know. It is decided by fingerprints of the organisation's own material:
  - **Excerpts and near-copies:** Bloom + MinHash shingles catch copied excerpts (about 2 lines of code) and near-duplicates.
  - **Restated paragraphs:** Orama vectors catch paragraphs restated almost verbatim.
  - **Exact rows:** salted field hashes catch exact customer and patient rows, which also covers 8 and 9.
  - **Where the fingerprints come from:** a bundled demo vault, plus the options page's *Protected data*, which stores fingerprints only.
  - **Why not markings:** a "confidential" banner is not used as a signal, because Enron-style mail footers carry it on ordinary messages.

## 3. Architecture decision records

### ADR-001 — Tier 2 redesign: FST lexicon (Path A) + WebGPU neural (Path B)

*Path B was superseded by ADR-007: the WebGPU model could not fit the extension's memory ceiling.*

**Context.** The first plan paired an INT4 MoE on WebGPU with `gliner_small-v2.1` INT8 on WASM, with a < 80 MB WASM budget. Verified on the Hugging Face Hub (2026-10-30):

- The smallest `onnx-community/gliner_small-v2.1` build is 183 MB (`model_int8.onnx`), so it cannot meet < 80 MB. Paired with MiniLM, it breaks the 150 MB offscreen ceiling.
- `openai/privacy-filter` is real: Apache-2.0, 1.5B total / 50M active parameters, 128k context, Transformers.js `token-classification`. Its weights are about 917 MB (`q4`) or 809 MB (`q4f16`). Its 8 labels are `private_person, account_number, private_address, private_email, private_phone, private_url, private_date, secret`. It has **no medical label**.

**Decision (user-directed).**

- **Path A — Hybrid Lexicon-Automata.**
  - ICD-10-CM 2026 conditions (CMS, public domain) and RxNorm prescribable drug names (NLM, no UMLS licence needed) are compiled into a minimal acyclic FST (DAFSA with minimal-perfect-hash outputs), stored as `assets/engine/medical.fst.bin`.
  - The runtime walks a `Uint32Array` with no per-token allocation.
  - A clinical or financial hit is only escalated when two things hold:
    1. a non-public person node sits within 30 tokens of it (proximity graph);
    2. the person is a record subject (a record role such as "patient" / "customer", or an MRN / DOB / labelled ID), or the shared MiniLM-L6 INT8 context validator classifies the surrounding window as a personal disclosure rather than a general question. (Record subjects skip the validator since 2026-11-01: it had scored "Patient Harriet Lindqvist was admitted with pneumonia and started metformin 500 mg" just under its margin.)
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
| `medical.fst.bin` | ≤ 10 MB | 3.40 MB | file size (65,938 entries incl. 38,789 multilingual everyday words, 415,542 states; one ICD code per term since 2026-11-02) |
| MiniLM-L6 INT8 weights | ~23 MB | 21.9 MB | file size |
| MiniLM session in ONNX Runtime wasm | — | ≈ 80 MB | bare-page probe: 24.5 MB → 103 MB with graph optimisation, → 83.6 MB without |
| **Offscreen Path A only** (Path B evicted, recycled document) | **< 50 MB target · 150 MB ceiling** | **87.1 MB** | `measureUserAgentSpecificMemory` after a forced GC, inside the offscreen document (raw CDP), after 20 prompts (`extension-measurements-path-a.json`) |
| Path B tagger INT8 weights | — | 22.9 MB | file size (`assets/engine/pathb/model_int8.onnx`) |
| **Offscreen with the Path B tagger** (shipping state) | **150 MB ceiling** | **109.6 MB** | as above (`extension-measurements-path-b.json`); the governor's own post-load reading was 111 MB |
| Offscreen with privacy-filter loaded (q4f16, superseded) | < 150 MB (else degrade) | 958 MB → evicted | the governor's post-load reading, which triggered the eviction |
| Same, after eviction in the same document | — | 999.8 MB | session disposed, wasm heap retained (run before recycling was added) |

- **The tagger costs about its own size.** Its session added ~23 MB for 22.9 MB of INT8 weights (graph optimisation disabled), far less than the MiniLM session's overhead suggested. The shipping state is above the 105 MB warning watermark and under the ceiling.
- **Path A misses its < 50 MB target.** The MiniLM INT8 session alone costs about 80 MB of wasm memory in ONNX Runtime Web. Everything else (FST, EDM, Orama, validator anchors) adds about 7 MB. It stays under the 150 MB ceiling.
- **Graph optimisation is disabled** for the browser embedder. It saved about 20 MB, and embeddings are unchanged.
- **Transient readings during initialisation** reached about 263 MB while model buffers were in flight. The governor therefore never measures before Path A is ready, and its eviction decision waits for a reading taken *after* Path B loads (`measureFresh`).
- **Eviction.** Path B is not routable until that post-load check passes. Above the ceiling, the sequence is:
  1. The host disposes the session.
  2. The offscreen document asks the background worker to recycle it. Disposing alone left 999.8 MB allocated, because wasm linear memory never shrinks.
  3. The eviction is remembered in the document's `localStorage`, so the replacement starts on Path A without re-downloading the weights.
  4. *Force Path B* clears the memory and re-measures. A route change in flight during a recycle is answered with status, never resent, so it cannot loop.
- **Unattributed readings are rejected.** Right after a document is recreated, Chrome can resolve `measureUserAgentSpecificMemory` with only the shared bucket (6.6 MB, no JavaScript attribution for the page). That is not a reading of the document, so the governor and `measure:ext` discard it.
- **Fallback estimate.** If no browser reading arrives (an idle page may not GC for a long time), the governor adds the `performance.memory` JS heap to the size of every wasm linear memory the offscreen document created (tracked by wrapping `WebAssembly.Memory` and `instantiate`), floored at the tracked model bytes. ONNX Runtime's threaded build keeps weights and activations in a shared wasm memory that the JS heap figure does not include: with Path B loaded the heap reads 17.7 MB and the fallback 112 MB, against 109.7 MB from `measureUserAgentSpecificMemory` after a forced GC (2026-11-02). Before this, the fallback reported only the model file sizes (47 MB) and the popup showed that.
- **Steady state, confirmed (2026-11-02).** An eviction is remembered, so it must not rest on one noisy reading. A cold start once read 212 MB right after the tagger loaded (load buffers not yet collected), then 118 MB on re-runs. An over-ceiling reading must now hold on two fresh follow-ups, and the lowest one decides. Status polls (the popup) no longer start measurements while Path B is loading, because Chrome can fold such a measurement into the ceiling check's.
- **Why 150 MB.** The offscreen document is a hidden renderer on a work laptop that already runs dozens of tabs, chat and endpoint agents. Its steady state costs about 1.7–2.1× the bytes of the models and runtime it loads (measured: ~41 MB of files → 87 MB; ~66 MB → 110 MB), and a model has to be small to answer within the 1 s budget on a CPU (the 1.5B privacy-filter took 247 ms p50 and up to 2.1 s p99 per prompt on a GPU). 150 MB keeps a margin for both.

### ADR-003 — Build & packaging

- One npm package with two build targets. `scripts/build-extension.mjs` uses the Vite build API:
  - content scripts → IIFE, since MV3 content scripts cannot be ES modules;
  - the service worker, popup and offscreen document → ESM;
  - output is unminified so reviewers can read what ships.
- `vite.config.ts` builds the Workbench and copies `dist-extension/` into `dist/extension/`, so the Source workspace can ZIP it client-side with fflate.
- The ORT `wasmPaths` default points at jsDelivr (remote code). It is always overridden with extension-local URLs.

### ADR-004 — Interception strategy

- **Capture-phase hooks.** The content script installs capture-phase `keydown` (Enter without Shift, not composing), `click` (send buttons) and `submit` listeners at `document_start`.
- **The composer is the element the event came from.** Each portal serves a plain textarea that takes typing (and an early Enter, which its app sends once loaded) until the app hydrates, and for a moment it sits next to the real editor (verified 2026-11-02: ChatGPT `#pending-home-input`, Claude `#static-composer-input`, Gemini `.initial-input-area textarea`). Matching the first composer in the page let the first message after a page load skip the check, so the core now resolves the composer from the event target, and adapters list these inputs as `preloadComposerSelectors` (a clean send from one is replayed as Enter on it).
- **On send:**
  1. Tier 1 and Tier 3A run synchronously.
  2. A high-risk result blocks immediately.
  3. Otherwise the send is held while Tier 2 and 3B run in the offscreen document.
  4. On a clean verdict, a one-shot bypass re-dispatches `sendButton.click()`.
- **Large pastes.** A paste of 1,200 characters or more is captured into the `AttachmentShadowStore` before the portal turns it into a chip. A MutationObserver lifts the block when a flagged chip is removed. That is the whole story on Claude, whose "Pasted text" chip (from 4,000–5,000 characters, measured) travels inside the send request. ChatGPT turns long pastes into `pasted.txt`, a file attachment, and uploads attachments when they are attached, so a Send-time block would come after the upload: adapters with `pasteUpload` (ChatGPT, and Gemini until verified) check pastes of 4,000+ characters at paste time with the full cascade and hand clean ones to the portal unchanged (falling back to inserting the text where the editor ignores a synthetic paste, as Gemini's does).
- **Network backstop.** The MAIN-world `fetch`/XHR wrapper lets through prompt bodies whose digest the content script verified. Any other prompt (an edited message, a retry, a script, anything that skipped the composer) gets Tier 1 there and then, synchronously, and if clean, the rest of the cascade (Tier 3A, and Tier 2 + 3B offscreen) through the content script before the request is released. An XHR is held unsent until the answer arrives. If the content script does not acknowledge within 300 ms (extension reloaded), Tier 1's verdict stands.
- **Redaction.** Raw offsets are mapped to DOM Ranges, and `execCommand('insertText')` is applied last-to-first so ProseMirror/Quill editor state stays consistent.

### ADR-005 — Tier 2 latency budget

- **Context.** The send path promises a verdict within 1,000 ms. On integrated GPUs, `openai/privacy-filter` could take longer than that on long prompts. The CPU tagger that replaced it (ADR-007) answers in 7.1 / 10.6 ms (p50 / p95) inside the extension, so the budget now matters mainly when the offscreen engine is starting or unreachable.
- **The budget is counted from the Send event** (Enter, click or submit), so input collection, Tier 1 + 3A and the offscreen round trip all fit inside the 1,000 ms (the brief's "within 1 second of Send, covering everything combined"); the offscreen check gets whatever is left.
- **Measured** (`npm run measure:ext`, real content script on the fixture portal, Enter → page send handler or drawer, 2026-11-02):

  | Prompt | Path B (tagger) p50 / max | Path A only p50 / max |
  |---|---|---|
  | Clean — sent (12 prompts) | 20 / 37 ms | 17 / 39 ms |
  | Tier 2 block — drawer shown (5) | 31 / 53 ms | 28 / 54 ms |
  | Tier 1 block — drawer shown (5) | 8 / 12 ms | 8 / 17 ms |
- **Decision.** Path B keeps a 650 ms Tier 2 budget (`PATH_B_BUDGET_MS`). Past it, Path A (CPU) decides that prompt and the result carries a `degradedReason`. ONNX Runtime cannot cancel a run, so the in-flight Path B inference finishes and is discarded.
- **When the whole offscreen check misses its 1,000 ms budget or is unreachable** (Tier 1/3A already clean), the prompt is **held**, not sent (`asyncFailure: 'hold'`, the default). The drawer shows "Check incomplete" and offers *Keep editing* or *Send anyway*; Enter re-runs the check. A "send anyway" is recorded in telemetry with the reason.
  - The earlier behaviour was to fail open silently. It was changed after a live capture run (2026-11-01) in which the offscreen engine became unreachable mid-session, and Category 8/9 context prompts would have been sent unchecked; the capture's own network guard stopped them.
  - `asyncFailure: 'send'` restores fail-open for deployments that prefer it.
  - Offscreen start is bounded (10 s). A start that never settles no longer wedges every later request; the next request retries.
- **Benchmarks** call the host with `strictRoute`, so Path B quality and latency are measured as they are, never padded by Path A.

### ADR-006 — Benchmark methodology

- **One harness everywhere.** `src/engine/bench/harness.ts` runs the full cascade in Node (`npm run bench`) and in the Workbench worker. Both produce the same Path A detections.
- **Ground truth** comes from each dataset's own annotations. Dev splits were used for error analysis; held-out splits were drawn later from different offsets and are only evaluated.
- **Adjudications** correct genuinely wrong labels only, never engine behaviour. Each one carries a reason and lives in `data/datasets/enron-adjudications.json`.
- **The CI gate** (`bench-gate.json`) is a regression guard just below measured performance. Design targets are reported separately.

### ADR-007 — Path B: a compact multilingual tagger instead of privacy-filter (and not MobileBERT)

**Context.** `openai/privacy-filter` measured 958 MB in the offscreen document against a 150 MB ceiling, so the extension always evicted it. Its 8 coarse labels also caused most Path B false alarms: `account_number` was both a person and a financial fact, so two numbers formed a "customer record". The first plan's fallback was a MobileBERT clinical NER. A state-of-the-art review (2026) found three things:
- Published small-PII-model scores are mostly in-distribution, e.g. 93–96% F1 on Nemotron-PII's own test split.
- Cross-dataset results are far lower. On PII-SCOPE, privacy-filter scores F1 0.475, and a 278M XLM-R model reaches 0.70 typed recall on AI4Privacy.
- Domain-matched, fine-grained training matters more than model size.

**Options, measured** (`bench-results/bakeoff-dev.json`, dev splits only; summary in the README):
- **MobileBERT** (25.3M parameters, 24 layers, 44.5 MFLOPs/token, English uncased, no PII checkpoint) — not built. Ettin-17M needs about 1/5 of its compute per token, and the English-only candidates below already show what an English tagger gains here: little, because the held-out AI4Privacy split is 80% French, German and Italian. Its main strength, INT8 robustness, is matched by the BERT-family candidates.
- **Off-the-shelf English taggers** (Ettin-17M/32M and OpenMed-ClinicalE5-Small, all Nemotron-PII fine-tunes):
  - Ettin (ModernBERT family) loses 9–15% of token labels under INT8 dynamic quantisation, in every mode tried.
  - OpenMed keeps 99.46%, but adds 2 Enron and 3 AI4Privacy false alarms for 7 recovered positives.
- **Our tagger**:
  - Base: `microsoft/Multilingual-MiniLM-L12-H384` (MIT), with the vocabulary trimmed from 250,002 to 30,376 pieces (Ushio et al., 2023) and truncated to 6 layers.
  - Training: 145,836 synthetic documents (Nemotron-PII, CC BY 4.0; Gretel multilingual finance, Apache-2.0), 3 epochs on one RTX 3070 Ti.
  - Labels: canonical kinds shared with the engine (`tier2/neural-labels.json`).
  - Selection: on the training corpus's validation slice (micro-F1 0.9075).
  - INT8: 99.95% token agreement with fp32, 22.9 MB.
  - The 12-layer variant (micro-F1 0.9222, 33.9 MB) made identical block decisions on every dev split at twice the latency, so the 6-layer one ships.

**Decision.** Path B is the 6-layer tagger on the CPU (`device: 'cpu'`). It shares the ONNX Runtime wasm instance with MiniLM, ships in the package (`assets/engine/pathb`), and nothing is fetched at runtime. Its spans feed the same proximity graph and validator under a policy fixed by dev-split error analysis:
- Names, record IDs and DOBs are the person side. Phones and emails are excluded: help lines and team inboxes.
- Account numbers are financial facts only if they are mostly numeric, not card-shaped, and stand alone (not inside URLs, emails or file names).
- Neural card spans are ignored; Tier 1's Luhn decides cards.
- Spans below 0.7 confidence are dropped, adjacent name spans are merged before the public-figure check, and government-ID/secret findings are off.

The same analysis fixed two FST precision bugs that Path B exposed in French/Italian text:
- Everyday words from XLM-R's multilingual vocabulary no longer fuzzy-match drugs.
- RxNorm brand names match exactly only ("prochaine" ≠ procaine, "stimato" ≠ Stimate).

**Consequences** (README results, measured):
- Held-out AI4Privacy recall rises from 0.646 to 0.720 (F2 0.687 → 0.749). FPR rises 1.20% → 1.67%, and held-out Enron FPR 1.34% → 2.01%. privacy-filter had reached F2 0.770 at 14.83% FPR.
- In the extension: 110.2 MB, Tier 2 p50 / p95 13.0 / 20.5 ms, load 0.22 s.
- After the raw-brief audit (2026-11-01):
  - **Held-out AI4Privacy:** F2 0.685 → 0.747; FPR 1.44% → 1.91%.
  - **Held-out Enron FPR:** 1.34% → 2.34%.
  - **In the extension:** 110.4 MB; Tier 2 p50 / p95 6.8 / 10.7 ms.
- Path B is now gated in CI (`bench-gate.json` → `pathB`).
- Not met: the dev-split gate "F2 ≥ Path A on every split" fails on Enron dev, which has a single positive, so one false alarm moves F2 from 1.000 to 0.833. FPR there is +0.33 points.

### ADR-008 — Engine lifetime: load once, outlive the service worker

- **Context.** MV3 stops an idle service worker after about 30 s. The offscreen document is separate and has no lifetime limit for the `WORKERS` reason (only `AUDIO_PLAYBACK` documents are closed after 30 s of silence). The popup used to show "Starting…" each time it opened, because its first status reply waited up to 1.5 s for a fresh memory reading, which looked like a reload.
- **Decision.**
  - The engine is created once: on browser start (`onStartup`, which is also what makes Chrome start the worker then), on install, and on any worker start if it is missing. Every later wake-up only checks that the document exists. Nothing closes it except an over-ceiling eviction (recycle) or the user disabling the extension.
  - Every tab and portal shares the one engine; content scripts hold only Tier 1 and Tier 3A.
  - The content script sends a `warm` message when the composer gets focus, so a worker cold start is not paid inside the Send budget.
  - The popup draws the last status from `chrome.storage.session` at once, asks for a quick status (newest memory reading, no wait), and shows when the engine was loaded.
  - The extension no longer asks for a WebGPU adapter: Path B runs on the CPU, and the request only woke the GPU process and logged Chrome's "powerPreference is ignored on Windows" warning on the extensions page.
- **Verified.** An e2e test stops the service worker through CDP the way Chrome does when it is idle and checks that the engine's `startedAt` is unchanged afterwards.

## 4. Known risks

- **Selector and endpoint drift.** Live portal DOM selectors and completion endpoints change without notice. They are isolated per portal in `content/adapters/`.
- **Gemini request bodies** (`f.req`) are nested, form-encoded JSON. The extractor is best-effort and falls back to scanning the whole body.
- **ICD-10 ambiguity.** Some terms are ambiguous ("fall", "cold"). This is handled by a stoplist, the proximity rule and the validator, and precision is measured rather than assumed.
