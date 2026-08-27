"""Modération de texte contextuelle : une whitelist professionnelle prime
toujours sur la liste des mots interdits.

Sans ça, un filtre de mots interdits générique bloquerait « pain bâtard »,
« façonner un bâtard » ou « bâtard de campagne » — « bâtard » est d'abord une
forme de pain, avant d'être une insulte. Trois niveaux, dans cet ordre de
priorité :

  - **SAFE** : soit le terme n'a aucun sens injurieux connu, soit il en a un
    mais le contexte de boulangerie est présent ailleurs dans le même texte
    soumis — la whitelist gagne toujours face au ban word.
  - **REVIEW** : le terme est dans la whitelist (donc potentiellement
    légitime) mais aucun marqueur de contexte n'est trouvé ; ambigu, jamais
    bloqué d'office.
  - **BLOCKED** : le terme est interdit et n'a *aucune* entrée whitelist —
    pas de sens professionnel connu pour le sauver.

Pur — pas de base de données, pas de réseau — donc testable directement,
comme production.py/staff.py/moderation.py. `WHITELIST_TERMS` et `BAN_WORDS`
sont les deux tables à éditer pour ajouter un terme ; aucune n'est pensée
comme exhaustive.
"""
import os
import re
from dataclasses import dataclass, field
from typing import List

from production import normalize_name

SAFE = "safe"
REVIEW = "review"
BLOCKED = "blocked"

# Terme normalisé (sans accents, minuscule — voir _normalize) -> None si le
# terme n'a aucun sens injurieux réel et reste toujours sûr, ou liste de
# marqueurs de contexte boulangerie (eux aussi comparés normalisés) dont la
# présence n'importe où dans le même texte soumis confirme l'usage
# professionnel. Cette liste n'est pas exhaustive.
WHITELIST_TERMS = {
    "batard": ["pain", "faconner", "levain", "pate", "boulangerie", "four", "farine", "mie", "croute"],
    "fougasse": None,
    "miche": None,
    "boule": ["pain", "pate", "faconner", "boulangerie"],
    "navette": ["pain", "boulangerie", "farine"],
    "marguerite": None,
    "couronne": None,
    "tresse": None,
    "flute": None,
    "ficelle": None,
    "tourte": None,
    "pave": ["pain", "boulangerie", "farine"],
    "meule": ["pain", "farine", "boulangerie"],
    # Pas des formes de pain, mais des expressions techniques réelles du
    # métier ("la gueule du four" = son ouverture, "une gerbe de blé" = un
    # décor de pain) — sans quoi la liste de mots interdits les bloquerait
    # à tort dans une vraie recette.
    "gueule": ["four", "pain", "boulangerie", "cuisson", "enfourner"],
    "gerbe": ["ble", "pain", "boulangerie", "decor", "decorer", "farine"],
}

# Fournie par Lucas (exploitant de l'application) — pas une liste inventée
# ici. Mots isolés et expressions de plusieurs mots mélangés : les deux
# sont recherchés de la même façon (voir _contains_phrase).
BAN_WORDS = {
    "baiser",
    "bander",
    "bigornette",
    "bite",
    "bitte",
    "bloblos",
    "bordel",
    "bourré",
    "bourrée",
    "brackmard",
    "branlage",
    "branler",
    "branlette",
    "branleur",
    "branleuse",
    "brouter le cresson",
    "caca",
    "chatte",
    "chiasse",
    "chier",
    "chiottes",
    "clito",
    "clitoris",
    "con",
    "connard",
    "connasse",
    "conne",
    "couilles",
    "cramouille",
    "déconne",
    "déconner",
    "emmerdant",
    "emmerder",
    "emmerdeur",
    "emmerdeuse",
    "enculé",
    "enculée",
    "enculeur",
    "enculeurs",
    "enfoiré",
    "enfoirée",
    "étron",
    "fdp",
    "fille de pute",
    "fils de pute",
    "folle",
    "foutre",
    "gerbe",
    "gerber",
    "gouine",
    "grande folle",
    "grogniasse",
    "gueule",
    "jouir",
    "hitler",
    "la putain de ta mère",
    "malpt",
    "ménage à trois",
    "merde",
    "merdeuse",
    "merdeux",
    "meuf",
    "nègre",
    "negro",
    "nique ta mère",
    "nique ta race",
    "nazi",
    "palucher",
    "pédale",
    "pédé",
    "péter",
    "pipi",
    "pisser",
    "pouffiasse",
    "pousse-crotte",
    "putain",
    "pute",
    "ramoner",
    "reich",
    "sac à foutre",
    "sac à merde",
    "salaud",
    "salope",
    "suce",
    "tapette",
    "tanche",
    "teuch",
    "tringler",
    "trique",
    "troncher",
    "trou du cul",
    "turlute",
    "zigounette",
    "zizi",
}

# Test/dev UNIQUEMENT — jamais en production : quelques mots interdits
# chargés depuis l'environnement pour permettre à la suite HTTP
# (tests/test_recipe_moderation.py) d'exercer les chemins BLOCKED/REVIEW
# d'un serveur réellement démarré, sans coder en dur de vrais mots
# interdits dans le dépôt. Même principe que MODERATION_PROVIDER=stub dans
# moderation.py. Vide si la variable n'est pas définie : comportement
# inchangé.
_test_words = os.environ.get("TEXT_MODERATION_TEST_BAN_WORDS", "").strip()
if _test_words:
    BAN_WORDS |= {w.strip() for w in _test_words.split(",") if w.strip()}

_WORD_RE = re.compile(r"[^\W\d_]+", re.UNICODE)

# Réutilise la normalisation déjà écrite pour regrouper les noms
# d'ingrédients (accents et casse ignorés) : appliquée à un mot déjà isolé
# par _WORD_RE, elle se réduit à exactement ça, sans rien dupliquer ici.
_normalize = normalize_name


def _tokens(text: str) -> List[str]:
    return [_normalize(w) for w in _WORD_RE.findall(text or "")]


def _contains_phrase(text_tokens: List[str], phrase_tokens: List[str]) -> bool:
    """Vrai si la séquence de mots `phrase_tokens` apparaît telle quelle,
    dans l'ordre et contiguë, dans `text_tokens` — nécessaire dès que
    BAN_WORDS contient une expression ("nique ta mère", "trou du cul"...)
    et pas seulement des mots isolés : une simple intersection d'ensembles
    ne verrait jamais une expression de plusieurs mots."""
    n, m = len(text_tokens), len(phrase_tokens)
    if m == 0 or m > n:
        return False
    return any(text_tokens[i:i + m] == phrase_tokens for i in range(n - m + 1))


@dataclass
class TermMatch:
    term: str       # le terme déclencheur, normalisé
    tier: str        # "review" | "blocked" — jamais "safe" (non retenu, voir classify_text)
    reason: str


@dataclass
class TextModerationResult:
    level: str                          # safe | review | blocked
    matches: List[TermMatch] = field(default_factory=list)


def classify_text(text: str) -> TextModerationResult:
    """Classe un texte libre. Ne lève jamais d'exception, ne dépend d'aucun
    service externe — un simple passage sur les mots du texte. Chaque
    entrée de BAN_WORDS peut être un mot isolé ou une expression de
    plusieurs mots ; les deux sont recherchés sur les mêmes mots normalisés
    du texte, dans l'ordre et de façon contiguë."""
    text_tokens = _tokens(text)
    if not text_tokens or not BAN_WORDS:
        return TextModerationResult(level=SAFE)
    token_set = set(text_tokens)

    matches: List[TermMatch] = []
    seen_terms = set()
    for raw_word in BAN_WORDS:
        phrase_tokens = _tokens(raw_word)
        if not phrase_tokens:
            continue
        term = " ".join(phrase_tokens)
        if term in seen_terms or not _contains_phrase(text_tokens, phrase_tokens):
            continue
        seen_terms.add(term)
        markers = WHITELIST_TERMS.get(term, "absent")
        if markers != "absent":
            if markers is None or any(_normalize(m) in token_set for m in markers):
                continue  # la whitelist gagne : ni review ni blocked pour ce terme
            matches.append(TermMatch(term=term, tier=REVIEW, reason="terme professionnel ambigu, aucun contexte boulangerie détecté"))
        else:
            matches.append(TermMatch(term=term, tier=BLOCKED, reason="terme interdit, aucune entrée whitelist"))

    matches.sort(key=lambda m: m.term)
    if any(m.tier == BLOCKED for m in matches):
        level = BLOCKED
    elif matches:
        level = REVIEW
    else:
        level = SAFE
    return TextModerationResult(level=level, matches=matches)


def classify_recipe(title: str, description: str, ingredients: List[str], steps: List[str]) -> TextModerationResult:
    """Le contexte d'une recette est cherché sur l'ensemble de ses champs :
    un titre « Bâtard de campagne » est légitimé par « façonner » dans les
    étapes, pas seulement par ce qu'il contient lui-même."""
    combined = " ".join([title or "", description or "", *(ingredients or []), *(steps or [])])
    return classify_text(combined)


def classify_comment(content: str) -> TextModerationResult:
    return classify_text(content)
