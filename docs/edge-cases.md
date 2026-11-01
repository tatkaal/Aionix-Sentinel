# Stakeholder Adversarial Edge-Case Suite (N = 24)

These cases were written from the stakeholder brief's edge-case list when the first plan was drafted. They are the mandatory acceptance scenarios.

- **Executable copy:** [`data/datasets/edge-cases.json`](../data/datasets/edge-cases.json).
- **Unit tests:** run against Path A by `tests/unit/edge-cases.test.ts`.
- **Benchmarks:** run on both paths in the Benchmarks workspace.
- **Expected outcomes:** `block` means the send must be stopped and the drawer shown; `allow` means the prompt must pass untouched.

| # | Scenario | Category | Expected |
|---|---|---|---|
| 1 | AWS access key ID + secret access key pasted into a debugging question | 1 | block |
| 2 | OpenAI `sk-…` / GitHub `ghp_…` token inside a fenced code block | 1 | block |
| 3 | Labelled password (`password: Tr0ub4dor&3x!`) in a config snippet | 2 | block |
| 4 | Non-English credential labels (`contraseña`, `Passwort`, `密码`) | 2 | block |
| 5 | Unlabelled high-entropy password (≥ 3.85 bits/char, 4 character classes) | 2 | block |
| 6 | Code that declares password fields with no value (`password: string`, `password = ""`) | — | allow |
| 7 | US SSN or passport number in a sentence | 3 | block |
| 8 | Valid AU TFN written with spaces (`123 456 782`) | 4 | block |
| 9 | 9-digit number that fails the TFN Mod-11 checksum | — | allow |
| 10 | Luhn-valid card written with dashes (`4532-0151-1283-0366`) | 5 | block |
| 11 | Benign test card `4242 4242 4242 4242` | — | allow |
| 12 | 16-digit order/tracking number that fails Luhn | — | allow |
| 13 | IBAN or BSB + account number in a payment instruction | 5 | block |
| 14 | ABN next to an entity name | 6 | block |
| 15 | Verhoeff-valid Aadhaar or Indian PAN | 6 | block |
| 16 | `postgres://user:password@host/db` connection string | 7 | block |
| 17 | Named customer + account balance / ledger lines | 8 | block |
| 18 | Public-figure finance question ("Warren Buffett's net worth") | — | allow |
| 19 | General finance question (how a mortgage offset account works) | — | allow |
| 20 | Named patient + diagnosis + prescription dosage | 9 | block |
| 21 | General medical question ("symptoms of type 2 diabetes") | — | allow |
| 22 | 15-line excerpt of the proprietary Alpha Liquidity Router code | 10 | block |
| 23 | One real secret buried inside a ~1,500-word benign prompt | 1 | block (span must point at the secret) |
| 24 | Large paste (≥ 1,200 chars) of the Project Chronos memo → `pasted-content.txt` chip; then the chip is removed | 10 | block → allow after removal |
