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
}

# À fournir : la vraie liste appartient à qui exploite l'application, pas à
# un choix arbitraire fait ici. Vide par défaut — tant qu'elle l'est, aucun
# contenu n'est jamais bloqué ni mis en revue par ce module.
BAN_WORDS = set()

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
    service externe — un simple passage sur les mots du texte."""
    token_set = set(_tokens(text))
    if not token_set or not BAN_WORDS:
        return TextModerationResult(level=SAFE)

    ban_hits = token_set & {_normalize(w) for w in BAN_WORDS}
    matches: List[TermMatch] = []
    for term in sorted(ban_hits):
        markers = WHITELIST_TERMS.get(term, "absent")
        if markers != "absent":
            if markers is None or any(_normalize(m) in token_set for m in markers):
                continue  # la whitelist gagne : ni review ni blocked pour ce terme
            matches.append(TermMatch(term=term, tier=REVIEW, reason="terme professionnel ambigu, aucun contexte boulangerie détecté"))
        else:
            matches.append(TermMatch(term=term, tier=BLOCKED, reason="terme interdit, aucune entrée whitelist"))

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
