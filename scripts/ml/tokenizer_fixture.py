"""Writes tests/fixtures/unigram-parity.json: reference ids + offsets from Hugging Face `tokenizers`
for the Path B tokenizer, so tests/unit/unigram.test.ts can hold the TS tokenizer to exact parity.
Texts are synthetic (no licensed benchmark data).

Usage: .venv/Scripts/python scripts/ml/tokenizer_fixture.py <tokenizer.json>
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from tokenizers import Tokenizer

from common import ROOT

TEXTS = [
    "Discharge summary for patient Harriet Lindqvist: admitted with pneumonia, MRN 4471209.",
    "Hi Tracy, noticed a large transaction from account number 72993227 — can you confirm?",
    "Bonjour Amélie, votre mot de passe temporaire est Xk9#pL2q ; merci de le changer.",
    "Sehr geehrte Frau Müller, Ihre IBAN DE89 3704 0044 0532 0130 00 wurde geändert.",
    "Gentile Sig. Rossi, il codice fiscale RSSMRA85T10A562S risulta già registrato.",
    "Estimado Sr. García: su número de cuenta es ES91 2100 0418 4502 0005 1332.",
    "Contact: jane.o'neil+billing@example.co.uk, tel. +61 (0)412-555-019, DOB 03/07/1984",
    "Line one\nline two\ttabbed nbsp em-space  double  spaces",
    "zero​width sep​arators and emoji 🙂 inside te🙂xt, plus ﬁ ligature",
    "パスワード: hunter2 · 密码 = 'correct horse battery staple'",
    "   leading and trailing whitespace   ",
    "",
    "AKIAIOSFODNN7EXAMPLE wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    "Ünïcödé çàñ bé tŕíçký: Œuvre, Ærø, Łódź, İstanbul, ß",
]


def main() -> None:
    tok = Tokenizer.from_file(sys.argv[1])
    cases = []
    for text in TEXTS:
        enc = tok.encode(text, add_special_tokens=False)
        # Code-point offsets → UTF-16 code units, as the engine indexes strings.
        utf16 = [0]
        for ch in text:
            utf16.append(utf16[-1] + (2 if ord(ch) > 0xFFFF else 1))
        cases.append({"text": text, "ids": enc.ids, "offsets": [[utf16[s], utf16[e]] for s, e in enc.offsets]})
    out = ROOT / "tests" / "fixtures" / "unigram-parity.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(cases, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {out} ({len(cases)} cases)")


if __name__ == "__main__":
    main()
