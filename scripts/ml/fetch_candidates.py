"""Downloads the off-the-shelf Path B candidates (weights are data; licences in docs/datasets.md).

Usage: .venv/Scripts/python scripts/ml/fetch_candidates.py [repo ...]
"""
from __future__ import annotations

import sys

from huggingface_hub import snapshot_download

from common import MODELS

CANDIDATES = [
    "kalyan-ks/ettin-17m-nemotron-pii",  # MIT, ModernBERT-style 7 layers, cased, English
    "kalyan-ks/ettin-32m-nemotron-pii",  # MIT, 10 layers
    "OpenMed/OpenMed-PII-ClinicalE5-Small-33M-v1",  # Apache-2.0, e5-small-v2 (BERT, uncased), English
]

for repo in sys.argv[1:] or CANDIDATES:
    target = MODELS / repo.replace("/", "__")
    path = snapshot_download(repo, local_dir=target, allow_patterns=["*.json", "*.safetensors", "*.txt", "*.model"])
    print(repo, "->", path)
