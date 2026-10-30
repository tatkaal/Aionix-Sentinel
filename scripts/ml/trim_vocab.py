"""Vocabulary trimming (Ushio et al., EMNLP Findings 2023) for an XLM-R-vocabulary encoder.

The 250k-piece embedding table is ~80% of Multilingual-MiniLM's parameters. Keeping the pieces the
training corpus actually uses (plus single-character pieces for Latin scripts, digits and
punctuation, so any word still segments) shrinks it to a size the extension can afford.

The trimmed tokenizer uses a pipeline the TypeScript runtime reproduces exactly
(src/engine/embed/unigram.ts): no normaliser, split on Unicode whitespace, '▁' prefix per word,
Unigram Viterbi over the kept pieces (original log-probabilities).

Usage: .venv/Scripts/python scripts/ml/trim_vocab.py <model dir> <tokenizer.json> <out dir> [--top 30000]
"""
from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path

import torch
from tokenizers import Tokenizer
from transformers import AutoModel, PreTrainedTokenizerFast

from common import CACHE

SPECIALS = ["<s>", "<pad>", "</s>", "<unk>"]


def pipeline(tok_json: dict, vocab: list[list], unk_id: int) -> dict:
    t = dict(tok_json)
    t["normalizer"] = None
    t["pre_tokenizer"] = {
        "type": "Sequence",
        "pretokenizers": [{"type": "WhitespaceSplit"}, {"type": "Metaspace", "replacement": "▁", "prepend_scheme": "always", "split": True}],
    }
    t["model"] = {"type": "Unigram", "unk_id": unk_id, "vocab": vocab, "byte_fallback": False}
    t["decoder"] = {"type": "Metaspace", "replacement": "▁", "prepend_scheme": "always", "split": True}
    t["post_processor"] = {"type": "RobertaProcessing", "sep": ["</s>", 2], "cls": ["<s>", 0], "trim_offsets": True, "add_prefix_space": True}
    t["added_tokens"] = [{"id": i, "content": s, "single_word": False, "lstrip": False, "rstrip": False, "normalized": False, "special": True} for i, s in enumerate(SPECIALS)]
    t["truncation"] = None
    t["padding"] = None
    return t


def keep_char(c: str) -> bool:
    o = ord(c)
    return o < 0x250 or 0x2000 <= o <= 0x20CF or 0x2100 <= o <= 0x214F  # Latin + Latin-1/Ext-A/B, punctuation, currency, letterlike


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("model_dir", type=Path)
    ap.add_argument("tokenizer_json", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--top", type=int, default=30000)
    args = ap.parse_args()

    base = json.loads(args.tokenizer_json.read_text(encoding="utf-8"))
    pieces: list[list] = base["model"]["vocab"]
    full = Tokenizer.from_str(json.dumps(pipeline(base, pieces, base["model"]["unk_id"])))

    counts: Counter[int] = Counter()
    for split in ("train", "val"):
        for line in (CACHE / "corpus" / f"{split}.jsonl").read_text(encoding="utf-8").splitlines():
            if line.strip():
                counts.update(full.encode(json.loads(line)["text"], add_special_tokens=False).ids)
    specials = {i for i, (p, _) in enumerate(pieces) if p in SPECIALS}
    singles = {i for i, (p, _) in enumerate(pieces) if len(p.lstrip("▁")) == 1 and keep_char(p.lstrip("▁"))}
    frequent = [i for i, _ in counts.most_common(args.top)]
    kept = sorted(specials | singles | set(frequent))
    # Specials keep ids 0..3 (they are first in XLM-R's vocab).
    assert [pieces[i][0] for i in kept[:4]] == SPECIALS, [pieces[i][0] for i in kept[:4]]
    new_vocab = [pieces[i] for i in kept]
    trimmed = pipeline(base, new_vocab, 3)

    model = AutoModel.from_pretrained(args.model_dir)
    emb = model.get_input_embeddings()
    weight = emb.weight.data[torch.tensor(kept)].clone()
    new_emb = torch.nn.Embedding(len(kept), weight.shape[1], padding_idx=1)
    new_emb.weight.data = weight
    model.set_input_embeddings(new_emb)
    model.config.vocab_size = len(kept)
    model.config.pad_token_id = 1
    args.out.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(args.out)
    (args.out / "tokenizer.json").write_text(json.dumps(trimmed, ensure_ascii=False), encoding="utf-8")
    fast = PreTrainedTokenizerFast(tokenizer_file=str(args.out / "tokenizer.json"), bos_token="<s>", eos_token="</s>", unk_token="<unk>", pad_token="<pad>", cls_token="<s>", sep_token="</s>", mask_token="<unk>")
    fast.save_pretrained(args.out)

    # Coverage report: how often the trimmed tokenizer falls back to <unk> on the validation corpus.
    small = Tokenizer.from_file(str(args.out / "tokenizer.json"))
    unk = tot = 0
    for line in (CACHE / "corpus" / "val.jsonl").read_text(encoding="utf-8").splitlines()[:2000]:
        if line.strip():
            ids = small.encode(json.loads(line)["text"], add_special_tokens=False).ids
            unk += ids.count(3)
            tot += len(ids)
    params = sum(p.numel() for p in model.parameters())
    print(f"kept {len(kept)} of {len(pieces)} pieces (top {args.top} + {len(singles)} single chars) · params {params / 1e6:.1f}M · val <unk> rate {unk / max(tot, 1):.4%}")


if __name__ == "__main__":
    main()
