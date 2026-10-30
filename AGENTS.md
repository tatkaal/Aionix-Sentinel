# AGENTS.md — Aionix Sentinel agent guide

Aionix Sentinel is a Manifest V3 Chrome extension that inspects prompts on claude.ai, chatgpt.com and gemini.google.com and blocks high-risk corporate data before it leaves the browser. A React "Workbench" (6 workspaces) demonstrates, benchmarks and packages it. The design rationale lives in [docs/architecture.md](docs/architecture.md); read it before changing engine behaviour.

## Commands

| Command | What it does |
|---|---|
| `npm run setup` | Fetches MiniLM INT8 + ORT wasm, rebuilds `medical.fst.bin` (ICD-10-CM + RxNorm), the vault indexes and the datasets, renders icons (network required). `assets/engine/*` and most datasets are committed, so a fresh clone only *needs* `npm run data:models && npm run data:datasets` |
| `npm run dev` | Workbench dev server (cross-origin isolated) |
| `npm run build` | `build:ext` (tsx → `dist-extension/`) then `build:web` (→ `dist/`, embeds the extension for the ZIP packager) |
| `npm run typecheck` / `npm test` | TypeScript 7 strict check / Vitest unit suite |
| `npm run bench` / `npm run bench:gate` | Node benchmark, full cascade on Path A → `bench-results/path-a.json`; `:gate` exits non-zero below `bench-gate.json` |
| `npm run build:ext:test && npm run test:e2e` | Playwright loads the test build (adds `localhost:4173` matches, open shadow root) against `tests/e2e/fixtures/portal.html` |

## Layout

- `src/engine/` — **pure TypeScript, no DOM or `chrome.*`**. Shared by the extension, the Workbench worker and the Node bench, so benchmarks exercise the shipping engine. Keep it that way.
- `src/extension/` — MV3 surfaces: `content/` (isolated world), `main-world-interceptor.ts`, `background-sw.ts`, `offscreen-onnx-worker.ts`, `popup.tsx`.
- `src/workbench/` — React 19 SPA; `workspaces/<name>/` per workspace, `state/` zustand stores, `workers/engine.worker.ts` mirrors the offscreen document.
- `src/shared/brand/` — logo path data and design tokens (single source for React and Shadow DOM).
- `scripts/` — build + data pipelines. `assets/` — runtime binaries served to both targets (`models/`, `ort/` are gitignored and fetched).
- `data/` — vault documents, lexicons, benchmark datasets.

## Non-negotiables

1. **Git**: commits are attributed only to the local git user. Never add `Co-Authored-By` or any AI trailer. Conventional Commits, one short subject line (`feat(engine): …`, `fix: …`, `docs: …`).
2. **Zero remote code**: ORT wasm is served from the extension (`wasmPaths` → `chrome.runtime.getURL('ort/')`). Only Path B model *weights* (data) may be fetched from the Hugging Face Hub.
3. **Memory**: offscreen ceiling 150 MB (warn 105 MB). Path A target < 50 MB. Path B is evicted/degraded to Path A if the steady-state host footprint exceeds the ceiling. Report measured numbers, never assumed ones.
4. **Honest metrics**: every number shown in Benchmarks, Telemetry and the Presentation comes from an actual run. Blueprint figures may only appear labelled as *targets*.
5. **Zero-knowledge telemetry**: store category, tier, path, portal, latency, timestamp and a salted truncated hash. Never raw prompt text or secrets.
6. **Content script stays React-free** and synchronous for Tier 1 + Tier 3A; anything async goes to the offscreen document.

## Brand

- Logo: `src/shared/brand/logo-paths.ts` (exact 4-path `viewBox="0 0 327 255"` mark). React → `<AionixLogo/>`; Shadow DOM → `aionixLogoMarkup()`.
- Palette (60-30-10): canvas `#090A10`; surfaces `#11131F` / `#181B2C`; text `#F8FAFC`; hairlines `rgba(149,83,251,.14)` / `rgba(255,255,255,.08)`; brand `#5921c3` (hover `#6b2ce0`) + `#9553fb` (active/focus); crimson `#EF4444` = high-risk block, amber `#F59E0B` = contextual/fallback, emerald `#10B981` = clean/gate pass.
- Type: Plus Jakarta Sans (display 600/700, `text-wrap: balance`), DM Sans (body), JetBrains Mono + `tabular-nums` (metrics, hashes, latency, code).
- Single-elevation surfaces: no nested cards, no `border-l-4` accent stripes.

## Benchmark honesty

- `dev` splits (`enron`, `presidio`, `ai4privacy`) were used for error analysis; `*-holdout` splits were not. Never tune rules on held-out misclassifications. Only correct wrong ground truth via `data/datasets/enron-adjudications.json` with a reason.
- Ground truth comes from each dataset's own labels (see `docs/datasets.md`), never from the engine.

## Engine conventions

- Findings carry **raw** offsets (`rawStart`/`rawEnd`) mapped through `normToRawIdx`; redaction and the drawer depend on them.
- Category ids are fixed (1–10, see `src/engine/types.ts`); don't renumber.
- New detectors need a vitest case in `tests/unit/` and, if they change block decisions, an edge case in `data/datasets/edge-cases.json`.
- Portal selectors live only in `src/extension/content/adapters/*`. When a live site changes, update the adapter, not the core.
