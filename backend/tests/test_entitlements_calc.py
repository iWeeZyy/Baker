"""Droits par offre — tests purs, sans serveur.

Le fichier est volontairement exhaustif par table : chaque cellule palier ×
fonctionnalité et palier × quota est vérifiée, parce que c'est précisément le
genre de tableau où une faute de frappe n'apparaît jamais à l'exécution et
n'ouvre un droit qu'à l'utilisateur qui tombe dessus.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import entitlements as ent  # noqa: E402
from entitlements import FREE, PRO, PRO_PLUS, TEAM  # noqa: E402


class TestEchelle:
    def test_ordre(self):
        assert ent.TIER_ORDER == (FREE, PRO, PRO_PLUS, TEAM)

    def test_rank_croissant(self):
        assert ent.rank(FREE) < ent.rank(PRO) < ent.rank(PRO_PLUS) < ent.rank(TEAM)

    @pytest.mark.parametrize("valeur", ["", "platine", "PRO", "pro+", None, "admin"])
    def test_palier_inconnu_vaut_free(self, valeur):
        """Un palier non reconnu doit dégrader vers le bas, jamais accorder."""
        assert ent.rank(valeur) == 0
        assert ent.normalize(valeur) == FREE

    def test_normalize_conserve_un_palier_valide(self):
        for tier in ent.TIER_ORDER:
            assert ent.normalize(tier) == tier


class TestMonotonie:
    """L'invariant central : un palier possède tout ce qui est en dessous."""

    def test_chaque_fonctionnalite_est_monotone(self):
        for key in ent.MIN_TIER:
            acquis = [ent.has_feature(t, key) for t in ent.TIER_ORDER]
            # Une fois vrai, jamais re-faux en montant l'échelle.
            assert acquis == sorted(acquis), f"{key} n'est pas monotone : {acquis}"

    def test_le_palier_le_plus_haut_a_tout(self):
        for key in ent.MIN_TIER:
            assert ent.has_feature(TEAM, key), f"{key} manque à {TEAM}"

    def test_les_quotas_ne_retrecissent_jamais_en_montant(self):
        for key in ent.QUOTA_KEYS:
            precedent = 0
            for tier in ent.TIER_ORDER:
                limite = ent.quota(tier, key)
                if limite is None:  # illimité : rien au-dessus, et rien après
                    precedent = None
                    continue
                assert precedent is not None, (
                    f"{key} redevient borné à {tier} après avoir été illimité"
                )
                assert limite >= precedent, f"{key} diminue à {tier}"
                precedent = limite

    def test_le_palier_minimum_est_bien_le_premier_a_donner_le_droit(self):
        for key, min_tier in ent.MIN_TIER.items():
            assert ent.has_feature(min_tier, key)
            index = ent.rank(min_tier)
            if index > 0:
                assert not ent.has_feature(ent.TIER_ORDER[index - 1], key)


class TestFonctionnalites:
    @pytest.mark.parametrize("key", [
        "recipes_unlimited", "cost_basic",
    ])
    def test_free_n_a_pas_les_fonctionnalites_pro(self, key):
        assert ent.has_feature(FREE, key) is False
        assert ent.has_feature(PRO, key) is True

    @pytest.mark.parametrize("key", [
        # Ouverts à Free depuis le chantier des quotas d'essai : la
        # fonctionnalité elle-même n'est plus verrouillée, c'est son quota
        # (scans_total/adapts_total/schedules_total/collections_total) qui
        # borne l'essai gratuit.
        "recipe_scan", "recipe_adapt", "staff_schedule", "collections",
    ])
    def test_free_a_les_fonctionnalites_a_quota_d_essai(self, key):
        assert ent.has_feature(FREE, key) is True
        assert ent.has_feature(PRO, key) is True

    @pytest.mark.parametrize("key", [
        "cost_materials", "cost_profitability", "production_advanced", "fournil_mode", "ai_advanced",
    ])
    def test_pro_n_a_pas_les_fonctionnalites_pro_plus(self, key):
        assert ent.has_feature(PRO, key) is False
        assert ent.has_feature(PRO_PLUS, key) is True

    @pytest.mark.parametrize("key", [
        "org_team", "org_tasks", "pro_orders", "org_dashboard", "org_multi_shop",
    ])
    def test_pro_plus_n_a_pas_les_fonctionnalites_equipe(self, key):
        assert ent.has_feature(PRO_PLUS, key) is False
        assert ent.has_feature(TEAM, key) is True

    def test_assistant_ouvert_a_tous(self):
        """L'assistant n'est pas réservé : c'est son quota qui sépare les offres."""
        for tier in ent.TIER_ORDER:
            assert ent.has_feature(tier, "ai_assistant") is True

    def test_fonctionnalite_inconnue_leve(self):
        """Une clé absente est un bug, pas un droit accordé en silence."""
        with pytest.raises(KeyError):
            ent.has_feature(TEAM, "teleportation")


class TestQuotas:
    def test_chiffres_demandes_par_lucas(self):
        assert ent.quota(FREE, "recipes_total") is None
        assert ent.quota(FREE, "productions_per_month") == 3
        assert ent.quota(FREE, "ai_messages_per_month") == 10
        assert ent.quota(FREE, "scans_total") == 3
        assert ent.quota(FREE, "adapts_total") == 5
        assert ent.quota(FREE, "collections_total") == 3
        assert ent.quota(FREE, "schedules_total") == 3
        assert ent.quota(TEAM, "org_members") == 15

    def test_paliers_payants_sans_limite_de_recettes(self):
        for tier in (PRO, PRO_PLUS, TEAM):
            assert ent.quota(tier, "recipes_total") is None
            assert ent.quota(tier, "productions_per_month") is None

    def test_paliers_payants_sans_limite_d_essai(self):
        """Une fois payant, plus de plafond à vie sur le scan/l'adaptation/
        les collections/les plannings — le palier gratuit est seul borné."""
        for tier in (PRO, PRO_PLUS, TEAM):
            assert ent.quota(tier, "scans_total") is None
            assert ent.quota(tier, "adapts_total") is None
            assert ent.quota(tier, "collections_total") is None
            assert ent.quota(tier, "schedules_total") is None

    def test_seule_l_offre_equipe_a_des_membres(self):
        for tier in (FREE, PRO, PRO_PLUS):
            assert ent.quota(tier, "org_members") == 0

    def test_toutes_les_cles_sont_definies_pour_chaque_palier(self):
        for tier in ent.TIER_ORDER:
            for key in ent.QUOTA_KEYS:
                assert key in ent.QUOTAS[tier], f"{key} manque à {tier}"

    def test_within_quota(self):
        assert ent.within_quota(FREE, "collections_total", 2) is True
        assert ent.within_quota(FREE, "collections_total", 3) is False
        assert ent.within_quota(FREE, "collections_total", 42) is False

    def test_illimite_laisse_toujours_passer(self):
        assert ent.within_quota(PRO, "collections_total", 10_000) is True
        assert ent.within_quota(FREE, "recipes_total", 10_000) is True

    def test_quota_a_zero_bloque_des_le_premier(self):
        assert ent.within_quota(FREE, "org_members", 0) is False

    def test_periodes(self):
        assert ent.quota_period("productions_per_month") == "month"
        assert ent.quota_period("recipes_total") == "total"
        assert ent.quota_period("scans_total") == "usage"
        assert ent.quota_period("adapts_total") == "usage"
        assert ent.quota_period("collections_total") == "total"
        assert ent.quota_period("schedules_total") == "total"

    def test_quota_inconnu_leve(self):
        with pytest.raises(KeyError):
            ent.quota(PRO, "croissants_par_jour")
        with pytest.raises(KeyError):
            ent.quota_period("croissants_par_jour")


class TestChargeUtile:
    """`locked` est le seul champ sur lequel l'application a le droit de brancher."""

    def test_interrupteur_eteint_ne_verrouille_rien(self):
        """Le test « personne ne perd rien » : tant que l'abonnement n'est pas
        achetable, aucune fonctionnalité n'est verrouillée, quel que soit le
        palier — y compris celles que Free n'a pas en droit."""
        features = ent.features_for(FREE, enforced=False)
        assert all(f["locked"] is False for f in features.values())
        # …et la vérité de l'offre reste dite, pour l'écran d'abonnement.
        assert features["cost_materials"]["allowed"] is False

    def test_interrupteur_allume_verrouille_ce_qui_n_est_pas_acquis(self):
        features = ent.features_for(FREE, enforced=True)
        assert features["cost_materials"]["locked"] is True
        assert features["ai_assistant"]["locked"] is False

    def test_un_palier_paye_n_est_jamais_verrouille_sur_ses_droits(self):
        features = ent.features_for(TEAM, enforced=True)
        assert all(f["locked"] is False for f in features.values())

    def test_min_plan_est_exposé(self):
        features = ent.features_for(FREE, enforced=False)
        assert features["cost_materials"]["min_plan"] == PRO_PLUS
        assert features["org_team"]["min_plan"] == TEAM

    def test_toutes_les_cles_sont_presentes(self):
        features = ent.features_for(PRO, enforced=True)
        assert set(features) == set(ent.MIN_TIER)

    def test_quotas_for_expose_plafond_et_periode(self):
        quotas = ent.quotas_for(FREE)
        assert set(quotas) == set(ent.QUOTA_KEYS)
        assert quotas["recipes_total"] == {"limit": None, "period": "total"}
        assert quotas["productions_per_month"]["limit"] == 3
        assert quotas["scans_total"] == {"limit": 3, "period": "usage"}
        assert quotas["adapts_total"] == {"limit": 5, "period": "usage"}
        assert quotas["collections_total"] == {"limit": 3, "period": "total"}
        assert quotas["schedules_total"] == {"limit": 3, "period": "total"}

    def test_palier_inconnu_traite_comme_free(self):
        assert ent.quotas_for("platine") == ent.quotas_for(FREE)
        assert ent.features_for("platine", enforced=True) == ent.features_for(FREE, enforced=True)


class TestCatalogue:
    def test_quatre_offres_dans_l_ordre(self):
        catalogue = ent.plan_catalogue()
        assert [o["plan"] for o in catalogue] == list(ent.TIER_ORDER)

    def test_prix_et_libelles(self):
        par_plan = {o["plan"]: o for o in ent.plan_catalogue()}
        assert par_plan[FREE]["price_eur"] == 0.0
        assert par_plan[PRO]["price_eur"] == 9.90
        assert par_plan[PRO_PLUS]["price_eur"] == 19.90
        assert par_plan[TEAM]["price_eur"] == 39.90
        assert par_plan[PRO_PLUS]["label"] == "Pro+"
        assert par_plan[TEAM]["label"] == "Équipe"

    def test_les_fonctionnalites_s_accumulent_en_montant(self):
        catalogue = ent.plan_catalogue()
        for precedent, suivant in zip(catalogue, catalogue[1:]):
            assert set(precedent["features"]) <= set(suivant["features"])

    def test_chaque_offre_porte_tous_ses_quotas(self):
        for offre in ent.plan_catalogue():
            assert set(offre["quotas"]) == set(ent.QUOTA_KEYS)


class TestCompatibiliteAvecPlansPy:
    """Les deux valeurs déjà en circulation ne doivent pas changer de graphie.

    `plans.py` les définit aujourd'hui de son côté (ce module n'est encore
    importé par personne) et elles sont déjà écrites en base, dans des jetons
    et dans `src/plan.ts`. Les renommer casserait des comptes existants.
    """

    def test_valeurs_textuelles_stables(self):
        assert FREE == "free"
        assert PRO == "pro"

    def test_plans_py_et_entitlements_s_accordent(self):
        import plans
        assert plans.FREE == FREE
        assert plans.PRO == PRO
