"""La couture d'application des droits — tests purs, sans serveur.

Le cœur de ce fichier est la propriété la plus facile à casser sans s'en
apercevoir : **l'interrupteur ne gouverne que les restrictions nouvelles**.
Un quota déjà appliqué avant ce chantier doit continuer de l'être même
interrupteur éteint, sinon le déploiement desserrerait une limite existante
en silence.

`check()` touche la base pour compter, donc les tests injectent un faux `db`
minimal plutôt que de monter un serveur — même esprit que les autres tests
purs (`test_entitlements_calc.py`, `test_production_calc.py`).
"""
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import gating  # noqa: E402
from entitlements import FREE, PRO, PRO_PLUS, TEAM  # noqa: E402


class _FakeCollection:
    def __init__(self, count: int = 0):
        self._count = count

    async def count_documents(self, *_args, **_kwargs) -> int:
        return self._count


class _FakeDb:
    """Assez de `db` pour que `usage()` réponde, et rien de plus."""

    def __init__(self, **counts):
        self.recipes = _FakeCollection(counts.get("recipes", 0))
        self.productions = _FakeCollection(counts.get("productions", 0))
        self.ai_usage = _FakeCollection(counts.get("ai_usage", 0))
        self.org_members = _FakeCollection(counts.get("org_members", 0))


@pytest.fixture
def db(monkeypatch):
    """Remplace `gating.db` ; chaque test dit combien de documents existent."""
    def _install(**counts):
        fake = _FakeDb(**counts)
        monkeypatch.setattr(gating, "db", fake)
        return fake
    return _install


@pytest.fixture
def switch(monkeypatch):
    """Allume ou éteint `ENTITLEMENTS_ENFORCED` sans toucher l'environnement."""
    def _set(on: bool):
        monkeypatch.setattr(gating, "entitlements_enforced", lambda: on)
    return _set


@pytest.fixture
def as_plan(monkeypatch):
    """Impose le palier sans abonnement réel : `check()` lit
    `subscriptions.plan_for(user)`, phase 5 l'ayant remplacé à l'ancien
    `resolve_plan(user)` direct pour prendre en compte un abonnement."""
    def _set(plan: str):
        async def _fake_plan_for(_user, *_a, **_k):
            return plan
        monkeypatch.setattr(gating.subscriptions, "plan_for", _fake_plan_for)
    return _set


USER = {"user_id": "u1", "email": "chef@bakers.app"}


async def _check(**kwargs):
    await gating.check(USER, **kwargs)


class TestInterrupteurEteint:
    """Le défaut : on annonce les droits, on ne refuse rien de nouveau."""

    @pytest.mark.asyncio
    async def test_une_fonctionnalite_reservee_passe_quand_meme(self, switch, as_plan, db):
        switch(False); as_plan(FREE); db()
        await _check(feature="cost_materials")  # ne lève pas

    @pytest.mark.asyncio
    async def test_un_quota_nouveau_ne_bloque_pas(self, switch, as_plan, db):
        """10 recettes en Free, l'utilisateur en a 50 : rien ne doit bloquer."""
        switch(False); as_plan(FREE); db(recipes=50)
        await _check(quota="recipes_total")

    @pytest.mark.asyncio
    async def test_mais_le_quota_de_productions_reste_applique(self, switch, as_plan, db):
        """L'invariant central de ce fichier.

        Trois productions par mois est appliqué depuis toujours. L'interrupteur
        n'a pas le droit de le desserrer : sinon ce déploiement rendrait les
        productions illimitées pour tout le monde, en silence.
        """
        switch(False); as_plan(FREE); db(productions=3)
        with pytest.raises(HTTPException) as exc:
            await _check(quota="productions_per_month")
        assert exc.value.status_code == 403
        assert exc.value.detail["error"] == "plan_limit_reached"

    @pytest.mark.asyncio
    async def test_et_laisse_passer_tant_qu_il_reste_de_la_place(self, switch, as_plan, db):
        switch(False); as_plan(FREE); db(productions=2)
        await _check(quota="productions_per_month")

    def test_la_liste_des_quotas_toujours_appliques_est_explicite(self):
        """Y ajouter une clé desserre ou resserre un comportement existant :
        que ce soit un geste conscient, pas un effet de bord."""
        assert gating.ALWAYS_ENFORCED_QUOTAS == frozenset({"productions_per_month"})


class TestInterrupteurAllume:
    @pytest.mark.asyncio
    async def test_fonctionnalite_reservee_refusee(self, switch, as_plan, db):
        switch(True); as_plan(FREE); db()
        with pytest.raises(HTTPException) as exc:
            await _check(feature="cost_materials")
        detail = exc.value.detail
        assert exc.value.status_code == 403
        assert detail["error"] == "plan_feature_locked"
        assert detail["feature"] == "cost_materials"
        assert detail["required_plan"] == PRO_PLUS
        assert detail["message"]

    @pytest.mark.asyncio
    async def test_fonctionnalite_acquise_passe(self, switch, as_plan, db):
        switch(True); as_plan(PRO_PLUS); db()
        await _check(feature="cost_materials")

    @pytest.mark.asyncio
    async def test_quota_de_recettes_applique(self, switch, as_plan, db):
        switch(True); as_plan(FREE); db(recipes=10)
        with pytest.raises(HTTPException) as exc:
            await _check(quota="recipes_total")
        assert exc.value.detail["limit"] == 10
        assert exc.value.detail["used"] == 10
        assert exc.value.detail["period"] == "total"

    @pytest.mark.asyncio
    async def test_la_derniere_place_est_encore_bonne(self, switch, as_plan, db):
        switch(True); as_plan(FREE); db(recipes=9)
        await _check(quota="recipes_total")

    @pytest.mark.asyncio
    async def test_illimite_ne_bloque_jamais(self, switch, as_plan, db):
        switch(True); as_plan(PRO); db(recipes=10_000)
        await _check(quota="recipes_total")

    @pytest.mark.asyncio
    async def test_quota_a_zero_bloque_des_le_premier(self, switch, as_plan, db):
        switch(True); as_plan(FREE); db(ai_usage=0)
        with pytest.raises(HTTPException) as exc:
            await _check(quota="scans_per_month")
        assert exc.value.detail["limit"] == 0
        # Un plafond à zéro n'est pas « vous avez atteint 0 » : c'est
        # l'absence de la fonctionnalité dans l'offre.
        assert "n'est pas incluse" in exc.value.detail["message"]


class TestAmount:
    """Une écriture qui consomme plusieurs unités d'un coup."""

    @pytest.mark.asyncio
    async def test_une_grille_de_quinze_passe_en_pro(self, switch, as_plan, db):
        switch(True); as_plan(PRO); db()
        await _check(quota="schedule_employees", amount=15)

    @pytest.mark.asyncio
    async def test_une_grille_de_seize_est_refusee(self, switch, as_plan, db):
        switch(True); as_plan(PRO); db()
        with pytest.raises(HTTPException) as exc:
            await _check(quota="schedule_employees", amount=16)
        assert exc.value.detail["limit"] == 15


class TestContratDErreur:
    """La forme historique, que le frontend lit déjà."""

    @pytest.mark.asyncio
    async def test_les_cles_du_payload_de_quota(self, switch, as_plan, db):
        switch(False); as_plan(FREE); db(productions=3)
        with pytest.raises(HTTPException) as exc:
            await _check(quota="productions_per_month")
        assert set(exc.value.detail) == {"error", "limit", "used", "period", "message"}

    @pytest.mark.asyncio
    async def test_les_cles_du_payload_de_fonctionnalite(self, switch, as_plan, db):
        switch(True); as_plan(FREE); db()
        with pytest.raises(HTTPException) as exc:
            await _check(feature="org_team")
        assert set(exc.value.detail) == {"error", "feature", "required_plan", "message"}
        assert exc.value.detail["required_plan"] == TEAM


class TestComptage:
    @pytest.mark.asyncio
    async def test_les_recettes_du_catalogue_ne_comptent_pas(self, monkeypatch):
        """Le filtre doit porter `is_user_submitted`, sinon chaque compte
        démarrerait à 194 recettes et ne pourrait jamais rien publier."""
        vu = {}

        class _Spy:
            async def count_documents(self, filtre, *_a, **_k):
                vu.update(filtre)
                return 0

        class _Db:
            recipes = _Spy()

        monkeypatch.setattr(gating, "db", _Db())
        await gating.usage("u1", "recipes_total")
        assert vu["author_id"] == "u1"
        assert vu["is_user_submitted"] is True

    @pytest.mark.asyncio
    async def test_quota_sans_compteur_leve(self, db):
        db()
        with pytest.raises(KeyError):
            await gating.usage("u1", "croissants_par_jour")

    @pytest.mark.asyncio
    async def test_la_grille_de_personnel_ne_compte_rien_en_base(self, db):
        db()
        assert await gating.usage("u1", "schedule_employees") == 0
