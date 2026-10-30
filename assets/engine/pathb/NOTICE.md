# Path B tagger — notices

`model_int8.onnx` and `tokenizer.json` are a token classifier trained by `scripts/ml/` (see `tagger.json` for provenance and checksums).

- **Base model:** [microsoft/Multilingual-MiniLM-L12-H384](https://huggingface.co/microsoft/Multilingual-MiniLM-L12-H384), MIT License, Copyright (c) Microsoft Corporation. The vocabulary was trimmed to 30,376 pieces and the model was truncated to 6 layers, then fine-tuned.
- **Tokenizer vocabulary:** derived from the XLM-R SentencePiece vocabulary in [sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2), Apache-2.0.
- **Training data:**
  - [nvidia/Nemotron-PII](https://huggingface.co/datasets/nvidia/Nemotron-PII) by NVIDIA, licensed CC BY 4.0. It was relabelled to the engine's entity kinds.
  - [gretelai/synthetic_pii_finance_multilingual](https://huggingface.co/datasets/gretelai/synthetic_pii_finance_multilingual) by Gretel.ai, licensed Apache-2.0.

MIT License (base model):

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
