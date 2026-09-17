"""Tableau de bord manager : vue d'ensemble d'une organisation sur une
fenêtre glissante (phase 7d).

Réutilise des calculs déjà faits ailleurs plutôt que d'en réinventer :
`production.aggregate_ingredients` (le besoin matières d'une journée, déjà
affiché par l'écran de production) et `staff.summarize` (les totaux
d'heures, déjà affichés par la grille personnel) sont appliqués tels quels
à l'ensemble des documents de la période au lieu d'un seul ; seule
l'agrégation des calculs de coût et la répartition des tâches par membre
sont neuves ici.

Contenu et périmètre validés avec Lucas avant d'écrire ce module (voir
CLAUDE.md, section « Offres et droits ») : Production, Personnel, Coûts et
marges, Tâches — réservé au propriétaire et à l'encadrement d'une
organisation (`org_scope.can_view_dashboard`), jamais à un simple employé,
qui voit son propre travail ailleurs dans l'app mais pas la vue d'ensemble
de l'affaire. Toujours calculé à la demande, jamais mis en cache ni exécuté
en tâche de fond — même choix que `leaderboard.py`, à cette échelle d'usage
l'agrégation à chaque requête reste bon marché.

Fenêtres glissantes plutôt qu'un découpage calendaire/fuseau horaire — même
sémantique et mêmes bornes (7 / 30 / 365 jours, "depuis toujours") que
`leaderboard.py`, dupliquées ici à dessein plutôt qu'importées : les deux
fonctionnalités n'ont aucun rapport (classement communautaire contre
tableau de bord d'une organisation) et ne doivent pas se coupler juste
parce qu'elles partagent une formule de date.

Les fonctions `summarize_*` sont pures (aucun accès base) et les seules
testées par `test_dashboard_calc.py`, sans serveur — comme `leaderboard.py`,
`db` est toujours reçu en paramètre par les helpers async plutôt qu'importé
en tête de module, précisément pour que ce fichier reste importable sans
`MONGO_URL` : `organisations.py`/`gating.py` importent `core.py`, qui lit
cette variable d'environnement dès l'import, donc les quelques imports qui
en dépendent (`organisations`, `gating.check`) sont différés à l'intérieur
des fonctions qui en ont besoin plutôt qu'en tête de module.

Comme `organisations.py`, ce module porte à la fois l'agrégation et les
vérifications d'accès qui lèvent une `HTTPException` — `routers/organisations.py`
reste une couche fine qui ne fait que déléguer à `build()`.
"""
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from fastapi import HTTPException

import production
import staff
from org_scope import can_view_dashboard

PERIOD_DAYS: Dict[str, Optional[int]] = {"week": 7, "month": 30, "year": 365, "all": None}


def period_start(period: str, now: Optional[datetime] = None) -> Optional[datetime]:
    """Borne inférieure (incluse) de la fenêtre glissante, ou None pour
    "depuis toujours". `now` est injectable pour les tests."""
    if period not in PERIOD_DAYS:
        raise ValueError(f"Période inconnue : {period}")
    days = PERIOD_DAYS[period]
    if days is None:
        return None
    now = now or datetime.now(timezone.utc)
    return now - timedelta(days=days)


def _date_floor(period: str, now: Optional[datetime] = None) -> Optional[str]:
    """`period_start` en date AAAA-MM-JJ — pour filtrer les champs `date`/
    `week_start`, des chaînes ISO comparables lexicographiquement, jamais
    des horodatages."""
    start = period_start(period, now)
    return None if start is None else start.strftime("%Y-%m-%d")


def summarize_production(productions: List[dict]) -> dict:
    """Nombre de productions de la période + besoin matières agrégé.

    Reprend exactement le pipeline `normalize_line` -> `scale_ingredients`
    de `production.py`, puis un seul `aggregate_ingredients` sur l'ensemble
    plutôt que sur une seule production à la fois : aucun second calcul,
    seulement plus de lignes en entrée.
    """
    scaled: List[dict] = []
    for doc in productions:
        for line in doc.get("lines") or []:
            normalized = production.normalize_line(line)
            scaled.extend(production.scale_ingredients(
                normalized.get("ingredients") or [], normalized.get("batches") or 0))
    return {
        "production_count": len(productions),
        "ingredients": production.aggregate_ingredients(scaled),
    }


def summarize_staff(schedules: List[dict]) -> dict:
    """Heures travaillées/supplémentaires cumulées, en minutes — le
    formatage ("32:00") reste à l'affichage, même discipline que
    `staff.py`."""
    worked = overtime = 0
    for doc in schedules:
        computed = staff.summarize(doc.get("employees"))
        worked += sum(r["worked_minutes"] for r in computed["employees"])
        overtime += sum(r["overtime_minutes"] for r in computed["employees"])
    return {
        "schedule_count": len(schedules),
        "worked_minutes": worked,
        "overtime_minutes": overtime,
        "total_minutes": worked + overtime,
    }


def summarize_cost(calculations: List[dict]) -> dict:
    """Coût et marge cumulés des calculs de rentabilité enregistrés sur la
    période.

    Un calcul sans coût total (prix matière manquant) ou sans marge (pas de
    prix de vente saisi) ne contribue pas à la somme — jamais compté comme
    zéro, même règle que `costing.py` : une donnée absente reste absente
    plutôt que d'être devinée.
    """
    total_cost = 0.0
    total_margin = 0.0
    priced_count = margin_count = 0
    for doc in calculations:
        cost = (doc.get("result") or {}).get("total_cost")
        if cost is not None:
            total_cost += cost
            priced_count += 1
        margin = (doc.get("sale") or {}).get("margin_total")
        if margin is not None:
            total_margin += margin
            margin_count += 1
    return {
        "calculation_count": len(calculations),
        "priced_count": priced_count,
        "total_cost": round(total_cost, 2) if priced_count else None,
        "margin_count": margin_count,
        "total_margin": round(total_margin, 2) if margin_count else None,
    }


def summarize_tasks(productions: List[dict], roster_user_ids: List[str]) -> dict:
    """Répartition todo/doing/done par membre sur les étapes assignées
    (`assignee_user_id`, phase 7c) de la période.

    Chaque membre actif de l'organisation apparaît même à zéro partout —
    c'est précisément ce qu'un manager veut voir : qui n'a encore rien
    reçu. Un compte qui porte des étapes historiques mais n'est plus membre
    actif apparaît quand même dans `by_member` (jamais un comptage
    silencieusement perdu), simplement sans zéro-remplissage s'il n'a rien
    sur la période.
    """
    by_member: Dict[str, Dict[str, int]] = {}
    unassigned = 0
    for doc in productions:
        for step in doc.get("steps") or []:
            assignee = step.get("assignee_user_id")
            if not assignee:
                unassigned += 1
                continue
            row = by_member.setdefault(assignee, {"todo": 0, "doing": 0, "done": 0})
            status = step.get("status") or "todo"
            if status in row:
                row[status] += 1
    for uid in roster_user_ids:
        by_member.setdefault(uid, {"todo": 0, "doing": 0, "done": 0})
    return {"by_member": by_member, "unassigned_steps": unassigned}


async def _fetch_productions(db, org_id: str, date_floor: Optional[str]) -> List[dict]:
    q: dict = {"org_id": org_id}
    if date_floor is not None:
        q["date"] = {"$gte": date_floor}
    return await db.productions.find(q, {"_id": 0}).to_list(2000)


async def _fetch_schedules(db, org_id: str, date_floor: Optional[str]) -> List[dict]:
    q: dict = {"org_id": org_id}
    if date_floor is not None:
        q["week_start"] = {"$gte": date_floor}
    return await db.schedules.find(q, {"_id": 0}).to_list(500)


async def _fetch_cost_calculations(db, org_id: str, ts_floor: Optional[datetime]) -> List[dict]:
    q: dict = {"org_id": org_id}
    if ts_floor is not None:
        q["created_at"] = {"$gte": ts_floor}
    return await db.cost_calculations.find(q, {"_id": 0}).to_list(2000)


async def _task_rows(db, by_member: Dict[str, Dict[str, int]], org: dict) -> List[dict]:
    """Résout nom/photo/rôle pour chaque membre apparu dans `by_member` —
    y compris un ancien membre retiré depuis, résolu par une simple
    recherche utilisateur par lot plutôt qu'omis (voir `summarize_tasks`)."""
    if not by_member:
        return []
    # Import différé : organisations.py importe core.py, qui lit MONGO_URL
    # dès son propre import (voir l'en-tête du module).
    from organisations import list_members

    user_ids = list(by_member.keys())
    users_by_id = {
        u["user_id"]: u async for u in
        db.users.find({"user_id": {"$in": user_ids}}, {"_id": 0, "user_id": 1, "name": 1, "picture": 1})
    }
    roster_by_id = {m["user_id"]: m for m in await list_members(org)}
    rows = []
    for uid, counts in by_member.items():
        u = users_by_id.get(uid, {})
        roster = roster_by_id.get(uid)
        rows.append({
            "user_id": uid,
            "name": u.get("name") or "Boulanger",
            "picture": u.get("picture"),
            "role": roster["role"] if roster else None,
            **counts,
        })
    rows.sort(key=lambda r: (-(r["todo"] + r["doing"] + r["done"]), r["name"]))
    return rows


async def build(db, user: dict, org: dict, period: str) -> dict:
    """La charge utile de `GET /organisations/dashboard`.

    Les vérifications qui lèvent une `HTTPException` vivent ici, jamais
    dans le routeur — même découpage qu'`organisations.py`. `db` est reçu
    du routeur (voir l'en-tête du module) plutôt qu'importé ici.
    """
    if not org.get("org_id"):
        raise HTTPException(422, "Le tableau de bord suppose une organisation active.")
    # Import différé : gating.py importe core.py (voir l'en-tête du module).
    from gating import check
    await check(user, feature="org_dashboard", org=org)
    if not can_view_dashboard(org.get("role")):
        raise HTTPException(403, "Réservé au propriétaire et à l'encadrement de l'organisation.")
    if period not in PERIOD_DAYS:
        raise HTTPException(422, "Période invalide (attendu : week, month, year ou all).")

    from organisations import list_members

    org_id = org["org_id"]
    date_floor = _date_floor(period)
    ts_floor = period_start(period)

    productions = await _fetch_productions(db, org_id, date_floor)
    schedules = await _fetch_schedules(db, org_id, date_floor)
    calculations = await _fetch_cost_calculations(db, org_id, ts_floor)
    roster_user_ids = [m["user_id"] for m in await list_members(org)]

    tasks = summarize_tasks(productions, roster_user_ids)
    task_rows = await _task_rows(db, tasks["by_member"], org)

    return {
        "period": period,
        "production": summarize_production(productions),
        "staff": summarize_staff(schedules),
        "cost": summarize_cost(calculations),
        "tasks": {"members": task_rows, "unassigned_steps": tasks["unassigned_steps"]},
    }
