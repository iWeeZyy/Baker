"""L'abonnement, sans serveur : la machine à états, la priorité des sources,
et la couche base sur un mongomock jetable.

Trois blocs, dans l'ordre du garde-fou approuvé pour la phase 5 :

1. `subscription_state.py` — pur, table par état (5 statuts) × expiration ×
   grâce. C'est ici que vit la décision centrale du module : **le timestamp
   fait foi, jamais la chaîne `status`** (voir son docstring).
2. `plans.resolve_plan` — l'ordre de priorité à quatre sources
   (`PRO_EMAILS` > `PLAN_OVERRIDES` > abonnement > `user.plan` > Free), pur
   lui aussi une fois l'abonnement et les surcharges d'environnement injectés.
3. `subscriptions.py` — la seule partie impure : `record_event`/`get_subscription`
   contre un `db.subscriptions` mongomock, même esprit que
   `test_retire_seed.py`. `record_event` doit être **idempotent sur
   `event_id`** : un webhook rejoué ne doit ni dupliquer l'historique ni
   rouvrir un abonnement déjà résilié.
"""
import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from mongomock_motor import AsyncMongoMockClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import HTTPException  # noqa: E402

import plans  # noqa: E402
import subscription_state as st  # noqa: E402
import subscriptions  # noqa: E402
from entitlements import FREE, PRO, PRO_PLUS, TEAM  # noqa: E402
from routers.subscription import _authorize  # noqa: E402

NOW = datetime(2026, 6, 15, 12, 0, tzinfo=timezone.utc)
FUTURE = NOW + timedelta(days=10)
PAST = NOW - timedelta(days=10)


def _sub(**over):
    base = {"plan": PRO, "status": st.ACTIVE, "current_period_end": FUTURE}
    base.update(over)
    return base


# ---------------------------------------------------------------------------
# 1. subscription_state.py — la machine à états pure
# ---------------------------------------------------------------------------

class TestIsGranting:
    def test_aucun_abonnement_ne_donne_rien(self):
        assert st.is_granting(None, NOW) is False

    @pytest.mark.parametrize("status", [st.ACTIVE, st.TRIALING, st.CANCELLED])
    def test_les_trois_statuts_accordent_tant_que_l_echeance_est_future(self, status):
        assert st.is_granting(_sub(status=status), NOW) is True

    @pytest.mark.parametrize("status", [st.ACTIVE, st.TRIALING, st.CANCELLED])
    def test_mais_plus_une_fois_l_echeance_passee(self, status):
        """La règle centrale : `active` ne suffit pas, la date fait foi."""
        assert st.is_granting(_sub(status=status, current_period_end=PAST), NOW) is False

    def test_expired_ne_donne_jamais_rien_meme_echeance_future(self):
        """`expired` est exclu de `_GRANTING` par construction : peu importe
        ce que porterait une échéance, ce statut ne rend rien."""
        assert st.is_granting(_sub(status=st.EXPIRED, current_period_end=FUTURE), NOW) is False

    def test_aucune_echeance_connue_ne_donne_rien(self):
        """Mieux vaut rétrograder à tort un document incomplet que d'ouvrir
        un palier payant sur une absence."""
        assert st.is_granting(_sub(current_period_end=None), NOW) is False


class TestPastDueEtGrace:
    def test_grace_until_futur_accorde_encore(self):
        sub = _sub(status=st.PAST_DUE, current_period_end=PAST,
                   grace_until=NOW + timedelta(days=1))
        assert st.is_granting(sub, NOW) is True

    def test_grace_until_passe_ne_donne_plus_rien(self):
        sub = _sub(status=st.PAST_DUE, current_period_end=PAST,
                   grace_until=NOW - timedelta(hours=1))
        assert st.is_granting(sub, NOW) is False

    def test_sans_grace_until_la_grace_part_de_l_echeance(self, monkeypatch):
        monkeypatch.delenv("PAYMENT_GRACE_DAYS", raising=False)
        # Échéance + 3 jours par défaut : encore dans la fenêtre à J+2.
        sub = _sub(status=st.PAST_DUE, current_period_end=NOW - timedelta(days=2))
        assert st.is_granting(sub, NOW) is True
        # Mais plus à J+4.
        sub = _sub(status=st.PAST_DUE, current_period_end=NOW - timedelta(days=4))
        assert st.is_granting(sub, NOW) is False

    def test_grace_days_est_configurable(self, monkeypatch):
        monkeypatch.setenv("PAYMENT_GRACE_DAYS", "10")
        assert st.grace_days() == 10
        sub = _sub(status=st.PAST_DUE, current_period_end=NOW - timedelta(days=7))
        assert st.is_granting(sub, NOW) is True

    def test_grace_days_invalide_retombe_sur_le_defaut(self, monkeypatch):
        monkeypatch.setenv("PAYMENT_GRACE_DAYS", "pas-un-nombre")
        assert st.grace_days() == st.DEFAULT_GRACE_DAYS

    def test_grace_days_negative_est_plafonne_a_zero(self, monkeypatch):
        monkeypatch.setenv("PAYMENT_GRACE_DAYS", "-5")
        assert st.grace_days() == 0

    def test_past_due_sans_aucune_date_ne_donne_rien(self):
        sub = _sub(status=st.PAST_DUE, current_period_end=None, grace_until=None)
        assert st.is_granting(sub, NOW) is False


class TestPlanOf:
    def test_palier_du_document_quand_ca_accorde(self):
        assert st.plan_of(_sub(plan=PRO_PLUS), NOW) == PRO_PLUS

    def test_free_quand_ca_n_accorde_plus(self):
        assert st.plan_of(_sub(plan=TEAM, current_period_end=PAST), NOW) == FREE

    def test_un_palier_inconnu_normalise_vers_free(self):
        """`normalize()` rend Free pour tout ce qui n'est pas dans l'échelle
        plutôt que de lever — un webhook malformé ne doit jamais planter."""
        assert st.plan_of(_sub(plan="palier-invente"), NOW) == FREE


class TestDescribe:
    def test_sans_abonnement_l_etat_est_neutre(self):
        assert st.describe(None, NOW) == {
            "status": None, "plan": FREE, "active": False,
            "renews_at": None, "ends_at": None, "in_grace": False,
        }

    def test_actif_et_pas_resilie_promet_un_renouvellement(self):
        out = st.describe(_sub(), NOW)
        assert out["status"] == st.ACTIVE
        assert out["plan"] == PRO
        assert out["active"] is True
        assert out["renews_at"] == FUTURE.isoformat()
        assert out["ends_at"] is None
        assert out["in_grace"] is False
        assert out["trial"] is False

    def test_resilie_annonce_une_fin_jamais_un_renouvellement(self):
        """`renews_at` et `ends_at` sont mutuellement exclusifs : l'écran ne
        doit jamais avoir à deviner lequel des deux mots employer."""
        out = st.describe(_sub(status=st.CANCELLED), NOW)
        assert out["active"] is True  # encore payé jusqu'à l'échéance
        assert out["renews_at"] is None
        assert out["ends_at"] == FUTURE.isoformat()

    def test_actif_avec_cancel_at_period_end_compte_comme_resilie(self):
        """Un abonnement encore `active` mais déjà annulé pour la fin de
        période doit, lui aussi, annoncer une fin plutôt qu'un renouvellement."""
        out = st.describe(_sub(cancel_at_period_end=True), NOW)
        assert out["renews_at"] is None
        assert out["ends_at"] == FUTURE.isoformat()

    def test_essai_en_cours(self):
        out = st.describe(_sub(status=st.TRIALING), NOW)
        assert out["trial"] is True
        assert out["active"] is True

    def test_past_due_en_grace_est_signale(self):
        sub = _sub(status=st.PAST_DUE, current_period_end=PAST,
                   grace_until=NOW + timedelta(days=1))
        out = st.describe(sub, NOW)
        assert out["active"] is True
        assert out["in_grace"] is True

    def test_expire_n_est_plus_actif_et_retombe_sur_free(self):
        out = st.describe(_sub(status=st.EXPIRED), NOW)
        assert out["active"] is False
        assert out["plan"] == FREE


class TestTierForProduct:
    @pytest.mark.parametrize("product_id,attendu", [
        ("levanea_pro_monthly", PRO),
        ("levanea_pro_plus_monthly", PRO_PLUS),
        ("levanea_team_monthly", TEAM),
    ])
    def test_produits_connus(self, product_id, attendu):
        assert st.tier_for_product(product_id) == attendu

    @pytest.mark.parametrize("product_id", [None, "", "produit-invente", "levanea_pro_yearly"])
    def test_produit_inconnu_n_accorde_rien(self, product_id):
        """Un identifiant mal saisi dans la console du store ne doit pas
        pouvoir ouvrir un palier au hasard."""
        assert st.tier_for_product(product_id) is None


# ---------------------------------------------------------------------------
# 2. plans.resolve_plan — l'ordre de priorité à quatre sources
# ---------------------------------------------------------------------------

class TestResolvePlanPriorite:
    """`PRO_EMAILS` > `PLAN_OVERRIDES` > abonnement > `user.plan` > Free,
    dans cet ordre exact — voir le docstring de `resolve_plan`."""

    def test_pro_emails_gagne_sur_tout_le_reste(self, monkeypatch):
        monkeypatch.setenv("PRO_EMAILS", "chef@bakers.app")
        monkeypatch.setenv("PLAN_OVERRIDES", "chef@bakers.app:team")
        user = {"email": "chef@bakers.app", "plan": "pro_plus"}
        sub = _sub(plan=TEAM)  # accorderait Équipe si on le laissait parler
        assert plans.resolve_plan(user, sub, NOW) == PRO

    def test_plan_overrides_gagne_sur_l_abonnement(self, monkeypatch):
        monkeypatch.delenv("PRO_EMAILS", raising=False)
        monkeypatch.setenv("PLAN_OVERRIDES", "chef@bakers.app:pro_plus")
        user = {"email": "chef@bakers.app", "plan": "free"}
        sub = _sub(plan=TEAM)
        assert plans.resolve_plan(user, sub, NOW) == PRO_PLUS

    def test_l_abonnement_gagne_sur_user_plan(self, monkeypatch):
        monkeypatch.delenv("PRO_EMAILS", raising=False)
        monkeypatch.delenv("PLAN_OVERRIDES", raising=False)
        user = {"email": "chef@bakers.app", "plan": "free"}
        sub = _sub(plan=PRO_PLUS)
        assert plans.resolve_plan(user, sub, NOW) == PRO_PLUS

    def test_un_abonnement_expire_ne_masque_pas_le_plan_stocke(self, monkeypatch):
        """Un abonnement périmé retombe sur la source suivante plutôt que
        sur Free d'office — un palier posé en base à la main reste lisible."""
        monkeypatch.delenv("PRO_EMAILS", raising=False)
        monkeypatch.delenv("PLAN_OVERRIDES", raising=False)
        user = {"email": "chef@bakers.app", "plan": "pro"}
        sub = _sub(plan=TEAM, current_period_end=PAST)
        assert plans.resolve_plan(user, sub, NOW) == PRO

    def test_sans_rien_du_tout_c_est_free(self, monkeypatch):
        monkeypatch.delenv("PRO_EMAILS", raising=False)
        monkeypatch.delenv("PLAN_OVERRIDES", raising=False)
        user = {"email": "personne@bakers.app"}
        assert plans.resolve_plan(user, None, NOW) == FREE

    def test_appelants_sans_abonnement_gardent_le_comportement_d_avant(self, monkeypatch):
        """Le paramètre `subscription` est optionnel : un appelant qui ne le
        fournit pas doit obtenir exactement ce que la phase 2 rendait déjà."""
        monkeypatch.delenv("PRO_EMAILS", raising=False)
        monkeypatch.delenv("PLAN_OVERRIDES", raising=False)
        user = {"email": "chef@bakers.app", "plan": "pro_plus"}
        assert plans.resolve_plan(user) == PRO_PLUS


# ---------------------------------------------------------------------------
# 3. subscriptions.py — la couche base, sur un mongomock jetable
# ---------------------------------------------------------------------------

@pytest.fixture
def fake_db(monkeypatch):
    db = AsyncMongoMockClient()["subs_test"]
    monkeypatch.setattr(subscriptions, "db", db)
    return db


def test_get_subscription_absent_rend_none(fake_db):
    assert asyncio.run(subscriptions.get_subscription("u1")) is None


def test_record_event_puis_lecture(fake_db):
    async def run():
        doc = await subscriptions.record_event(
            "u1", event_id="evt-1", event_type="INITIAL_PURCHASE",
            plan=PRO_PLUS, status=st.ACTIVE, product_id="levanea_pro_plus_monthly",
            store="app_store", current_period_end=FUTURE.isoformat(),
        )
        assert doc["plan"] == PRO_PLUS
        assert doc["status"] == st.ACTIVE
        assert len(doc["history"]) == 1
        relu = await subscriptions.get_subscription("u1")
        assert relu["plan"] == PRO_PLUS
        assert relu["last_event_id"] == "evt-1"
    asyncio.run(run())


def test_rejouer_le_meme_event_id_ne_change_rien(fake_db):
    async def run():
        await subscriptions.record_event(
            "u1", event_id="evt-1", event_type="INITIAL_PURCHASE",
            plan=PRO, status=st.ACTIVE, current_period_end=FUTURE.isoformat())
        # Un événement de résiliation rejoué avec le MÊME id ne doit pas
        # s'appliquer par-dessus : sinon un abonnement déjà résilié se
        # rouvrirait, ou verrait son historique dupliqué, à chaque nouvelle
        # tentative de livraison du fournisseur de webhook. (La comparaison
        # porte sur les champs métier, pas l'objet entier : mongomock — comme
        # un vrai Mongo — arrondit les datetimes au relire, ce qui n'a rien
        # à voir avec l'idempotence testée ici.)
        rejoue = await subscriptions.record_event(
            "u1", event_id="evt-1", event_type="CANCELLATION",
            plan=FREE, status=st.CANCELLED)
        assert rejoue["plan"] == PRO
        assert rejoue["status"] == st.ACTIVE
        assert rejoue["last_event_id"] == "evt-1"
        assert len(rejoue["history"]) == 1
        assert rejoue["history"][0]["type"] == "INITIAL_PURCHASE"
    asyncio.run(run())


def test_un_evenement_different_s_applique_normalement(fake_db):
    async def run():
        await subscriptions.record_event(
            "u1", event_id="evt-1", event_type="INITIAL_PURCHASE",
            plan=PRO, status=st.ACTIVE, current_period_end=FUTURE.isoformat())
        second = await subscriptions.record_event(
            "u1", event_id="evt-2", event_type="RENEWAL",
            plan=PRO, status=st.ACTIVE, current_period_end=(FUTURE + timedelta(days=30)).isoformat())
        assert second["last_event_id"] == "evt-2"
        assert len(second["history"]) == 2
    asyncio.run(run())


def test_historique_tronque_au_dela_de_max_history(fake_db):
    async def run():
        for i in range(subscriptions.MAX_HISTORY + 5):
            await subscriptions.record_event(
                "u1", event_id=f"evt-{i}", event_type="RENEWAL",
                plan=PRO, status=st.ACTIVE, current_period_end=FUTURE.isoformat())
        doc = await subscriptions.get_subscription("u1")
        assert len(doc["history"]) == subscriptions.MAX_HISTORY
        # Le plus récent événement reste le dernier de la liste.
        assert doc["history"][-1]["event_id"] == f"evt-{subscriptions.MAX_HISTORY + 4}"
    asyncio.run(run())


def test_plan_for_delegue_a_resolve_plan(fake_db, monkeypatch):
    async def run():
        monkeypatch.delenv("PRO_EMAILS", raising=False)
        monkeypatch.delenv("PLAN_OVERRIDES", raising=False)
        await subscriptions.record_event(
            "u1", event_id="evt-1", event_type="INITIAL_PURCHASE",
            plan=TEAM, status=st.ACTIVE, current_period_end=FUTURE.isoformat())
        user = {"user_id": "u1", "email": "chef@bakers.app", "plan": "free"}
        assert await subscriptions.plan_for(user, NOW) == TEAM
    asyncio.run(run())


def test_public_state_est_un_pur_passe_plat_vers_describe(fake_db):
    assert subscriptions.public_state(None, NOW) == st.describe(None, NOW)


# ---------------------------------------------------------------------------
# 4. `_authorize` — le refus sans secret configuré (`routers/subscription.py`)
# ---------------------------------------------------------------------------
# État du *serveur*, pas du compte : contrairement au reste de ce fichier, il
# ne peut pas être exercé contre le serveur HTTP partagé de la CI, qui a
# justement un secret configuré (voir test_subscriptions_api.py). Testé ici en
# unitaire à la place, en manipulant directement `os.environ`.

class TestAutorizeWebhook:
    def test_sans_secret_configure_refuse_tout_par_defaut(self, monkeypatch):
        """Une route de facturation ouverte par défaut accorderait un palier
        payant à n'importe qui : elle doit refuser plutôt que de laisser
        passer faute de configuration."""
        monkeypatch.delenv("REVENUECAT_WEBHOOK_SECRET", raising=False)
        with pytest.raises(HTTPException) as exc:
            _authorize("Bearer peu-importe")
        assert exc.value.status_code == 503

    def test_avec_secret_configure_un_mauvais_en_tete_est_refuse(self, monkeypatch):
        monkeypatch.setenv("REVENUECAT_WEBHOOK_SECRET", "le-bon-secret")
        with pytest.raises(HTTPException) as exc:
            _authorize("Bearer mauvais-secret")
        assert exc.value.status_code == 401

    def test_le_bon_secret_passe_avec_ou_sans_prefixe_bearer(self, monkeypatch):
        monkeypatch.setenv("REVENUECAT_WEBHOOK_SECRET", "le-bon-secret")
        _authorize("Bearer le-bon-secret")  # ne lève pas
        _authorize("le-bon-secret")  # ne lève pas non plus
        _authorize("bearer le-bon-secret")  # insensible à la casse du préfixe
