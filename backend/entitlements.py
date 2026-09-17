"""
Droits par offre : FREE / PRO / PRO+ / ÉQUIPE.

Module **pur** — aucune variable d'environnement, aucun accès base, aucun
réseau — pour que chaque case du tableau (palier × fonctionnalité, palier ×
quota) soit couverte par un test unitaire direct, comme `costing.py` ou
`leaderboard.py`. Ce qui dépend de l'environnement (interrupteur global,
liste d'e-mails, publicité) reste dans `plans.py` ; ce qui dépend de la base
(compter les recettes, les productions, les appels IA) reste dans
`gating.py`. Ici, uniquement la table des droits.

**L'échelle est monotone, et c'est l'invariant central de ce fichier.**
Un palier possède tout ce que possèdent les paliers en dessous de lui : une
fonctionnalité se déclare par son palier *minimum* (`MIN_TIER`), jamais par
une liste blanche de paliers autorisés. Conséquence voulue : insérer un 5ᵉ
palier dans `TIER_ORDER` ne demande de toucher aucun site d'appel, et aucun
site d'appel ne nomme jamais un palier. C'est la généralisation de l'esprit
déjà en place dans `plans.ads_allowed`, écrit « tout ce qui n'est pas Free
est sans publicité » plutôt qu'en énumérant les paliers payants — une
énumération finit toujours par oublier le palier ajouté ensuite.

Le corollaire : toute règle **non** monotone (une fonctionnalité qu'un
palier supérieur perdrait) n'a pas sa place ici et devrait être exprimée
ailleurs, explicitement. `test_entitlements_calc.py` vérifie la monotonie
sur chaque cellule, donc une telle règle ferait échouer la suite plutôt que
de passer inaperçue.
"""
from typing import Dict, Optional

FREE = "free"
PRO = "pro"
PRO_PLUS = "pro_plus"
TEAM = "team"

# L'ordre EST l'échelle : un palier hérite de tout ce qui le précède.
TIER_ORDER = (FREE, PRO, PRO_PLUS, TEAM)

# Libellés et prix affichés par l'écran d'abonnement. Ils vivent ici pour que
# la vitrine et les droits ne puissent pas diverger : une offre qui gagne une
# fonctionnalité et une offre affichée sont le même objet.
PLAN_LABELS: Dict[str, str] = {
    FREE: "Gratuit",
    PRO: "Pro",
    PRO_PLUS: "Pro+",
    TEAM: "Équipe",
}

PLAN_PRICES_EUR: Dict[str, float] = {
    FREE: 0.0,
    PRO: 9.90,
    PRO_PLUS: 19.90,
    TEAM: 39.90,
}


def rank(tier: str) -> int:
    """Position sur l'échelle. Un palier inconnu vaut Free — jamais mieux.

    Une chaîne inattendue (jeton forgé, donnée corrompue, palier retiré d'une
    version antérieure) doit dégrader vers le bas, jamais accorder un droit.
    """
    try:
        return TIER_ORDER.index(tier)
    except ValueError:
        return 0


def normalize(tier: Optional[str]) -> str:
    """Le palier tel qu'il sera réellement appliqué (inconnu → Free)."""
    return TIER_ORDER[rank(tier or FREE)]


# ---------- Fonctionnalités ----------
# Clé → palier minimum qui y donne droit. Une clé absente de cette table est
# une erreur de programmation, pas un droit implicite : `has_feature` lève.
MIN_TIER: Dict[str, str] = {
    # Recettes
    "recipes_unlimited": PRO,
    # Scan et adaptation sont désormais ouverts à Free : c'est leur quota
    # d'essai (scans_total/adapts_total, voir QUOTAS) qui les borne, pas un
    # verrou de palier. Rester monotone : Pro/Pro+/Équipe restent au moins
    # aussi permissifs (quota illimité).
    "recipe_scan": FREE,
    "recipe_adapt": FREE,
    "recipe_history": PRO,
    "sub_recipes": PRO,
    # Assistant
    "ai_assistant": FREE,   # accessible à tous, borné par le quota ci-dessous
    "ai_advanced": PRO_PLUS,  # l'assistant lit les données réelles du compte
    # Coûts
    "cost_basic": PRO,          # coût matière, coût par pièce, marge
    "cost_materials": PRO_PLUS,  # catalogue, fournisseurs, évolution des prix
    "cost_profitability": PRO_PLUS,  # analyse, simulation de prix de vente
    # Production
    "production_advanced": PRO_PLUS,
    # Ouvert à Free depuis le chantier des quotas d'essai — borné par le
    # quota stock schedules_total (3 grilles conservées), pas verrouillé.
    "staff_schedule": FREE,
    "fournil_mode": PRO_PLUS,
    # Collections — quota stock (collections_total), jamais verrouillé par
    # palier : ouvert à tous, Free simplement plus borné.
    "collections": FREE,
    # Organisation
    "org_team": TEAM,
    "org_tasks": TEAM,
    "pro_orders": TEAM,
    "org_dashboard": TEAM,
    "org_multi_shop": TEAM,
}


def has_feature(tier: str, key: str) -> bool:
    """Ce palier donne-t-il droit à cette fonctionnalité ?"""
    if key not in MIN_TIER:
        raise KeyError(f"fonctionnalité inconnue : {key}")
    return rank(tier) >= rank(MIN_TIER[key])


# ---------- Quotas ----------
# `None` = illimité. Un quota et une fonctionnalité sont deux choses
# distinctes : `ai_assistant` est ouvert à tous les paliers, c'est son quota
# qui sépare les offres.
QUOTAS: Dict[str, Dict[str, Optional[int]]] = {
    FREE: {
        # Illimité : plus aucun plafond sur le nombre de recettes créées.
        "recipes_total": None,
        "productions_per_month": 3,
        "ai_messages_per_month": 10,
        # Même valeur que scans_total (ci-dessous), délibérément redondant :
        # un plafond à vie de 3 rend de toute façon un plafond mensuel de 3
        # sans effet propre (jamais atteint avant l'autre), mais `None` ici
        # casserait la monotonie de CETTE clé prise isolément en passant à
        # 30 pour Pro (`TestMonotonie` le vérifie colonne par colonne, sans
        # connaître le lien entre les deux quotas) — 3 garde la séquence
        # 3 → 30 → illimité → illimité strictement croissante.
        "scans_per_month": 3,
        # Plafond d'effectif par grille envoyée — 8, pas 0, sinon le
        # déverrouillage de staff_schedule resterait sans effet pratique
        # (toute grille non vide aurait continué d'être refusée). Le nombre
        # de grilles elles-mêmes est borné séparément par schedules_total.
        "schedule_employees": 8,
        "org_members": 0,
        # --- Quotas d'essai gratuits (nouveaux) ---
        # Usage : consommé à vie, jamais remboursé par une suppression.
        "scans_total": 3,
        "adapts_total": 5,
        # Stock : compte les documents actuellement existants — en
        # supprimer un libère une place.
        "collections_total": 3,
        "schedules_total": 3,
    },
    PRO: {
        "recipes_total": None,
        "productions_per_month": None,
        "ai_messages_per_month": 200,
        "scans_per_month": 30,
        "schedule_employees": 15,
        "org_members": 0,
        "scans_total": None,
        "adapts_total": None,
        "collections_total": None,
        "schedules_total": None,
    },
    PRO_PLUS: {
        "recipes_total": None,
        "productions_per_month": None,
        "ai_messages_per_month": None,
        "scans_per_month": None,
        "schedule_employees": 15,
        "org_members": 0,
        "scans_total": None,
        "adapts_total": None,
        "collections_total": None,
        "schedules_total": None,
    },
    TEAM: {
        "recipes_total": None,
        "productions_per_month": None,
        "ai_messages_per_month": None,
        "scans_per_month": None,
        "schedule_employees": 15,
        "org_members": 15,
        "scans_total": None,
        "adapts_total": None,
        "collections_total": None,
        "schedules_total": None,
    },
}

# Sur quelle fenêtre un quota se compte. Alimente le champ `period` de la
# réponse 403, qui était écrit en dur à "month" tant que le seul quota
# existant était mensuel.
#
# "total"  : comptage EN DIRECT des documents existants — supprimer un
#            document libère une place (recipes_total, schedules_total,
#            collections_total, schedule_employees, org_members).
# "month"  : comptage filtré sur le mois calendaire glissant en cours —
#            remis à zéro le 1er du mois (productions_per_month,
#            ai_messages_per_month, scans_per_month).
# "usage"  : comptage cumulatif À VIE, à partir d'un journal d'événements
#            (db.ai_usage) — jamais remis à zéro, jamais remboursé par la
#            suppression du contenu produit (scans_total, adapts_total).
QUOTA_PERIOD: Dict[str, str] = {
    "recipes_total": "total",
    "productions_per_month": "month",
    "ai_messages_per_month": "month",
    "scans_per_month": "month",
    "schedule_employees": "total",
    "org_members": "total",
    "scans_total": "usage",
    "adapts_total": "usage",
    "collections_total": "total",
    "schedules_total": "total",
}

QUOTA_KEYS = tuple(QUOTA_PERIOD)


def quota(tier: str, key: str) -> Optional[int]:
    """Plafond de ce palier pour ce quota ; `None` = illimité."""
    if key not in QUOTA_PERIOD:
        raise KeyError(f"quota inconnu : {key}")
    return QUOTAS[normalize(tier)][key]


def quota_period(key: str) -> str:
    if key not in QUOTA_PERIOD:
        raise KeyError(f"quota inconnu : {key}")
    return QUOTA_PERIOD[key]


def within_quota(tier: str, key: str, used: int) -> bool:
    """Reste-t-il de la place ? Un plafond `None` laisse toujours passer."""
    limit = quota(tier, key)
    return limit is None or used < limit


# ---------- Charge utile pour l'application ----------
def features_for(tier: str, enforced: bool) -> Dict[str, dict]:
    """L'état de chaque fonctionnalité, interrupteur global déjà replié dedans.

    Deux champs distincts, et c'est délibéré :
      - `allowed` : la vérité du palier, qui alimente l'argumentaire de
        l'écran d'abonnement (« cette fonctionnalité est dans Pro+ »).
      - `locked` : ce que l'application doit réellement respecter, soit
        `not allowed and enforced`.

    Replier l'interrupteur ici plutôt que côté client garantit qu'aucun écran
    n'a à combiner deux booléens — le seul champ sur lequel brancher est
    `locked` — et qu'un client ne voit jamais l'état de la configuration
    serveur. Tant que l'abonnement n'est pas achetable, `enforced` est faux :
    `allowed` dit la vérité de l'offre, `locked` reste partout faux, et
    personne ne perd une fonctionnalité qu'il utilise déjà.
    """
    tier = normalize(tier)
    out = {}
    for key, min_tier in MIN_TIER.items():
        allowed = has_feature(tier, key)
        out[key] = {
            "allowed": allowed,
            "locked": (not allowed) and enforced,
            "min_plan": min_tier,
        }
    return out


def quotas_for(tier: str) -> Dict[str, dict]:
    """Les plafonds du palier, sans consommation — la compter demande la base.

    `gating.py` complète chaque entrée avec `used`/`remaining`.
    """
    tier = normalize(tier)
    return {
        key: {"limit": QUOTAS[tier][key], "period": QUOTA_PERIOD[key]}
        for key in QUOTA_KEYS
    }


def plan_catalogue() -> list:
    """Les quatre offres, dans l'ordre, pour l'écran d'abonnement.

    L'écran se construit à partir de cette liste plutôt que d'un tableau
    recopié dans l'application : un cinquième palier, ou un prix qui change,
    n'exige alors aucune livraison sur les stores.
    """
    return [
        {
            "plan": tier,
            "label": PLAN_LABELS[tier],
            "price_eur": PLAN_PRICES_EUR[tier],
            "features": [k for k in MIN_TIER if has_feature(tier, k)],
            "quotas": {k: QUOTAS[tier][k] for k in QUOTA_KEYS},
        }
        for tier in TIER_ORDER
    ]
