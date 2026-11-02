"""Synthetic training rows for the class the source corpora barely cover: credentials stated in chat-style
prose (the label far away, paraphrased, or absent), weak dictionary values ("admin", "root"), "user / pass"
pairs, PINs and recovery phrases, unlabelled national IDs; and hard negatives (talk about passwords,
"admin" / "root" as roles and paths, password managers, placeholders, code types, product names).

Nemotron-PII and Gretel put ~71% of secrets right after a cue such as "Password:" and almost all values are
complex, so the Path B v2 tagger proposed nothing for "... the password for it. Usually it is admin".
Templates here are written independently of data/datasets/contextual-challenge.json (frozen first): no
sentence of that set is copied, and the generator is never adjusted on its errors.

Usage: imported by build_corpus.py (--synthetic N). Values are random; nothing here is a real credential.
"""
from __future__ import annotations

import random
import re
import string

SLOT = re.compile(r"\{(pw2|pw|pin|user|svc|email|id|phrase)\}")

SERVICES_EN = [
    "the VPN", "the office wifi", "the guest wifi", "the router", "the staging server", "the build box", "the CRM", "the HR portal",
    "payroll", "the shared inbox", "my banking app", "the NAS", "the firewall", "Jira", "the dashboard", "the printer page",
    "the database", "the jump host", "the alarm panel", "my phone", "the laptop", "the safe", "the side door", "the test account",
    "the admin console", "the POS terminal", "the warehouse tablet", "Grafana", "the backup drive", "the cloud console", "the SFTP drop",
]
SERVICES = {
    "fr": ["le VPN", "le wifi du bureau", "la box", "le serveur de test", "le portail RH", "la paie", "la boîte partagée", "l'appli bancaire", "le NAS", "la console admin"],
    "de": ["das VPN", "das Büro-WLAN", "der Router", "der Testserver", "das HR-Portal", "die Lohnabrechnung", "das Sammelpostfach", "die Banking-App", "das NAS", "die Admin-Konsole"],
    "es": ["la VPN", "el wifi de la oficina", "el router", "el servidor de pruebas", "el portal de RR. HH.", "las nóminas", "el buzón compartido", "la app del banco", "el NAS", "la consola"],
    "it": ["la VPN", "il wifi dell'ufficio", "il router", "il server di test", "il portale HR", "le buste paga", "la casella condivisa", "l'app della banca", "il NAS", "la console"],
}
USERS = ["ops", "deploy", "svc_backup", "etl", "jsmith", "mlee", "admin", "root", "reporting", "ci", "warehouse1", "frontdesk", "kiosk", "it-support", "sa", "pi", "ubuntu", "guest"]
WEAK = [
    "admin", "root", "password", "Password1", "welcome", "Welcome1", "letmein", "qwerty", "qwerty123", "123456", "12345678", "guest",
    "test", "test123", "secret123", "abc123", "iloveyou", "monkey", "dragon", "sunshine1", "football", "toor", "default", "pass123",
    "admin123", "root123", "1234", "0000", "master", "hello123", "trustno1", "superman", "baseball", "princess", "shadow", "michael1",
]
WORDS = ["falcon", "maple", "river", "orchid", "copper", "lantern", "harbor", "violet", "summit", "pepper", "cobalt", "meadow", "tiger", "ember",
         "willow", "comet", "saffron", "glacier", "thunder", "pebble", "breeze", "crystal", "canyon", "marble", "sparrow", "juniper", "lotus", "anchor"]
SEASONS = ["Spring", "Summer", "Autumn", "Winter", "Printemps", "Sommer", "Verano", "Estate", "Invierno", "Herbst"]
FIRMS = ["Acme", "Globex", "Initech", "Umbrella", "Stark", "Wayne", "Hooli", "Vandelay", "Soylent", "Tyrell", "Cyberdyne", "Monarch"]
DOMAINS = ["example.com", "corp-mail.net", "mailbox.org", "contoso.io", "fabrikam.co"]


def strong(r: random.Random) -> str:
    kind = r.randrange(6)
    w = r.choice(WORDS)
    if kind == 0:
        return f"{w.capitalize()}{r.randint(10, 2099)}{r.choice('!#$%&*?@')}"
    if kind == 1:
        return f"{r.choice(SEASONS)}{r.randint(2015, 2030)}{r.choice(['!', '#', '', '$'])}"
    if kind == 2:
        leet = w.replace("a", "@").replace("o", "0").replace("e", "3").replace("i", "1")
        return f"{leet.capitalize()}{r.choice('!#$*')}{r.randint(1, 99)}"
    if kind == 3:
        alphabet = string.ascii_letters + string.digits + "!#$%&*?@^"
        return "".join(r.choice(alphabet) for _ in range(r.randint(10, 16)))
    if kind == 4:
        return f"{r.choice(FIRMS)}{r.choice(['@', '#', '_', ''])}{r.randint(2018, 2030)}"
    return f"{w.capitalize()}.{r.choice(WORDS).capitalize()}{r.randint(1, 99)}"


def weak(r: random.Random) -> str:
    return r.choice(WEAK)


def password(r: random.Random) -> str:
    return weak(r) if r.random() < 0.45 else strong(r)


def pin(r: random.Random) -> str:
    n = r.choice([4, 4, 4, 5, 6])
    d = "".join(str(r.randint(0, 9)) for _ in range(n))
    return "-".join(d) if r.random() < 0.15 else d


def phrase(r: random.Random) -> str:
    return " ".join(r.sample(WORDS, r.randint(4, 8)))


def national_id(r: random.Random) -> str:
    kind = r.randrange(6)
    if kind == 0:  # US SSN-shaped
        return f"{r.randint(100, 665):03d}-{r.randint(10, 99):02d}-{r.randint(1000, 9999):04d}"
    if kind == 1:  # French NIR
        return f"{r.choice('12')} {r.randint(40, 99):02d} {r.randint(1, 12):02d} {r.randint(1, 95):02d} {r.randint(100, 999)} {r.randint(100, 999)} {r.randint(10, 97):02d}"
    if kind == 2:  # Spanish DNI
        return f"{r.randint(10_000_000, 99_999_999)}{r.choice('TRWAGMYFPDXBNJZSQVHLCKE')}"
    if kind == 3:  # Italian codice fiscale
        L = string.ascii_uppercase
        return "".join(r.choice(L) for _ in range(6)) + f"{r.randint(40, 99)}" + r.choice("ABCDEHLMPRST") + f"{r.randint(1, 71):02d}" + r.choice(L) + f"{r.randint(100, 999)}" + r.choice(L)
    if kind == 4:  # German tax id (11 digits)
        return "".join(str(r.randint(0, 9)) for _ in range(11))
    return f"{r.choice('ABCEGHJKLMNPRSTWXYZ')}{r.choice('ABCEGHJKLMNPRSTWXYZ')} {r.randint(10, 99)} {r.randint(10, 99)} {r.randint(10, 99)} {r.choice('ABCD')}"  # UK NINO


def email(r: random.Random) -> str:
    return f"{r.choice(['finance', 'ops', 'a.nguyen', 'm.rossi', 'help', 'team', 'jdoe'])}@{r.choice(DOMAINS)}"


# ── Positive templates: the {pw}/{pw2}/{pin}/{phrase} slots are secrets, {id} is a gov-id ─────────────
POS_EN = [
    "the {svc} still takes {pw}, nobody ever changed it",
    "when {svc} asks for a password just put {pw}",
    "{svc} login is {user}, and the password is the usual {pw}",
    "it wants a password for {svc}; ours is {pw}",
    "I think the {svc} one is {pw}, if not then {pw2}",
    "try {pw} first on {svc}, otherwise {pw2} should work",
    "for {svc} the credentials are {user} and {pw}",
    "sign in to {svc} with {user} / {pw}",
    "{user}:{pw} works for {svc}",
    "I've been using {pw} on {svc} and my personal email for years",
    "my {svc} unlock code is {pin}",
    "punch in {pin} at {svc} and the light turns green",
    "we all share {pw} for {svc} on the team",
    "{svc} -> user {user}, pass {pw}",
    "the default on {svc} is {pw} and we never touched it",
    "after the reset IT gave me {pw} for {svc}",
    "I set {svc} to {pw} last week, is that fine?",
    "{pw} is what I picked for {svc}",
    "if {svc} prompts you, enter {pw}",
    "access for {svc}: {pw}",
    "you can get into {svc} using {pw}",
    "{svc} needs a username and a password. The username is {user}. The other one is {pw}.",
    "Login is {user}. Password, same as always: {pw}.",
    "the code for {svc} is {pin}, please don't write it down",
    "heads up, {svc} was changed to {pw} this morning",
    "the new one for {svc} is {pw} — update your notes",
    "{svc}: {user} / {pw} (temporary, rotate after the audit)",
    "use {pw} if {svc} complains, it's the shared one",
    "if {pw} doesn't work on {svc}, it might still be {pw2}",
    "the {svc} PIN is {pin}",
    "I keep forgetting it, the {svc} passcode is {pin}",
    "my recovery phrase is {phrase}",
    "seed words for the wallet: {phrase}",
    "logging into {svc} as {user} with {pw} gives me an error",
    "why does {svc} reject {pw}? it worked yesterday",
    "{pw} — that's the one for {svc}",
    "{svc} accepts {pw}, I just checked",
    "type {pw} into {svc} and hit enter",
    "the contractor can use {user} with {pw} on {svc} until Friday",
    "we're on {pw} for {svc} now, the old one expired",
    "Here's the number for HR: {id}",
    "please file it under {id}",
    "her ID number is {id}",
    "{id} is on his card, can you check the format?",
]
POS = {
    "fr": [
        "pour {svc}, c'est {pw}", "le mot de passe de {svc} est {pw}", "connecte-toi à {svc} avec {user} et {pw}", "si ça demande, mets {pw}",
        "{svc} : identifiant {user}, code {pw}", "on utilise tous {pw} pour {svc}", "le code de {svc} est {pin}", "essaie {pw}, sinon {pw2}",
        "voici son numéro : {id}",
    ],
    "de": [
        "für {svc} ist das Kennwort {pw}", "melde dich bei {svc} mit {user} und {pw} an", "wenn {svc} fragt, gib {pw} ein", "das Passwort ist immer noch {pw}",
        "{svc}: Benutzer {user}, Kennwort {pw}", "wir nehmen alle {pw} für {svc}", "der Code für {svc} ist {pin}", "probier {pw}, sonst {pw2}",
        "seine Nummer ist {id}",
    ],
    "es": [
        "para {svc} la clave es {pw}", "entra en {svc} con {user} y {pw}", "si te la pide, pon {pw}", "la contraseña sigue siendo {pw}",
        "{svc}: usuario {user}, clave {pw}", "todos usamos {pw} para {svc}", "el código de {svc} es {pin}", "prueba {pw}, si no {pw2}",
        "su número es {id}",
    ],
    "it": [
        "per {svc} la password è {pw}", "accedi a {svc} con {user} e {pw}", "se la chiede, metti {pw}", "la password è ancora {pw}",
        "{svc}: utente {user}, password {pw}", "usiamo tutti {pw} per {svc}", "il codice di {svc} è {pin}", "prova {pw}, altrimenti {pw2}",
        "il suo numero è {id}",
    ],
}
POS_CODE = [
    '{{"login":"{user}","pwd":"{pw}"}}', '{{"user":"{user}","passphrase":"{pw}"}}', "user={user}\npass={pw}", "auth = ('{user}', '{pw}')",
    "--username {user} --password {pw}", "ssh {user}@10.0.3.7  # {pw}", "login {user}\npassword {pw}", "creds:\n  user: {user}\n  secret: {pw}",
    "{user},{pw}", "net use Z: \\\\fs01\\share {pw} /user:{user}", "PGPASSWORD={pw} psql -U {user}", "sshpass -p {pw} ssh {user}@backup",
]

# ── Hard negatives: no secret in the text ────────────────────────────────────────────────────────
NEG_EN = [
    "{svc} asks for a password every morning, how do I stop that?", "how long should the password for {svc} be?",
    "the admin account on {svc} is disabled for security", "log in as admin and open the settings page of {svc}",
    "run the installer as root, then reboot", "only give the root user ssh keys, never a password", "put the files in the root folder of {svc}",
    "{svc} has an admin console under /admin", "we moved all the team passwords into 1Password last year", "is Bitwarden or KeePass better for a small team?",
    "set password: <your-password> before starting {svc}", "the password field shows ******** after saving", "if (!password) return res.status(400)",
    "password = os.environ['SVC_PASSWORD']", "type your password and press enter to continue", "never share your PIN with anyone, even IT",
    "the PIN must be 4 to 6 digits", "the default password is printed on the sticker under {svc}", "I reset my password but {svc} still says it is wrong",
    "upgrade {svc} to Windows11 before the audit", "the error code from {svc} is 0x80070005", "please review commit 8c41f02 before merging",
    "my order 4410 2291 7713 0058 has not arrived", "ticket INC-20441 is about {svc}", "{svc} runs version 3.2.1 now", "the root cause was a full disk on {svc}",
    "admins can reset passwords from the {svc} panel", "the password policy needs 12 characters and a symbol", "what is a good password manager for families?",
    "use the admin role only for maintenance on {svc}", "the root certificate for {svc} expired", "change the default admin password on {svc} today",
    "we use SSO for {svc}, so there is no separate password", "my password expired, who can unlock the account?", "the account is locked after 5 wrong passwords",
    "password123 is on every list of the worst passwords", "passwords like admin or 123456 are banned by our policy", "what does 'incorrect username or password' mean?",
    "rotate the API keys for {svc} every 90 days", "the {svc} key is stored in the vault, not in the repo",
]
NEG = {
    "fr": ["comment changer le mot de passe de {svc} ?", "connecte-toi en administrateur sur {svc}", "le mot de passe doit faire 12 caractères", "mon mot de passe a expiré"],
    "de": ["wie ändere ich das Passwort für {svc}?", "melde dich als Administrator bei {svc} an", "das Kennwort muss 12 Zeichen haben", "mein Passwort ist abgelaufen"],
    "es": ["¿cómo cambio la contraseña de {svc}?", "entra como administrador en {svc}", "la contraseña debe tener 12 caracteres", "mi contraseña ha caducado"],
    "it": ["come cambio la password di {svc}?", "accedi come amministratore a {svc}", "la password deve avere 12 caratteri", "la mia password è scaduta"],
}
FILLER = [
    "The team reviewed the roadmap and agreed on the next milestones.", "Lunch is at noon in the large meeting room.",
    "Please update the shared calendar before Friday.", "The customer call went well and they want a proposal next week.",
    "We still need to book the venue for the offsite.", "Remember to submit your expenses by the end of the month.",
]


def render(template: str, r: random.Random, lang: str) -> tuple[str, list[dict]]:
    svcs = SERVICES_EN if lang == "en" else SERVICES[lang]
    out: list[str] = []
    spans: list[dict] = []
    pos = 0
    cursor = 0
    for m in SLOT.finditer(template):
        lit = template[cursor:m.start()]
        out.append(lit)
        pos += len(lit)
        slot = m.group(1)
        value = {
            "pw": password, "pw2": password, "pin": pin, "phrase": phrase, "id": national_id, "email": email,
            "user": lambda rr: rr.choice(USERS), "svc": lambda rr: rr.choice(svcs),
        }[slot](r)
        kind = {"pw": "secret", "pw2": "secret", "pin": "secret", "phrase": "secret", "id": "gov-id", "email": "email"}.get(slot)
        if kind:
            spans.append({"start": pos, "end": pos + len(value), "kind": kind})
        out.append(value)
        pos += len(value)
        cursor = m.end()
    out.append(template[cursor:])
    text = "".join(out)
    if text and r.random() < 0.5:
        text = text[0].upper() + text[1:]
    return text, spans


def bury(text: str, spans: list[dict], r: random.Random) -> tuple[str, list[dict]]:
    before = " ".join(r.sample(FILLER, r.randint(1, 4))) + " "
    after = " " + " ".join(r.sample(FILLER, r.randint(1, 4)))
    return before + text + after, [{**s, "start": s["start"] + len(before), "end": s["end"] + len(before)} for s in spans]


def generate(n: int, seed: int = 11) -> list[dict]:
    """~58% positives, ~42% hard negatives; ~20% non-English; ~25% buried in benign sentences."""
    r = random.Random(seed)
    rows: list[dict] = []
    for i in range(n):
        lang = "en" if r.random() < 0.8 else r.choice(["fr", "de", "es", "it"])
        positive = r.random() < 0.58
        if positive:
            pool = (POS_EN + POS_CODE) if lang == "en" else (POS[lang] + POS_CODE[:4])
        else:
            pool = NEG_EN if lang == "en" else NEG[lang]
        text, spans = render(r.choice(pool), r, lang)
        if r.random() < 0.25:
            text, spans = bury(text, spans, r)
        rows.append({"text": text, "spans": spans, "source": "aionix-synth", "lang": lang, "domain": "chat-credentials" if positive else "chat-negative"})
    return rows


if __name__ == "__main__":
    for row in generate(12, seed=3):
        print(repr(row["text"]), [row["text"][s["start"]:s["end"]] + ":" + s["kind"] for s in row["spans"]])
