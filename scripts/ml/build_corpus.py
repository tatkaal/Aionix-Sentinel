"""Builds the Path B training corpus from permissively licensed synthetic PII data:
  - nvidia/Nemotron-PII (CC BY 4.0, English, 30 domains incl. healthcare)
  - gretelai/synthetic_pii_finance_multilingual (Apache-2.0; en, fr, de, it, es, nl, sv)
AI4Privacy is deliberately excluded: its licence is non-commercial and it is our held-out benchmark.
Labels are mapped to the engine's canonical kinds (src/engine/tier2/neural-labels.json).

Usage: .venv/Scripts/python scripts/ml/build_corpus.py
Writes .cache/ml/corpus/{train,val}.jsonl and stats.json.
"""
from __future__ import annotations

import ast
import json
import random
from collections import Counter

from datasets import load_dataset

from common import CACHE, canonical

OUT = CACHE / "corpus"
VAL_SHARE = 0.03
SEED = 7


def clean(text: str, spans: list[dict]) -> list[dict]:
    """Canonical, in-bounds, non-overlapping spans (longest wins)."""
    kept: list[dict] = []
    for s in sorted(spans, key=lambda s: (s["start"], -(s["end"] - s["start"]))):
        kind = canonical(s["label"])
        start, end = int(s["start"]), int(s["end"])
        if not kind or not (0 <= start < end <= len(text)):
            continue
        if kept and start < kept[-1]["end"]:
            continue
        kept.append({"start": start, "end": end, "kind": kind})
    return kept


def nemotron():
    for r in load_dataset("nvidia/Nemotron-PII", split="train", cache_dir=str(CACHE / "hf")):
        yield {"text": r["text"], "spans": clean(r["text"], ast.literal_eval(r["spans"])), "source": "nemotron", "lang": "English", "domain": r["domain"]}


def gretel():
    for r in load_dataset("gretelai/synthetic_pii_finance_multilingual", split="train", cache_dir=str(CACHE / "hf")):
        text = r["generated_text"]
        yield {"text": text, "spans": clean(text, json.loads(r["pii_spans"])), "source": "gretel", "lang": r["language"], "domain": r["domain"]}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    rng = random.Random(SEED)
    rows = [*nemotron(), *gretel()]
    rng.shuffle(rows)
    n_val = int(len(rows) * VAL_SHARE)
    splits = {"val": rows[:n_val], "train": rows[n_val:]}
    stats: dict = {}
    for name, part in splits.items():
        (OUT / f"{name}.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in part) + "\n", encoding="utf-8")
        stats[name] = {
            "rows": len(part),
            "bySource": Counter(r["source"] for r in part),
            "byLang": Counter(r["lang"] for r in part),
            "byKind": Counter(s["kind"] for r in part for s in r["spans"]),
        }
    (OUT / "stats.json").write_text(json.dumps(stats, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(stats, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
