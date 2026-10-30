"""Shared helpers for the Path B model pipeline (bake-off, training, export).

Runs in the project venv (`.venv`, see docs/architecture.md ADR-007). The label map is the engine's
own `src/engine/tier2/neural-labels.json`, so training, tagging and the TS graph agree on kinds.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / ".cache" / "ml"
MODELS = CACHE / "models"
DATASETS = ROOT / "data" / "datasets"

# Benchmark splits a model may be *selected* on. Held-out splits are scored once, at the end.
DEV_SPLITS = {"edge": "edge-cases.json", "enron": "enron.jsonl", "presidio": "presidio.jsonl", "ai4privacy": "ai4privacy.jsonl"}
HOLDOUT_SPLITS = {"enron-holdout": "enron-holdout.jsonl", "ai4privacy-holdout": "ai4privacy-holdout.jsonl"}

LABELS = json.loads((ROOT / "src" / "engine" / "tier2" / "neural-labels.json").read_text(encoding="utf-8"))
KINDS: list[str] = LABELS["kinds"]
SOURCE_MAP: dict[str, str] = LABELS["map"]


def canonical(label: str) -> str | None:
    bare = label.split("-", 1)[1] if label[:2] in ("B-", "I-", "E-", "S-") else label
    bare = bare.lower()
    return bare if bare in KINDS else SOURCE_MAP.get(bare)


def load_split(file: str) -> list[dict]:
    path = DATASETS / file
    text = path.read_text(encoding="utf-8")
    return json.loads(text) if file.endswith(".json") else [json.loads(line) for line in text.splitlines() if line.strip()]


def texts_of(sample: dict) -> list[tuple[str, str]]:
    """(observation id, text) pairs, matching the TS harness: multi-step samples, attachments too."""
    out: list[tuple[str, str]] = []
    steps = sample.get("steps") or [sample]
    for i, st in enumerate(steps):
        oid = f"{sample['id']}#{i + 1}" if sample.get("steps") else sample["id"]
        out.append((oid, st.get("text", "")))
        for a in st.get("attachments") or []:
            out.append((f"{oid}@{a['id']}", a["text"]))
    return out
