"""Packages a trained, exported tagger as the shipped Path B model: assets/engine/pathb/
(model_int8.onnx, tokenizer.json, tagger.json). Both builds copy assets/engine into their output.

Usage: .venv/Scripts/python scripts/ml/package_pathb.py <trained model dir> [--max-len 512]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

from common import ROOT


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("model_dir", type=Path)
    ap.add_argument("--max-len", type=int, default=512)
    args = ap.parse_args()
    out = ROOT / "assets" / "engine" / "pathb"
    out.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(args.model_dir / "onnx" / "model_int8.onnx", out / "model_int8.onnx")
    shutil.copyfile(args.model_dir / "tokenizer.json", out / "tokenizer.json")
    config = json.loads((args.model_dir / "config.json").read_text(encoding="utf-8"))
    training = json.loads((args.model_dir / "training.json").read_text(encoding="utf-8"))
    labels = [config["id2label"][str(i)] for i in range(len(config["id2label"]))]
    manifest = {
        "modelId": f"aionix-pathb-{training['layers']}L (Multilingual-MiniLM, trimmed vocab, INT8)",
        "model": "model_int8.onnx",
        "tokenizer": "tokenizer.json",
        "labels": labels,
        "clsId": 0,
        "sepId": 2,
        "maxLength": args.max_len,
        "provenance": {
            "base": "microsoft/Multilingual-MiniLM-L12-H384 (MIT)",
            "layers": training["layers"],
            "vocab": config["vocab_size"],
            "trainingData": ["nvidia/Nemotron-PII (CC BY 4.0)", "gretelai/synthetic_pii_finance_multilingual (Apache-2.0)"],
            "selectedOn": "training-corpus validation slice",
            "valMicroF1": round(training["valMicroF1"], 4),
            "epoch": training["epoch"],
            "sha256": {"model_int8.onnx": sha256(out / "model_int8.onnx"), "tokenizer.json": sha256(out / "tokenizer.json")},
        },
    }
    (out / "tagger.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"packaged {manifest['modelId']} -> {out} ({(out / 'model_int8.onnx').stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
