"""Droits par offre, vus depuis l'API.

Ce fichier garde deux choses que les tests purs ne peuvent pas voir :

1. **Le contrat de `/me/plan` ne rétrécit jamais.** Une application déjà
   livrée lit `plan`, `limits`, `productions_*` et `ads` ; renommer ou
   retirer une de ces clés casserait les écrans en circulation. Les
   nouvelles clés s'ajoutent à côté, elles ne remplacent rien.
2. **Le palier ne se forge pas côté client.** Il est résolu côté serveur à
   partir du compte, jamais d'une valeur envoyée dans la requête ou glissée
   dans un jeton.

Les comptes Pro+/Équipe viennent de `PLAN_OVERRIDES` (voir `plans.py` et
`ci.yml`). Faute de cette variable, les tests concernés s'ignorent plutôt
que d'échouer — même convention que `requires_test_ban_word` dans
`test_recipe_moderation.py`.
"""
import os
import sys
import uuid
from pathlib import Path

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from entitlements import MIN_TIER, QUOTA_KEYS, TIER_ORDER  # noqa: E402

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'http://localhost:8000').rstrip('/')
API = f"{BASE_URL}/api"

# Les clés que l'application livrée lit déjà : elles doivent survivre à toute
# évolution de la charge utile.
LEGACY_KEYS = ("plan", "limits", "productions_used", "productions_limit",
               "productions_remaining", "ads")
LEGACY_LIMIT_KEYS = ("productions_per_month", "multi_day", "recurring",
                     "sharing", "full_history")


def _overrides() -> dict:
    out = {}
    for entry in os.environ.get("PLAN_OVERRIDES", "").split(","):
        email, _, tier = entry.partition(":")
        if email.strip() and tier.strip():
            out[tier.strip()] = email.strip()
    return out


OVERRIDES = _overrides()
requires_override = pytest.mark.skipif(
    not OVERRIDES,
    reason="PLAN_OVERRIDES non défini : aucun compte Pro+/Équipe à exercer",
)


def _token(email=None, password="TestEnt2026!"):
    email = email or f"ent.{uuid.uuid4().hex[:10]}@bakers.app"
    r = requests.post(f"{API}/auth/register",
                      json={"email": email, "password": password, "name": "Chef Droits"}, timeout=30)
    if r.status_code == 400:  # adresse fixe déjà créée par un autre fichier
        r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
        if r.status_code == 401:
            # Le compte existe avec un autre mot de passe : base de dev
            # réutilisée, pas une régression du code. En CI la base est neuve,
            # donc ce cas ne s'y produit pas et le test s'exécute vraiment.
            pytest.skip(f"{email} existe déjà avec un autre mot de passe (base non vierge)")
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _plan(token) -> dict:
    r = requests.get(f"{API}/me/plan", headers={"Authorization": f"Bearer {token}"}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


class TestContratHistorique:
    """`/me/plan` s'étend, ne rétrécit jamais."""

    def test_les_cles_historiques_sont_toutes_la(self):
        body = _plan(_token())
        for key in LEGACY_KEYS:
            assert key in body, f"clé historique disparue : {key}"

    def test_la_forme_de_limits_est_inchangee(self):
        body = _plan(_token())
        for key in LEGACY_LIMIT_KEYS:
            assert key in body["limits"], f"limits.{key} a disparu"

    def test_un_compte_gratuit_garde_son_quota_de_trois_productions(self):
        body = _plan(_token())
        assert body["plan"] == "free"
        assert body["productions_limit"] == 3
        assert body["productions_remaining"] is not None


class TestNouvellesCles:
    def test_features_quotas_plans_et_interrupteur(self):
        body = _plan(_token())
        for key in ("enforced", "features", "quotas", "plans"):
            assert key in body, f"nouvelle clé absente : {key}"
        assert set(body["features"]) == set(MIN_TIER)
        assert set(body["quotas"]) == set(QUOTA_KEYS)

    def test_chaque_fonctionnalite_porte_les_trois_champs(self):
        features = _plan(_token())["features"]
        for key, state in features.items():
            assert set(state) == {"allowed", "locked", "min_plan"}, key

    def test_le_catalogue_liste_les_quatre_offres_dans_l_ordre(self):
        plans = _plan(_token())["plans"]
        assert [o["plan"] for o in plans] == list(TIER_ORDER)
        assert [o["price_eur"] for o in plans] == [0.0, 9.90, 19.90, 39.90]

    def test_un_compte_gratuit_voit_les_droits_qu_il_n_a_pas(self):
        """L'écran d'abonnement a besoin de la vérité de l'offre, pas d'un vide."""
        features = _plan(_token())["features"]
        assert features["cost_materials"]["allowed"] is False
        assert features["cost_materials"]["min_plan"] == "pro_plus"


class TestPersonneNePerdRien:
    """Le garde-fou central tant que l'abonnement n'est pas achetable.

    Interrupteur éteint (le défaut), aucune fonctionnalité n'est verrouillée,
    y compris celles auxquelles le palier ne donne pas droit. Si un jour ce
    test échoue sans que `ENTITLEMENTS_ENFORCED` ait été allumé volontairement,
    c'est que des utilisateurs viennent de perdre des fonctionnalités.
    """

    def test_rien_n_est_verrouille_interrupteur_eteint(self):
        body = _plan(_token())
        if body["enforced"]:
            pytest.skip("ENTITLEMENTS_ENFORCED est allumé sur ce serveur")
        assert all(f["locked"] is False for f in body["features"].values())

    def test_quand_l_interrupteur_est_allume_le_verrou_suit_le_droit(self):
        body = _plan(_token())
        if not body["enforced"]:
            pytest.skip("ENTITLEMENTS_ENFORCED est éteint sur ce serveur")
        for key, state in body["features"].items():
            assert state["locked"] == (not state["allowed"]), key


class TestResolutionDuPalier:
    def test_un_compte_ordinaire_est_gratuit(self):
        assert _plan(_token())["plan"] == "free"

    def test_le_palier_ne_se_forge_pas_depuis_le_client(self):
        """Envoyer un palier à l'inscription ne doit rien accorder."""
        email = f"ent.forge.{uuid.uuid4().hex[:8]}@bakers.app"
        r = requests.post(f"{API}/auth/register", json={
            "email": email, "password": "TestEnt2026!", "name": "Forgeur",
            "plan": "team",  # champ inconnu du modèle : doit être ignoré
        }, timeout=30)
        assert r.status_code == 200, r.text
        assert _plan(r.json()["token"])["plan"] == "free"

    @requires_override
    @pytest.mark.parametrize("tier", ["pro_plus", "team"])
    def test_les_paliers_superieurs_se_resolvent(self, tier):
        email = OVERRIDES.get(tier)
        if not email:
            pytest.skip(f"aucun compte {tier} dans PLAN_OVERRIDES")
        body = _plan(_token(email))
        assert body["plan"] == tier
        assert body["productions_limit"] is None
        assert body["ads"]["enabled"] is False, "un compte payant ne voit jamais de publicité"

    @requires_override
    def test_pro_plus_debloque_les_matieres_premieres_pas_l_equipe(self):
        email = OVERRIDES.get("pro_plus")
        if not email:
            pytest.skip("aucun compte pro_plus dans PLAN_OVERRIDES")
        features = _plan(_token(email))["features"]
        assert features["cost_materials"]["allowed"] is True
        assert features["org_team"]["allowed"] is False

    @requires_override
    def test_equipe_a_tout(self):
        email = OVERRIDES.get("team")
        if not email:
            pytest.skip("aucun compte team dans PLAN_OVERRIDES")
        features = _plan(_token(email))["features"]
        assert all(f["allowed"] for f in features.values())
