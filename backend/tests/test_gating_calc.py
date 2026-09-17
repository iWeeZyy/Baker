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
        self.org_invites = _FakeCollection(counts.get("org_invites", 0))
        self.collections = _FakeCollection(counts.get("collections", 0))
        self.schedules = _FakeCollection(counts.get("schedules", 0))


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
    async def test_quota_de_collections_applique(self, switch, as_plan, db):
        """`recipes_total` est désormais illimité pour Free (voir plus bas) :
        `collections_total` (3 pour Free, un quota stock du même chantier)
        reprend ce comportement pour vérifier que le mécanisme lui-même
        bloque toujours bien à la limite."""
        switch(True); as_plan(FREE); db(collections=3)
        with pytest.raises(HTTPException) as exc:
            await _check(quota="collections_total")
        assert exc.value.detail["limit"] == 3
        assert exc.value.detail["used"] == 3
        assert exc.value.detail["period"] == "total"

    @pytest.mark.asyncio
    async def test_la_derniere_place_est_encore_bonne(self, switch, as_plan, db):
        switch(True); as_plan(FREE); db(collections=2)
        await _check(quota="collections_total")

    @pytest.mark.asyncio
    async def test_illimite_ne_bloque_jamais(self, switch, as_plan, db):
        switch(True); as_plan(PRO); db(collections=10_000)
        await _check(quota="collections_total")

    @pytest.mark.asyncio
    async def test_recipes_total_est_desormais_illimite_meme_pour_free(self, switch, as_plan, db):
        """Décision confirmée avec Lucas (chantier des quotas d'essai) :
        plus aucun plafond sur le nombre de recettes créées, quel que soit
        le palier."""
        switch(True); as_plan(FREE); db(recipes=10_000)
        await _check(quota="recipes_total")

    @pytest.mark.asyncio
    async def test_quota_a_zero_bloque_des_le_premier(self, switch, as_plan, db):
        switch(True); as_plan(FREE); db(org_members=0, org_invites=0)
        with pytest.raises(HTTPException) as exc:
            await _check(quota="org_members", org=None)
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
        # "quota" (la clé précise) s'est ajouté avec le mécanisme
        # multi-quota (`quotas=[...]`) — additif, un client qui l'ignore
        # continue de lire "error"/"limit"/"used"/"period"/"message" tels
        # quels.
        assert set(exc.value.detail) == {"error", "quota", "limit", "used", "period", "message"}
        assert exc.value.detail["quota"] == "productions_per_month"

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


class TestOrganisation:
    """Phase 7a : le quota `productions_per_month` compté par organisation
    plutôt que par compte, et le palier résolu depuis le propriétaire de
    l'organisation active plutôt que depuis l'acteur — deux comportements
    activés uniquement quand `check()`/`usage()` reçoivent un `org`/`org_id`,
    jamais par défaut."""

    @pytest.mark.asyncio
    async def test_productions_sans_organisation_compte_par_utilisateur(self, monkeypatch):
        vu = {}

        class _Spy:
            async def count_documents(self, filtre, *_a, **_k):
                vu.update(filtre)
                return 0

        class _Db:
            productions = _Spy()

        monkeypatch.setattr(gating, "db", _Db())
        await gating.usage("u1", "productions_per_month")
        assert vu["user_id"] == "u1"
        assert "org_id" not in vu

    @pytest.mark.asyncio
    async def test_productions_avec_organisation_compte_par_org_id_pas_par_utilisateur(self, monkeypatch):
        vu = {}

        class _Spy:
            async def count_documents(self, filtre, *_a, **_k):
                vu.update(filtre)
                return 0

        class _Db:
            productions = _Spy()

        monkeypatch.setattr(gating, "db", _Db())
        await gating.usage("u1", "productions_per_month", org_id="org1")
        assert vu["org_id"] == "org1"
        assert "user_id" not in vu

    @pytest.mark.asyncio
    async def test_org_members_sans_org_id_rend_zero(self, db):
        db(org_members=99, org_invites=99)  # ne doit même pas être consulté
        assert await gating.usage("u1", "org_members", org_id=None) == 0

    @pytest.mark.asyncio
    async def test_org_members_compte_actifs_plus_en_attente(self, db):
        db(org_members=3, org_invites=2)
        assert await gating.usage("u1", "org_members", org_id="org1") == 5

    @pytest.mark.asyncio
    async def test_check_resout_le_palier_du_proprietaire_pas_de_l_acteur(self, switch, monkeypatch, db):
        """Un employé Gratuit doit profiter du palier Équipe de son
        organisation — jamais du sien."""
        switch(True)
        db()
        vu = {}

        async def _fake_plan_for(user, *_a, **_k):
            vu["billed"] = user.get("user_id")
            return TEAM if user.get("user_id") == "owner1" else FREE
        monkeypatch.setattr(gating.subscriptions, "plan_for", _fake_plan_for)

        employe = {"user_id": "employe1"}
        org = {"org_id": "org1", "role": "employee", "billing_user": {"user_id": "owner1"}}
        await gating.check(employe, feature="org_team", org=org)  # ne lève pas
        assert vu["billed"] == "owner1"

    @pytest.mark.asyncio
    async def test_sans_org_le_palier_reste_celui_de_l_acteur(self, switch, as_plan, db):
        switch(True); as_plan(FREE); db()
        with pytest.raises(HTTPException) as exc:
            await gating.check(USER, feature="org_team")
        assert exc.value.detail["error"] == "plan_feature_locked"


class TestNouveauxQuotasEssaiGratuit:
    """Les compteurs ajoutés par le chantier des quotas d'essai Free."""

    @pytest.mark.asyncio
    async def test_scans_total_compte_scan_et_import_instagram(self, monkeypatch):
        """Un seul plafond d'essai pour les deux routes d'extraction IA —
        sinon l'import Instagram contournerait librement le quota du scan
        photo, puisque les deux partagent la fonctionnalité `recipe_scan`."""
        vu = {}

        class _Spy:
            async def count_documents(self, filtre, *_a, **_k):
                vu.update(filtre)
                return 0

        class _Db:
            ai_usage = _Spy()

        monkeypatch.setattr(gating, "db", _Db())
        await gating.usage("u1", "scans_total")
        assert vu["kind"] == {"$in": ["scan", "instagram_import"]}
        assert "created_at" not in vu  # à vie, jamais filtré par date

    @pytest.mark.asyncio
    async def test_adapts_total_compte_a_vie_sans_filtre_de_date(self, monkeypatch):
        vu = {}

        class _Spy:
            async def count_documents(self, filtre, *_a, **_k):
                vu.update(filtre)
                return 0

        class _Db:
            ai_usage = _Spy()

        monkeypatch.setattr(gating, "db", _Db())
        await gating.usage("u1", "adapts_total")
        assert vu["kind"] == "adapt"
        assert "created_at" not in vu

    @pytest.mark.asyncio
    async def test_collections_total_jamais_org_scope(self, monkeypatch):
        """Les collections n'ont aucune intégration organisation dans ce
        code — toujours par compte, même avec un org_id fourni."""
        vu = {}

        class _Spy:
            async def count_documents(self, filtre, *_a, **_k):
                vu.update(filtre)
                return 0

        class _Db:
            collections = _Spy()

        monkeypatch.setattr(gating, "db", _Db())
        await gating.usage("u1", "collections_total", org_id="org1")
        assert vu == {"user_id": "u1"}

    @pytest.mark.asyncio
    async def test_schedules_total_org_scope_comme_les_productions(self, monkeypatch):
        vu = {}

        class _Spy:
            async def count_documents(self, filtre, *_a, **_k):
                vu.update(filtre)
                return 0

        class _Db:
            schedules = _Spy()

        monkeypatch.setattr(gating, "db", _Db())
        await gating.usage("u1", "schedules_total", org_id="org1")
        assert vu == {"org_id": "org1"}

    @pytest.mark.asyncio
    async def test_scans_total_bloque_le_quatrieme_scan_gratuit(self, switch, as_plan, db):
        switch(True); as_plan(FREE); db(ai_usage=3)
        with pytest.raises(HTTPException) as exc:
            await _check(quota="scans_total")
        assert exc.value.detail["limit"] == 3
        assert exc.value.detail["used"] == 3
        assert exc.value.detail["period"] == "usage"

    @pytest.mark.asyncio
    async def test_collections_total_stock_libere_une_place_a_la_suppression(self, switch, as_plan, db):
        """La sémantique stock (comptage en direct) : passer de 3 à 2
        documents existants rouvre la place, sans geste particulier côté
        quota — c'est `usage()` qui recompte à chaque appel."""
        switch(True); as_plan(FREE); db(collections=3)
        with pytest.raises(HTTPException):
            await _check(quota="collections_total")
        db(collections=2)  # une collection supprimée
        await _check(quota="collections_total")  # ne lève plus


class TestMultiQuota:
    """`quotas=[(clé, quantité), ...]` : plusieurs quotas indépendants sur
    une même route, chacun avec sa propre quantité consommée."""

    @pytest.mark.asyncio
    async def test_les_deux_quotas_doivent_passer(self, switch, as_plan, db):
        switch(True); as_plan(FREE); db(ai_usage=0)
        await gating.check(USER, quotas=[("scans_total", 1), ("scans_per_month", 1)])

    @pytest.mark.asyncio
    async def test_le_premier_quota_epuise_leve_pour_sa_propre_cle(self, switch, as_plan, db):
        switch(True); as_plan(FREE); db(ai_usage=3)
        with pytest.raises(HTTPException) as exc:
            await gating.check(USER, quotas=[("scans_total", 1), ("scans_per_month", 1)])
        assert exc.value.detail["quota"] == "scans_total"

    @pytest.mark.asyncio
    async def test_quota_illimite_a_ce_palier_ne_bloque_jamais_meme_dans_la_liste(self, switch, as_plan, db):
        """Pro : plus de plafond à vie (scans_total=None) — seul le quota
        mensuel préexistant (scans_per_month=30) continue de s'appliquer,
        intact, sans régression."""
        switch(True); as_plan(PRO); db(ai_usage=30)
        with pytest.raises(HTTPException) as exc:
            await gating.check(USER, quotas=[("scans_total", 1), ("scans_per_month", 1)])
        assert exc.value.detail["quota"] == "scans_per_month"
        assert exc.value.detail["limit"] == 30

    @pytest.mark.asyncio
    async def test_quota_simple_et_liste_se_combinent(self, switch, as_plan, db):
        """`quota=`/`amount=` (le raccourci à un seul quota) se combine avec
        `quotas=` — utilisé par la grille de personnel (schedules_total,
        amount=1 ; schedule_employees, amount=len(employees))."""
        switch(True); as_plan(FREE); db(schedules=3)
        with pytest.raises(HTTPException) as exc:
            await gating.check(USER, quota="schedules_total", amount=1,
                                quotas=[("schedule_employees", 2)])
        assert exc.value.detail["quota"] == "schedules_total"

    @pytest.mark.asyncio
    async def test_quota_simple_et_liste_le_second_peut_aussi_bloquer(self, switch, as_plan, db):
        switch(True); as_plan(FREE); db(schedules=1)
        with pytest.raises(HTTPException) as exc:
            await gating.check(USER, quota="schedules_total", amount=1,
                                quotas=[("schedule_employees", 9)])
        assert exc.value.detail["quota"] == "schedule_employees"
        assert exc.value.detail["limit"] == 8
