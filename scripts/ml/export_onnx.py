"""Exports a Hugging Face token classifier to ONNX (fp32) plus a dynamic INT8 copy for ONNX Runtime Web,
then checks INT8 against fp32 on sample texts (argmax agreement, max logit drift).

Usage: .venv/Scripts/python scripts/ml/export_onnx.py <model dir> [--max-len 512] [--per-channel] [--keep-embeddings]
Writes <model dir>/onnx/model.onnx and <model dir>/onnx/model_int8.onnx.
  --per-channel      per-output-channel weight scales (narrow models lose less)
  --keep-embeddings  leave the embedding Gather in fp32 (bigger file, embeddings not quantized)
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from onnxruntime.quantization import QuantType, quantize_dynamic
from transformers import AutoModelForTokenClassification, AutoTokenizer

from common import CACHE

SAMPLES = [
    "Discharge summary for patient Harriet Lindqvist: admitted with pneumonia, MRN 4471209.",
    "Hi Tracy, noticed a large transaction from account number 72993227, can you confirm it?",
    "Bonjour Amélie, votre mot de passe temporaire est Xk9#pL2q, merci de le changer.",
    "What are the common early symptoms of type 2 diabetes?",
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("model_dir", type=Path)
    ap.add_argument("--max-len", type=int, default=512)
    ap.add_argument("--per-channel", action="store_true")
    ap.add_argument("--keep-embeddings", action="store_true")
    ap.add_argument("--skip-export", action="store_true", help="re-quantize an existing model.onnx")
    args = ap.parse_args()
    out = args.model_dir / "onnx"
    out.mkdir(exist_ok=True)

    tok = AutoTokenizer.from_pretrained(args.model_dir)
    model = AutoModelForTokenClassification.from_pretrained(args.model_dir, attn_implementation="eager").eval().float()
    enc = tok(SAMPLES[0], return_tensors="pt")
    names = [n for n in ("input_ids", "attention_mask", "token_type_ids") if n in enc]
    dynamic = {n: {0: "batch", 1: "sequence"} for n in names} | {"logits": {0: "batch", 1: "sequence"}}
    fp32 = out / "model.onnx"
    if not args.skip_export:
        with torch.no_grad():
            torch.onnx.export(model, tuple(enc[n] for n in names), str(fp32), input_names=names, output_names=["logits"], dynamic_axes=dynamic, opset_version=17, dynamo=False)
    int8 = out / "model_int8.onnx"
    ops = ["MatMul", "Gemm"] if args.keep_embeddings else None
    quantize_dynamic(str(fp32), str(int8), weight_type=QuantType.QInt8, per_channel=args.per_channel, **({"op_types_to_quantize": ops} if ops else {}))

    s32 = ort.InferenceSession(str(fp32), providers=["CPUExecutionProvider"])
    s8 = ort.InferenceSession(str(int8), providers=["CPUExecutionProvider"])
    agree = total = 0
    drift = 0.0
    val = CACHE / "corpus" / "val.jsonl"
    extra = [json.loads(l)["text"][:1500] for l in val.read_text(encoding="utf-8").splitlines()[:150]] if val.exists() else []
    for text in SAMPLES + extra:
        e = tok(text, return_tensors="np", truncation=True, max_length=args.max_len)
        feeds = {n: e[n].astype(np.int64) for n in names}
        a, b = s32.run(None, feeds)[0], s8.run(None, feeds)[0]
        agree += int((a.argmax(-1) == b.argmax(-1)).sum())
        total += a.shape[1]
        drift = max(drift, float(np.abs(a - b).max()))
        with torch.no_grad():
            ref = model(**{n: torch.from_numpy(feeds[n]) for n in names}).logits.numpy()
        assert np.abs(ref - a).max() < 1e-2 and (ref.argmax(-1) == a.argmax(-1)).all(), "fp32 ONNX diverges from PyTorch"
    mode = ("per-channel" if args.per_channel else "per-tensor") + (", fp32 embeddings" if args.keep_embeddings else "")
    (out / "quantization.json").write_text(json.dumps({"fp32MB": round(fp32.stat().st_size / 1e6, 1), "int8MB": round(int8.stat().st_size / 1e6, 1), "mode": mode, "argmaxAgreement": round(agree / total, 4), "tokens": total, "maxLogitDrift": round(drift, 2)}, indent=2), encoding="utf-8")
    print(f"{args.model_dir.name}: fp32 {fp32.stat().st_size / 1e6:.1f} MB, int8 ({mode}) {int8.stat().st_size / 1e6:.1f} MB, argmax agreement {agree}/{total} = {agree / total:.2%}, max logit drift {drift:.2f}")


if __name__ == "__main__":
    main()
