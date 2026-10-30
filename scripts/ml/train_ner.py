"""Fine-tunes a compact encoder as the Path B token classifier (BIO over the canonical kinds).

Usage: .venv/Scripts/python scripts/ml/train_ner.py <base model dir> <out dir>
       [--layers 6] [--epochs 3] [--lr 1e-4] [--max-len 256] [--batch 32] [--limit N]
The checkpoint is selected on the corpus's own validation slice (.cache/ml/corpus/val.jsonl) —
never on benchmark splits.
"""
from __future__ import annotations

import argparse
import json
import math
import random
import time
from pathlib import Path

import numpy as np
import torch
from seqeval.metrics import classification_report, f1_score
from torch.utils.data import DataLoader
from transformers import AutoModelForTokenClassification, AutoTokenizer, get_linear_schedule_with_warmup

from common import CACHE, KINDS

LABELS = ["O"] + [f"{p}-{k}" for k in KINDS for p in ("B", "I")]
L2I = {l: i for i, l in enumerate(LABELS)}
STRIDE = 64


def load(split: str, limit: int | None) -> list[dict]:
    rows = [json.loads(l) for l in (CACHE / "corpus" / f"{split}.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    return rows[:limit] if limit else rows


def encode(rows: list[dict], tok, max_len: int) -> list[dict]:
    """Token windows with BIO labels from character spans; -100 on special tokens."""
    out = []
    body = max_len - 2
    for r in rows:
        enc = tok(r["text"], add_special_tokens=False, return_offsets_mapping=True)
        ids, offs = enc["input_ids"], enc["offset_mapping"]
        labels = [L2I["O"]] * len(ids)
        spans = r["spans"]
        j = 0
        prev = -1  # span index of the previous labelled token
        for i, (s, e) in enumerate(offs):
            if e <= s:
                continue
            while j < len(spans) and spans[j]["end"] <= s:
                j += 1
            if j < len(spans) and spans[j]["start"] < e:
                labels[i] = L2I[f"{'I' if prev == j else 'B'}-{spans[j]['kind']}"]
                prev = j
            else:
                prev = -1
        start = 0
        while True:
            end = min(len(ids), start + body)
            out.append({
                "input_ids": [tok.cls_token_id, *ids[start:end], tok.sep_token_id],
                "labels": [-100, *labels[start:end], -100],
            })
            if end >= len(ids):
                break
            start = end - STRIDE
    return out


def collate(batch: list[dict], pad_id: int):
    n = max(len(b["input_ids"]) for b in batch)
    ids = torch.full((len(batch), n), pad_id, dtype=torch.long)
    lab = torch.full((len(batch), n), -100, dtype=torch.long)
    att = torch.zeros((len(batch), n), dtype=torch.long)
    for i, b in enumerate(batch):
        k = len(b["input_ids"])
        ids[i, :k] = torch.tensor(b["input_ids"])
        lab[i, :k] = torch.tensor(b["labels"])
        att[i, :k] = 1
    return {"input_ids": ids, "attention_mask": att, "labels": lab}


def evaluate(model, loader, device) -> tuple[float, str]:
    model.eval()
    gold, pred = [], []
    with torch.no_grad():
        for batch in loader:
            batch = {k: v.to(device) for k, v in batch.items()}
            with torch.autocast(device_type=device.type, dtype=torch.float16, enabled=device.type == "cuda"):
                logits = model(input_ids=batch["input_ids"], attention_mask=batch["attention_mask"]).logits
            p = logits.argmax(-1).cpu().numpy()
            g = batch["labels"].cpu().numpy()
            for pi, gi in zip(p, g):
                m = gi != -100
                gold.append([LABELS[x] for x in gi[m]])
                pred.append([LABELS[x] for x in pi[m]])
    model.train()
    return f1_score(gold, pred), classification_report(gold, pred, digits=3)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("base", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--layers", type=int, default=0, help="keep only the first N encoder layers (0 = all)")
    ap.add_argument("--epochs", type=int, default=3)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--max-len", type=int, default=256)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()
    random.seed(0)
    np.random.seed(0)
    torch.manual_seed(0)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    tok = AutoTokenizer.from_pretrained(args.base)
    model = AutoModelForTokenClassification.from_pretrained(
        args.base, num_labels=len(LABELS), id2label=dict(enumerate(LABELS)), label2id=L2I, ignore_mismatched_sizes=True
    )
    if args.layers:
        enc = getattr(model, model.base_model_prefix).encoder
        enc.layer = enc.layer[: args.layers]
        model.config.num_hidden_layers = args.layers
    model.to(device)

    t0 = time.time()
    train = encode(load("train", args.limit), tok, args.max_len)
    val = encode(load("val", args.limit and max(200, args.limit // 30)), tok, args.max_len)
    print(f"encoded {len(train)} train / {len(val)} val windows in {time.time() - t0:.0f}s")
    pad = tok.pad_token_id
    tl = DataLoader(train, batch_size=args.batch, shuffle=True, collate_fn=lambda b: collate(b, pad))
    vl = DataLoader(val, batch_size=64, collate_fn=lambda b: collate(b, pad))

    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    steps = args.epochs * math.ceil(len(train) / args.batch)
    sched = get_linear_schedule_with_warmup(opt, int(0.06 * steps), steps)
    scaler = torch.amp.GradScaler(enabled=device.type == "cuda")
    best = -1.0
    for epoch in range(args.epochs):
        t0 = time.time()
        for step, batch in enumerate(tl):
            batch = {k: v.to(device) for k, v in batch.items()}
            with torch.autocast(device_type=device.type, dtype=torch.float16, enabled=device.type == "cuda"):
                loss = model(**batch).loss
            scaler.scale(loss).backward()
            scaler.unscale_(opt)
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            scaler.step(opt)
            scaler.update()
            opt.zero_grad(set_to_none=True)
            sched.step()
            if step % 500 == 0:
                print(f"epoch {epoch + 1} step {step}/{len(tl)} loss {loss.item():.4f}", flush=True)
        f1, report = evaluate(model, vl, device)
        print(f"epoch {epoch + 1}: val micro-F1 {f1:.4f} ({time.time() - t0:.0f}s)\n{report}", flush=True)
        if f1 > best:
            best = f1
            args.out.mkdir(parents=True, exist_ok=True)
            model.save_pretrained(args.out)
            tok.save_pretrained(args.out)
            (args.out / "training.json").write_text(json.dumps({"base": str(args.base), "layers": args.layers or model.config.num_hidden_layers, "epoch": epoch + 1, "valMicroF1": f1, "args": {k: str(v) for k, v in vars(args).items()}}, indent=2), encoding="utf-8")
    print(f"best val micro-F1 {best:.4f} → {args.out}")


if __name__ == "__main__":
    main()
