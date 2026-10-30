"""Runs an ONNX token classifier over benchmark splits and caches entity spans (exact character
offsets) plus per-observation CPU latency. scripts/bakeoff.ts replays the spans through the real
engine graph, so candidates are compared inside the shipping cascade.

Usage: .venv/Scripts/python scripts/ml/tag_datasets.py <model dir> [--onnx model_int8.onnx]
       [--threads 4] [--max-len 512] [--holdout]
Dev splits only unless --holdout (held-out splits are scored once, after selection).
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
from transformers import AutoConfig, AutoTokenizer

from common import CACHE, DEV_SPLITS, HOLDOUT_SPLITS, load_split, texts_of

STRIDE = 64


def softmax(x: np.ndarray) -> np.ndarray:
    e = np.exp(x - x.max(-1, keepdims=True))
    return e / e.sum(-1, keepdims=True)


class Tagger:
    def __init__(self, model_dir: Path, onnx_file: str, threads: int, max_len: int):
        self.tok = AutoTokenizer.from_pretrained(model_dir)
        self.id2label = {int(k): v for k, v in AutoConfig.from_pretrained(model_dir).id2label.items()}
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = threads
        self.session = ort.InferenceSession(str(model_dir / "onnx" / onnx_file), opts, providers=["CPUExecutionProvider"])
        self.inputs = {i.name for i in self.session.get_inputs()}
        self.max_len = max_len

    def tag(self, text: str) -> tuple[list[dict], float, int]:
        t0 = time.perf_counter()
        enc = self.tok(text, add_special_tokens=False, return_offsets_mapping=True)
        ids, offsets = enc["input_ids"], enc["offset_mapping"]
        n = len(ids)
        body = self.max_len - 2
        probs = np.zeros((n, len(self.id2label)), dtype=np.float32)
        start = 0
        while start < max(n, 1):
            end = min(n, start + body)
            window = [self.tok.cls_token_id, *ids[start:end], self.tok.sep_token_id]
            feeds = {"input_ids": np.array([window], dtype=np.int64), "attention_mask": np.ones((1, len(window)), dtype=np.int64)}
            if "token_type_ids" in self.inputs:
                feeds["token_type_ids"] = np.zeros((1, len(window)), dtype=np.int64)
            p = softmax(self.session.run(["logits"], feeds)[0][0][1:-1])
            # Keep each token from the window where it is furthest from an edge.
            keep_from = start if start == 0 else start + STRIDE // 2
            keep_to = end if end == n else end - STRIDE // 2
            probs[keep_from:keep_to] = p[keep_from - start : keep_to - start]
            if end == n:
                break
            start = end - STRIDE
        ms = (time.perf_counter() - t0) * 1000
        return self.decode(probs, offsets), ms, n

    def decode(self, probs: np.ndarray, offsets: list[tuple[int, int]]) -> list[dict]:
        spans: list[dict] = []
        cur: dict | None = None
        for i, row in enumerate(probs):
            label = self.id2label[int(row.argmax())]
            s, e = offsets[i]
            if label == "O" or e <= s:
                if label == "O":
                    cur = None
                continue
            prefix, kind = (label.split("-", 1) + [""])[:2] if "-" in label else ("B", label)
            if cur and kind == cur["label"] and prefix in ("I", "E"):
                cur["end"] = e
                cur["_p"].append(float(row.max()))
            else:
                cur = {"label": kind, "start": s, "end": e, "_p": [float(row.max())]}
                spans.append(cur)
        for sp in spans:
            sp["score"] = round(float(np.mean(sp.pop("_p"))), 4)
        return spans


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("model_dir", type=Path)
    ap.add_argument("--onnx", default="model_int8.onnx")
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--max-len", type=int, default=512)
    ap.add_argument("--name", default=None)
    ap.add_argument("--holdout", action="store_true")
    args = ap.parse_args()
    tagger = Tagger(args.model_dir, args.onnx, args.threads, args.max_len)
    name = args.name or f"{args.model_dir.name}__{Path(args.onnx).stem}"
    out_dir = CACHE / "ner" / name
    out_dir.mkdir(parents=True, exist_ok=True)
    for _ in range(3):
        tagger.tag("Warm-up: patient Ana Lee, account 12345678.")
    splits = HOLDOUT_SPLITS if args.holdout else DEV_SPLITS
    for split, file in splits.items():
        rows, lat = [], []
        for sample in load_split(file):
            for oid, text in texts_of(sample):
                ents, ms, ntok = tagger.tag(text)
                # Python offsets count code points; the engine indexes UTF-16 code units.
                utf16 = [0]
                for ch in text:
                    utf16.append(utf16[-1] + (2 if ord(ch) > 0xFFFF else 1))
                for en in ents:
                    en["start"], en["end"] = utf16[en["start"]], utf16[en["end"]]
                rows.append({"id": oid, "text": text, "entities": ents, "ms": round(ms, 3), "tokens": ntok})
                lat.append(ms)
        (out_dir / f"{split}.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")
        print(f"{name} {split}: {len(rows)} texts · p50 {np.percentile(lat, 50):.1f} ms · p95 {np.percentile(lat, 95):.1f} ms")
    quant = args.model_dir / "onnx" / "quantization.json"
    meta = {
        "model": args.model_dir.name,
        "onnx": args.onnx,
        "onnxMB": round((args.model_dir / "onnx" / args.onnx).stat().st_size / 1e6, 1),
        "quantization": json.loads(quant.read_text(encoding="utf-8")) if quant.exists() and "int8" in args.onnx else None,
        "threads": args.threads,
        "maxLen": args.max_len,
        "runtime": f"onnxruntime {ort.__version__} CPU",
    }
    (out_dir / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
