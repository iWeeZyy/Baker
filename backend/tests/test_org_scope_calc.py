"""`org_scope.py` — tests purs, sans serveur.

La propriété centrale de ce fichier : **`scope()` hors organisation doit
rendre exactement le littéral déjà écrit partout ailleurs**
(`{"user_id": user["user_id"]}`) — c'est la garantie qu'un compte qui n'a
jamais entendu parler d'une organisation ne voit strictement rien changer
le jour où `scope()` remplace ce littéral dans `routers/production.py`,
`routers/staff.py` et `routers/cost.py` (phase 7a, commit 3).
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from org_scope import (  # noqa: E402
    can_delete,
    can_invite,
    resolve_active_membership,
    scope,
    stamp,
)

USER = {"user_id": "u1", "email": "chef@bakers.app"}
OWNER = {"org_id": "org1", "role": "owner"}
MANAGER = {"org_id": "org1", "role": "manager"}
EMPLOYEE = {"org_id": "org1", "role": "employee"}


class TestScope:
    def test_sans_organisation_rend_le_litteral_historique(self):
        assert scope(USER, None) == {"user_id": "u1"}

    def test_organisation_vide_se_comporte_comme_aucune_organisation(self):
        """Un dict présent mais sans `org_id` (le repli de `get_org_context`
        quand rien n'est résolu) doit retomber sur le même littéral —
        jamais une clé `org_id: None` qui casserait une requête Mongo."""
        assert scope(USER, {"org_id": None, "role": None}) == {"user_id": "u1"}

    def test_dans_une_organisation_filtre_par_org_id_jamais_par_user_id(self):
        assert scope(USER, OWNER) == {"org_id": "org1"}


class TestStamp:
    def test_sans_organisation_ne_porte_que_l_auteur(self):
        assert stamp(USER, None) == {"user_id": "u1"}

    def test_dans_une_organisation_porte_les_deux(self):
        assert stamp(USER, OWNER) == {"user_id": "u1", "org_id": "org1"}

    def test_l_auteur_n_est_jamais_remplace_par_org_id(self):
        out = stamp(USER, EMPLOYEE)
        assert out["user_id"] == "u1"
        assert out["org_id"] == "org1"


class TestCanDelete:
    def test_l_auteur_peut_toujours_effacer_le_sien(self):
        doc = {"user_id": "u1"}
        for org in (None, OWNER, MANAGER, EMPLOYEE):
            assert can_delete(USER, org, doc) is True

    def test_un_employe_ne_peut_pas_effacer_le_document_d_un_collegue(self):
        doc = {"user_id": "u2"}
        assert can_delete(USER, EMPLOYEE, doc) is False

    @pytest.mark.parametrize("org", [OWNER, MANAGER])
    def test_owner_et_manager_peuvent_effacer_le_document_d_un_collegue(self, org):
        doc = {"user_id": "u2"}
        assert can_delete(USER, org, doc) is True

    def test_hors_organisation_seul_l_auteur_peut_effacer(self):
        assert can_delete(USER, None, {"user_id": "u2"}) is False


class TestCanInvite:
    def test_owner_invite_manager_et_employe(self):
        assert can_invite("owner", "manager") is True
        assert can_invite("owner", "employee") is True

    def test_manager_n_invite_qu_a_employe(self):
        assert can_invite("manager", "employee") is True
        assert can_invite("manager", "manager") is False

    def test_employe_n_invite_personne(self):
        assert can_invite("employee", "employee") is False
        assert can_invite("employee", "manager") is False

    def test_role_cible_invalide_toujours_refuse(self):
        assert can_invite("owner", "owner") is False
        assert can_invite("owner", "autre-chose") is False

    def test_sans_role_acteur_refuse(self):
        assert can_invite(None, "employee") is False


class TestResolveActiveMembership:
    def test_aucune_appartenance_rend_none(self):
        assert resolve_active_membership([], None) is None
        assert resolve_active_membership([], "org1") is None

    def test_une_seule_appartenance_est_retenue_d_office(self):
        m = [{"org_id": "org1", "role": "owner"}]
        assert resolve_active_membership(m, None) == m[0]
        # Une sélection différente et invalide ne change rien : une seule
        # appartenance réelle reste sans ambiguïté.
        assert resolve_active_membership(m, "org-inconnu") == m[0]

    def test_deux_appartenances_sans_selection_valide_rend_none(self):
        m = [{"org_id": "org1", "role": "owner"}, {"org_id": "org2", "role": "employee"}]
        assert resolve_active_membership(m, None) is None
        assert resolve_active_membership(m, "org-inconnu") is None

    def test_deux_appartenances_avec_selection_valide_la_retient(self):
        m = [{"org_id": "org1", "role": "owner"}, {"org_id": "org2", "role": "employee"}]
        assert resolve_active_membership(m, "org2") == m[1]
        assert resolve_active_membership(m, "org1") == m[0]
