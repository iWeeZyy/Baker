"""Les verrous vus depuis l'API.

Ce fichier existe pour une seule propriété, la plus importante de tout le
chantier : **personne ne perd une fonctionnalité qu'il utilise déjà**.

Les tests ne peuvent pas allumer `ENTITLEMENTS_ENFORCED` eux-mêmes — la
variable appartient au processus uvicorn, pas à pytest (`test_ads.py` vit
déjà avec cette contrainte). Ils lisent donc `enforced` dans `/me/plan` et
vérifient **la branche correspondante**, si bien que les deux positions de
l'interrupteur sont couvertes selon la façon dont le serveur a été lancé :
éteint en CI et en développement, allumé le jour où l'abonnement existera.

La logique de décision elle-même, exhaustive et indépendante du serveur, est
dans `test_gating_calc.py`.
"""
import os
import sys
import uuid
from pathlib import Path

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'http://localhost:8000').rstrip('/')
API = f"{BASE_URL}/api"


def _token(email=None, password="TestGate2026!"):
    email = email or f"gate.{uuid.uuid4().hex[:10]}@bakers.app"
    r = requests.post(f"{API}/auth/register",
                      json={"email": email, "password": password, "name": "Chef Verrou"}, timeout=30)
    if r.status_code == 400:
        r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
        if r.status_code == 401:
            pytest.skip(f"{email} existe avec un autre mot de passe (base non vierge)")
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def _plan(token):
    r = requests.get(f"{API}/me/plan", headers=_h(token), timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _recipe_payload(titre):
    """Même forme que `test_recipe_moderation.py::_recipe_payload`."""
    return {
        "title": titre,
        "category": "Pains",
        "difficulty": "facile",
        "time_minutes": 60,
        "description": "Une pâte simple, pétrie puis façonnée.",
        "ingredients": ["500 g farine T65", "350 g eau", "10 g sel"],
        "steps": ["Pétrir 10 min.", "Pointage 1 h.", "Façonner et cuire 25 min."],
    }


class TestPersonneNePerdRien:
    """Interrupteur éteint : tout ce qui marchait marche encore."""

    def test_creer_plus_de_dix_recettes_reste_possible(self):
        """Le plafond Free sur les recettes a été retiré (chantier des
        quotas d'essai — les recettes sont désormais illimitées, quel que
        soit le palier) : au-delà de dix reste toujours possible, avec ou
        sans interrupteur."""
        token = _token()
        for i in range(11):
            r = requests.post(f"{API}/recipes", json=_recipe_payload(f"Pain d'essai {uuid.uuid4().hex[:6]}"),
                              headers=_h(token), timeout=30)
            assert r.status_code == 200, f"recette {i + 1} refusée : {r.text}"

    def test_creer_une_quatrieme_collection_reste_possible(self):
        """Le plafond Free est de 3 collections. Tant qu'il n'est pas
        appliqué, un utilisateur doit pouvoir dépasser sans rien voir
        changer — le nouvel exemple représentatif de ce test depuis que
        les recettes n'ont plus de plafond du tout (voir ci-dessus)."""
        token = _token()
        if _plan(token)["enforced"]:
            pytest.skip("ENTITLEMENTS_ENFORCED est allumé sur ce serveur")
        for i in range(4):
            r = requests.post(f"{API}/collections", json={"name": f"TEST essai {uuid.uuid4().hex[:6]}"},
                              headers=_h(token), timeout=30)
            assert r.status_code == 200, f"collection {i + 1} refusée : {r.text}"

    def test_les_matieres_premieres_restent_ouvertes(self):
        """Elles deviendront Pro+, mais elles sont gratuites aujourd'hui."""
        token = _token()
        if _plan(token)["enforced"]:
            pytest.skip("ENTITLEMENTS_ENFORCED est allumé sur ce serveur")
        r = requests.post(f"{API}/raw-materials", json={
            "name": f"Farine T65 {uuid.uuid4().hex[:6]}",
            "purchase_price": 18.5, "purchase_quantity": 25, "purchase_unit": "kg",
        }, headers=_h(token), timeout=30)
        assert r.status_code == 200, r.text

    def test_le_planning_personnel_reste_ouvert(self):
        token = _token()
        if _plan(token)["enforced"]:
            pytest.skip("ENTITLEMENTS_ENFORCED est allumé sur ce serveur")
        r = requests.post(f"{API}/schedules", json={
            "week_start": "2026-01-04",  # un dimanche
            "employees": [{"name": "Lucas", "days": [{} for _ in range(7)]}],
        }, headers=_h(token), timeout=30)
        assert r.status_code == 200, r.text


class TestQuandLesDroitsSAppliquent:
    """Interrupteur allumé : les refus prennent la forme attendue."""

    def test_la_onzieme_recette_n_est_plus_refusee(self):
        """Décision confirmée avec Lucas (chantier des quotas d'essai) :
        les recettes sont désormais illimitées pour Free, interrupteur
        allumé ou pas."""
        token = _token()
        if not _plan(token)["enforced"]:
            pytest.skip("ENTITLEMENTS_ENFORCED est éteint sur ce serveur")
        for _ in range(10):
            requests.post(f"{API}/recipes", json=_recipe_payload(f"Pain {uuid.uuid4().hex[:6]}"),
                          headers=_h(token), timeout=30)
        r = requests.post(f"{API}/recipes", json=_recipe_payload("Pain suivant"),
                          headers=_h(token), timeout=30)
        assert r.status_code == 200, r.text

    def test_la_quatrieme_collection_est_refusee(self):
        token = _token()
        if not _plan(token)["enforced"]:
            pytest.skip("ENTITLEMENTS_ENFORCED est éteint sur ce serveur")
        for _ in range(3):
            requests.post(f"{API}/collections", json={"name": f"TEST plafond {uuid.uuid4().hex[:6]}"},
                          headers=_h(token), timeout=30)
        r = requests.post(f"{API}/collections", json={"name": "TEST de trop"},
                          headers=_h(token), timeout=30)
        assert r.status_code == 403
        detail = r.json()["detail"]
        assert detail["error"] == "plan_limit_reached"
        assert detail["quota"] == "collections_total"
        assert detail["limit"] == 3

    def test_les_matieres_premieres_sont_reservees(self):
        token = _token()
        if not _plan(token)["enforced"]:
            pytest.skip("ENTITLEMENTS_ENFORCED est éteint sur ce serveur")
        r = requests.post(f"{API}/raw-materials", json={
            "name": "Farine", "purchase_price": 18.5,
            "purchase_quantity": 25, "purchase_unit": "kg",
        }, headers=_h(token), timeout=30)
        assert r.status_code == 403
        detail = r.json()["detail"]
        assert detail["error"] == "plan_feature_locked"
        assert detail["required_plan"] == "pro_plus"


class TestJamaisDeVerrouSurUneLecture:
    """Ce qui rend une rétrogradation non destructive.

    Quel que soit l'état de l'interrupteur, un compte gratuit doit pouvoir
    lire ses propres données — c'est la garantie qu'un Pro qui redescend
    garde ses 300 recettes au lieu de les perdre de vue.
    """

    @pytest.mark.parametrize("chemin", [
        "/recipes", "/raw-materials", "/cost/history", "/schedules", "/productions",
    ])
    def test_les_listes_repondent_toujours(self, chemin):
        r = requests.get(f"{API}{chemin}", headers=_h(_token()), timeout=30)
        assert r.status_code == 200, f"{chemin} : {r.text}"

    def test_une_recette_creee_reste_lisible(self):
        token = _token()
        created = requests.post(f"{API}/recipes", json=_recipe_payload(f"Pain lisible {uuid.uuid4().hex[:6]}"),
                                headers=_h(token), timeout=30)
        assert created.status_code == 200, created.text
        rid = created.json()["id"]
        r = requests.get(f"{API}/recipes/{rid}", headers=_h(token), timeout=30)
        assert r.status_code == 200

    def test_supprimer_n_est_jamais_verrouille(self):
        """Effacer est ce qui fait repasser sous un plafond : le bloquer
        enfermerait l'utilisateur au-dessus de sa limite, sans issue."""
        token = _token()
        if _plan(token)["enforced"]:
            pytest.skip("créer la matière première serait refusé en amont")
        created = requests.post(f"{API}/raw-materials", json={
            "name": f"Beurre {uuid.uuid4().hex[:6]}", "purchase_price": 9.0,
            "purchase_quantity": 1, "purchase_unit": "kg",
        }, headers=_h(token), timeout=30)
        assert created.status_code == 200, created.text
        mid = created.json()["id"]
        r = requests.delete(f"{API}/raw-materials/{mid}", headers=_h(token), timeout=30)
        assert r.status_code == 200, r.text


class TestQuotaDejaApplique:
    """Le quota de productions ne dépend PAS de l'interrupteur.

    Il existait avant ce chantier ; le déploiement n'a pas le droit de le
    desserrer. `test_productions_api.py::TestFreePlanLimit` couvre le refus
    lui-même — ici on vérifie seulement que le compteur reste exposé et
    cohérent, quelle que soit la position de l'interrupteur.
    """

    def test_le_compteur_de_productions_reste_expose(self):
        body = _plan(_token())
        assert body["productions_limit"] == 3
        assert body["productions_used"] == 0
        assert body["productions_remaining"] == 3


class TestQuotasEssaiGratuit:
    """Les quatre quotas d'essai Free ajoutés par ce chantier, tels que
    `/me/plan` les rapporte pour un compte tout neuf — les compteurs
    `used`/`remaining` sont désormais peuplés génériquement pour tout quota
    à plafond fini du palier de l'appelant (`_quotas_with_usage`), pas
    seulement pour les productions.

    Les quotas qui exigent un appel Anthropic réussi pour s'incrémenter
    (`scans_total`, `adapts_total`, `ai_messages_per_month`) ne peuvent pas
    être consommés de bout en bout ici : ce bac à sable n'a pas de
    `ANTHROPIC_API_KEY`, donc `/recipes/scan/analyze` et `/chat` renvoient
    503 avant tout appel IA — `record_ai_usage` n'est alors jamais atteint.
    Le mécanisme de comptage/blocage lui-même est couvert exhaustivement,
    avec un faux compteur, par `test_gating_calc.py::TestNouveauxQuotasEssaiGratuit`
    et `TestMultiQuota`. Ici, on vérifie ce qui est vérifiable sans clé
    réelle : les plafonds exposés à zéro consommation, et — pour
    `schedules_total`, qui ne dépend d'aucune IA — le blocage réel de bout
    en bout.
    """

    def test_les_plafonds_free_sont_exposes_a_zero_consommation(self):
        body = _plan(_token())
        quotas = body["quotas"]
        assert quotas["scans_total"] == {"limit": 3, "period": "usage", "used": 0, "remaining": 3}
        assert quotas["adapts_total"] == {"limit": 5, "period": "usage", "used": 0, "remaining": 5}
        assert quotas["collections_total"] == {"limit": 3, "period": "total", "used": 0, "remaining": 3}
        assert quotas["schedules_total"] == {"limit": 3, "period": "total", "used": 0, "remaining": 3}
        assert quotas["ai_messages_per_month"]["limit"] == 10
        assert quotas["recipes_total"] == {"limit": None, "period": "total"}  # illimité : pas de used/remaining

    def test_la_quatrieme_grille_personnel_est_refusee(self):
        """`schedules_total` (stock, 3 pour Free) ne dépend d'aucun appel
        IA — vérifiable de bout en bout, contrairement au scan/à l'IA."""
        token = _token()
        if not _plan(token)["enforced"]:
            pytest.skip("ENTITLEMENTS_ENFORCED est éteint sur ce serveur")
        for i in range(3):
            r = requests.post(f"{API}/schedules", json={
                "week_start": "2026-01-04",
                "employees": [{"name": f"Employé {i}", "days": [{} for _ in range(7)]}],
            }, headers=_h(token), timeout=30)
            assert r.status_code == 200, f"grille {i + 1} refusée : {r.text}"
        r = requests.post(f"{API}/schedules", json={
            "week_start": "2026-01-11",
            "employees": [{"name": "Employé de trop", "days": [{} for _ in range(7)]}],
        }, headers=_h(token), timeout=30)
        assert r.status_code == 403
        detail = r.json()["detail"]
        assert detail["error"] == "plan_limit_reached"
        assert detail["quota"] == "schedules_total"
        assert detail["limit"] == 3

    def test_supprimer_une_grille_libere_une_place(self):
        """Stock : supprimer une grille rouvre la place, contrairement à un
        quota d'usage (scans_total/adapts_total) qui ne rembourse jamais."""
        token = _token()
        if not _plan(token)["enforced"]:
            pytest.skip("ENTITLEMENTS_ENFORCED est éteint sur ce serveur")
        ids = []
        for i, week in enumerate(["2026-02-01", "2026-02-08", "2026-02-15"]):
            r = requests.post(f"{API}/schedules", json={
                "week_start": week,
                "employees": [{"name": f"Employé {i}", "days": [{} for _ in range(7)]}],
            }, headers=_h(token), timeout=30)
            assert r.status_code == 200, r.text
            ids.append(r.json()["id"])
        # La 4e est refusée tant que les 3 places sont prises.
        r = requests.post(f"{API}/schedules", json={
            "week_start": "2026-02-22",
            "employees": [{"name": "Employé refusé", "days": [{} for _ in range(7)]}],
        }, headers=_h(token), timeout=30)
        assert r.status_code == 403
        # Une suppression libère la place.
        r = requests.delete(f"{API}/schedules/{ids[0]}", headers=_h(token), timeout=30)
        assert r.status_code == 200, r.text
        r = requests.post(f"{API}/schedules", json={
            "week_start": "2026-02-22",
            "employees": [{"name": "Employé recree", "days": [{} for _ in range(7)]}],
        }, headers=_h(token), timeout=30)
        assert r.status_code == 200, r.text

    def test_dupliquer_ne_contourne_pas_schedules_total(self):
        """`POST /schedules/{id}/duplicate` insère une grille de plus, tout
        comme `POST /schedules` — sans son propre contrôle de quota, un
        compte à la limite pourrait dupliquer indéfiniment une grille déjà
        possédée pour dépasser le plafond `schedules_total`."""
        token = _token()
        if not _plan(token)["enforced"]:
            pytest.skip("ENTITLEMENTS_ENFORCED est éteint sur ce serveur")
        source_id = None
        for i, week in enumerate(["2026-03-01", "2026-03-08", "2026-03-15"]):
            r = requests.post(f"{API}/schedules", json={
                "week_start": week,
                "employees": [{"name": f"Employé {i}", "days": [{} for _ in range(7)]}],
            }, headers=_h(token), timeout=30)
            assert r.status_code == 200, r.text
            source_id = r.json()["id"]
        r = requests.post(f"{API}/schedules/{source_id}/duplicate",
                          json={"week_start": "2026-03-22"}, headers=_h(token), timeout=30)
        assert r.status_code == 403, r.text
        detail = r.json()["detail"]
        assert detail["error"] == "plan_limit_reached"
        assert detail["quota"] == "schedules_total"
