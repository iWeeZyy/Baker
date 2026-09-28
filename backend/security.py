"""Garde-fous de sécurité — pur, sans DB ni réseau (testé par
tests/test_security_calc.py, comme production.py/staff.py).

Le dépôt est PUBLIC : tout ce qui suit part du principe qu'un inconnu lit le
code, connaît les routes et peut créer autant de comptes qu'il veut.

- Quota IA : chaque appel Anthropic coûte de l'argent réel sur la clé du
  propriétaire. Sans plafond, un seul script pouvait vider le crédit en
  quelques minutes (inscription libre, aucune limite par route). Deux
  plafonds : par utilisateur et par jour (équité), et GLOBAL par jour (le
  vrai garde-fou financier — il tient même face à mille comptes créés pour
  multiplier les quotas individuels).
- Anti brute-force sur la connexion : verrouillage temporaire d'un email
  après trop d'échecs.
- Validation des mots de passe côté serveur (le client exigeait 8
  caractères, le serveur rien) et de la longueur bcrypt (72 octets max :
  au-delà, bcrypt 4.1 lève une exception -> erreur 500).
- JWT_SECRET : refus de démarrer avec la valeur d'exemple publiée dans
  .env.example (quiconque la lit pourrait forger un jeton de n'importe quel
  compte).
- Chemins de fichiers fournis par le client : un utilisateur ne peut
  référencer (et donc faire supprimer) que SES propres uploads.
"""
from __future__ import annotations

import os
import re
import time
from collections import defaultdict, deque
from typing import Callable, Deque, Dict, Optional

# ---------------------------------------------------------------- quota IA
AI_DAILY_LIMIT_FREE_DEFAULT = 30
AI_DAILY_LIMIT_PRO_DEFAULT = 150
AI_GLOBAL_DAILY_LIMIT_DEFAULT = 2000
GLOBAL_AI_KEY = "__global__"


def _env_int(name: str, default: int, minimum: int = 0) -> int:
    try:
        return max(minimum, int(os.environ.get(name, default)))
    except (TypeError, ValueError):
        return default


def ai_daily_limit(plan: str) -> int:
    """Appels IA autorisés par utilisateur et par jour (UTC)."""
    if plan == "pro":
        return _env_int("AI_DAILY_LIMIT_PRO", AI_DAILY_LIMIT_PRO_DEFAULT)
    return _env_int("AI_DAILY_LIMIT_FREE", AI_DAILY_LIMIT_FREE_DEFAULT)


def ai_global_daily_limit() -> int:
    """Plafond de TOUS les appels IA de l'application, par jour (UTC)."""
    return _env_int("AI_GLOBAL_DAILY_LIMIT", AI_GLOBAL_DAILY_LIMIT_DEFAULT)


# Longueurs maximales des textes envoyés à l'IA : un message de 500 000
# caractères coûterait des dizaines de fois un message normal.
MAX_CHAT_MESSAGE_LENGTH = 4000
MAX_CHAT_SESSION_ID_LENGTH = 100
MAX_ADAPT_TEXT_LENGTH = 1000


# ------------------------------------------------------------ mots de passe
PASSWORD_MIN_LENGTH = 8
BCRYPT_MAX_BYTES = 72


def password_problem(password: str) -> Optional[str]:
    """Message d'erreur si le mot de passe est refusé, sinon None."""
    if len(password) < PASSWORD_MIN_LENGTH:
        return f"Le mot de passe doit contenir au moins {PASSWORD_MIN_LENGTH} caractères."
    if len(password.encode("utf-8")) > BCRYPT_MAX_BYTES:
        return f"Le mot de passe ne peut pas dépasser {BCRYPT_MAX_BYTES} octets."
    return None


MAX_NAME_LENGTH = 100


# --------------------------------------------------------------- JWT_SECRET
_EXAMPLE_SECRET_MARKERS = ("changeme", "change-me", "generate-a-real-secret", "your-secret", "secret123")
JWT_SECRET_MIN_LENGTH = 32


def jwt_secret_problem(secret: str) -> Optional[str]:
    """Raison de refuser ce secret, sinon None."""
    lowered = secret.lower()
    if any(marker in lowered for marker in _EXAMPLE_SECRET_MARKERS):
        return "JWT_SECRET est la valeur d'exemple de .env.example (publique)."
    if len(secret) < JWT_SECRET_MIN_LENGTH:
        return f"JWT_SECRET est trop court ({len(secret)} caractères, {JWT_SECRET_MIN_LENGTH} minimum)."
    return None


# ------------------------------------------------------------ brute-force
class LoginThrottle:
    """Verrouille un identifiant (l'email) après `max_failures` échecs dans
    une fenêtre glissante de `window_s` secondes.

    En mémoire, par processus : suffisant pour l'unique instance Render de
    l'app. Un redémarrage remet les compteurs à zéro, ce qui ne donne à un
    attaquant que quelques essais de plus -- jamais un accès."""

    def __init__(self, max_failures: int = 10, window_s: float = 15 * 60,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self.max_failures = max_failures
        self.window_s = window_s
        self._clock = clock
        self._failures: Dict[str, Deque[float]] = defaultdict(deque)

    def _prune(self, key: str) -> Deque[float]:
        q = self._failures.get(key)
        if not q:
            self._failures.pop(key, None)
            return deque()
        cutoff = self._clock() - self.window_s
        while q and q[0] <= cutoff:
            q.popleft()
        if not q:
            self._failures.pop(key, None)
        return q

    def retry_after(self, key: str) -> float:
        """Secondes avant le prochain essai autorisé, 0 si non verrouillé."""
        q = self._prune(key)
        if len(q) < self.max_failures:
            return 0.0
        return max(0.0, q[0] + self.window_s - self._clock())

    def record_failure(self, key: str) -> None:
        self._prune(key)
        self._failures[key].append(self._clock())

    def reset(self, key: str) -> None:
        self._failures.pop(key, None)


# --------------------------------------------------- chemins d'upload client
def is_own_upload_path(path: str, user_id: str, app_name: str) -> bool:
    """Vrai seulement pour un fichier que CET utilisateur a lui-même envoyé
    via POST /upload (forme exacte produite par le serveur)."""
    pattern = rf"{re.escape(app_name)}/uploads/{re.escape(user_id)}/[0-9a-f]{{32}}\.jpg"
    return isinstance(path, str) and re.fullmatch(pattern, path) is not None
