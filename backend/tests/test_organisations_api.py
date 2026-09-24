"""Organisations (offre Équipe), vues depuis l'API — phase 7a, commit 2/3.

Ce fichier couvre l'entité elle-même (création, invitations, rôles, retrait,
appartenance à plusieurs organisations, bascule d'espace de travail) et le
quota `org_members`. Il ne couvre PAS encore la visibilité partagée des
productions/plannings/matières premières — `scope()` n'est branché dans
aucune route à ce stade (commit 3) ; ces tests-là rejoignent
`test_productions_api.py`/`test_schedules_api.py`/`test_cost_api.py` une
fois ce câblage fait.

**Créer une organisation exige le palier Équipe** (`feature="org_team"`).
Hors `ENTITLEMENTS_ENFORCED` (le cas par défaut, y compris en CI), un compte
jetable frais suffit — rien n'est encore refusé. Interrupteur allumé, seul un
compte réellement Équipe (`PLAN_OVERRIDES`) peut créer une organisation, donc
chaque classe qui a besoin d'un propriétaire bascule sur SA PROPRE adresse
fixe dédiée (`_owner()` ci-dessous) plutôt qu'un compte jetable — dédiée à sa
classe, et non partagée entre classes, pour deux raisons : `pytest-xdist
--dist loadscope` peut répartir deux classes différentes sur deux workers
différents (un compte partagé entre elles changerait `active_org_id` sous
les pieds l'une de l'autre — les tests DANS une même classe, eux, sont
garantis séquentiels par ce même mode), et un état accumulé d'un lancement à
l'autre ne doit fausser que les tests de SA classe, jamais ceux des autres.
Deux tests qui exigent un état réellement vierge (aucune organisation du
tout) s'ignorent explicitement plutôt que d'échouer sous interrupteur allumé
— aucun compte partagé ne peut garantir cet état.
"""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'http://localhost:8000').rstrip('/')
API = f"{BASE_URL}/api"

# Test/dev only — comptes fixes couverts par PLAN_OVERRIDES (voir ci.yml),
# un par classe pour les raisons expliquées ci-dessus. Même mot de passe
# partout : rien n'empêche de le réutiliser d'une adresse à l'autre, seul un
# même e-mail sous deux mots de passe différents poserait problème.
_OWNER_PASSWORD = 'TestOrgTeam2026!'
_CREATION_OWNER_EMAIL = os.environ.get('TEST_ORG_CREATION_EMAIL', 'test.org.creation@bakers.app')
_INVITES_OWNER_EMAIL = os.environ.get('TEST_ORG_INVITES_EMAIL', 'test.org.invites@bakers.app')
_ROLES_OWNER_EMAIL = os.environ.get('TEST_ORG_ROLES_EMAIL', 'test.org.roles@bakers.app')
_RETRAIT_OWNER_EMAIL = os.environ.get('TEST_ORG_RETRAIT_EMAIL', 'test.org.retrait@bakers.app')
_BASCULE_OWNER_EMAIL = os.environ.get('TEST_ORG_BASCULE_EMAIL', 'test.org.bascule@bakers.app')
_QUOTA_OWNER_EMAIL = os.environ.get('TEST_ORG_QUOTA_EMAIL', 'test.org.quota@bakers.app')


def _register(email=None, password=None, name="Chef"):
    email = email or f"org.{uuid.uuid4().hex[:10]}@bakers.app"
    password = password or "TestOrg2026!"
    r = requests.post(f"{API}/auth/register",
                      json={"email": email, "password": password, "name": name}, timeout=30)
    if r.status_code == 400:  # adresse fixe déjà créée
        r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
        if r.status_code == 401:
            pytest.skip(f"{email} existe déjà avec un autre mot de passe (base non vierge)")
    assert r.status_code == 200, r.text
    body = r.json()
    return body["token"], body["user"]["user_id"], email


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def _plan(token):
    r = requests.get(f"{API}/me/plan", headers=_h(token), timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _owner(fixed_email):
    """Un compte capable de créer une organisation, dans les deux positions
    de l'interrupteur — voir le docstring du module."""
    probe_token, probe_uid, _ = _register()
    if not _plan(probe_token)["enforced"]:
        return probe_token, probe_uid
    r = requests.post(f"{API}/auth/register",
                      json={"email": fixed_email, "password": _OWNER_PASSWORD, "name": "Chef Équipe"}, timeout=30)
    if r.status_code == 400:
        r = requests.post(f"{API}/auth/login", json={"email": fixed_email, "password": _OWNER_PASSWORD}, timeout=30)
        if r.status_code == 401:
            pytest.skip(f"{fixed_email} existe déjà avec un autre mot de passe (base non vierge)")
    assert r.status_code == 200, r.text
    body = r.json()
    return body["token"], body["user"]["user_id"]


def _create_org(token, name=None):
    r = requests.post(f"{API}/organisations", json={"name": name or f"Boulangerie {uuid.uuid4().hex[:6]}"},
                      headers=_h(token), timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _invite(token, email, role="employee"):
    return requests.post(f"{API}/organisations/invites", json={"email": email, "role": role},
                         headers=_h(token), timeout=30)


def _accept(token, invite_id):
    r = requests.post(f"{API}/organisations/invites/{invite_id}/respond", json={"accept": True},
                      headers=_h(token), timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _incoming_invites(token):
    r = requests.get(f"{API}/organisations/invites", headers=_h(token), timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


class TestCreationEtAppartenance:
    def test_le_createur_devient_proprietaire_et_espace_actif(self):
        token, uid = _owner(_CREATION_OWNER_EMAIL)
        org = _create_org(token)
        assert org["owner_user_id"] == uid
        assert len(org["shops"]) == 1
        assert org["shops"][0]["is_default"] is True

        me = requests.get(f"{API}/organisations/me", headers=_h(token), timeout=30).json()
        assert me["active_org_id"] == org["id"]
        # Contient la ligne attendue plutôt qu'une égalité de liste exacte :
        # sous interrupteur allumé, le compte propriétaire est partagé entre
        # les tests de cette classe (voir docstring du module) et peut déjà
        # posséder d'autres organisations d'un lancement précédent.
        row = next(o for o in me["organisations"] if o["org_id"] == org["id"])
        assert row == {"org_id": org["id"], "name": org["name"], "role": "owner", "active": True}

    def test_un_compte_peut_posseder_plusieurs_organisations(self):
        """Décision explicite du chantier : un compte n'est pas limité à une
        seule organisation."""
        token, _uid = _owner(_CREATION_OWNER_EMAIL)
        org_a = _create_org(token, "Boulangerie A")
        org_b = _create_org(token, "Boulangerie B")  # ne doit PAS échouer en 409
        me = requests.get(f"{API}/organisations/me", headers=_h(token), timeout=30).json()
        ids = {o["org_id"] for o in me["organisations"]}
        assert {org_a["id"], org_b["id"]} <= ids
        # La dernière créée devient l'espace actif.
        assert me["active_org_id"] == org_b["id"]

    def test_nom_vide_est_refuse(self):
        token, _uid = _owner(_CREATION_OWNER_EMAIL)
        r = requests.post(f"{API}/organisations", json={"name": "   "}, headers=_h(token), timeout=30)
        assert r.status_code == 422

    def test_sans_organisation_me_rend_une_liste_vide(self):
        token, _, _ = _register()
        if _plan(token)["enforced"]:
            pytest.skip("nécessite un compte réellement vierge, impossible à garantir "
                       "sous interrupteur allumé sans fournisseur de paiement réel")
        me = requests.get(f"{API}/organisations/me", headers=_h(token), timeout=30).json()
        assert me == {"organisations": [], "active_org_id": None}

    def test_membres_sans_organisation_active_est_un_404(self):
        token, _, _ = _register()
        if _plan(token)["enforced"]:
            pytest.skip("nécessite un compte réellement vierge, impossible à garantir "
                       "sous interrupteur allumé sans fournisseur de paiement réel")
        r = requests.get(f"{API}/organisations/members", headers=_h(token), timeout=30)
        assert r.status_code == 404


class TestInvitations:
    def test_email_inconnu_est_un_404(self):
        token, _uid = _owner(_INVITES_OWNER_EMAIL)
        _create_org(token)
        r = _invite(token, f"personne.{uuid.uuid4().hex[:6]}@bakers.app")
        assert r.status_code == 404

    def test_on_ne_peut_pas_s_inviter_soi_meme(self):
        token, uid = _owner(_INVITES_OWNER_EMAIL)
        _create_org(token)
        # L'e-mail du propriétaire lui-même : dérivé de son user_id plutôt
        # que capturé à l'inscription, puisque `_owner()` peut rendre un
        # compte fixe déjà existant sans repasser par `_register()`.
        me = requests.get(f"{API}/auth/me", headers=_h(token), timeout=30).json()
        r = _invite(token, me["email"])
        assert r.status_code == 400

    def test_invitation_puis_acceptation_ajoute_le_membre(self):
        owner_token, owner_uid = _owner(_INVITES_OWNER_EMAIL)
        target_token, target_uid, target_email = _register()
        org = _create_org(owner_token)

        sent = _invite(owner_token, target_email, role="employee")
        assert sent.status_code == 200, sent.text
        assert sent.json()["status"] == "sent"

        incoming = _incoming_invites(target_token)
        assert len(incoming) == 1
        assert incoming[0]["org_id"] == org["id"]
        assert incoming[0]["role"] == "employee"

        accepted = _accept(target_token, incoming[0]["id"])
        assert accepted["status"] == "accepted"

        roster = requests.get(f"{API}/organisations/members", headers=_h(owner_token), timeout=30).json()
        assert {owner_uid, target_uid} <= {m["user_id"] for m in roster}
        member_row = next(m for m in roster if m["user_id"] == target_uid)
        assert member_row["role"] == "employee"

    def test_refuser_une_invitation_ne_cree_pas_de_membre(self):
        owner_token, _owner_uid = _owner(_INVITES_OWNER_EMAIL)
        target_token, target_uid, target_email = _register()
        _create_org(owner_token)
        _invite(owner_token, target_email)
        invite_id = _incoming_invites(target_token)[0]["id"]

        r = requests.post(f"{API}/organisations/invites/{invite_id}/respond", json={"accept": False},
                          headers=_h(target_token), timeout=30)
        assert r.status_code == 200
        assert r.json()["status"] == "declined"
        assert _incoming_invites(target_token) == []

        me = requests.get(f"{API}/organisations/me", headers=_h(target_token), timeout=30).json()
        assert me["organisations"] == []  # target_token est un compte jetable frais, jamais partagé

    def test_invitation_en_double_est_idempotente(self):
        owner_token, _owner_uid = _owner(_INVITES_OWNER_EMAIL)
        _, _, target_email = _register()
        _create_org(owner_token)
        first = _invite(owner_token, target_email)
        assert first.json()["status"] == "sent"
        second = _invite(owner_token, target_email)
        assert second.status_code == 200
        assert second.json()["status"] == "pending_sent"

    def test_deja_membre_est_un_409(self):
        owner_token, _owner_uid = _owner(_INVITES_OWNER_EMAIL)
        target_token, _, target_email = _register()
        _create_org(owner_token)
        _invite(owner_token, target_email)
        _accept(target_token, _incoming_invites(target_token)[0]["id"])

        r = _invite(owner_token, target_email)
        assert r.status_code == 409


class TestRoles:
    def _org_with_employee(self):
        owner_token, owner_uid = _owner(_ROLES_OWNER_EMAIL)
        emp_token, emp_uid, emp_email = _register()
        org = _create_org(owner_token)
        _invite(owner_token, emp_email, role="employee")
        _accept(emp_token, _incoming_invites(emp_token)[0]["id"])
        return owner_token, owner_uid, emp_token, emp_uid, org

    def test_un_employe_ne_peut_pas_inviter(self):
        _, _, emp_token, _, _ = self._org_with_employee()
        _, _, other_email = _register()
        r = _invite(emp_token, other_email)
        assert r.status_code == 403

    def test_un_manager_ne_peut_inviter_qu_un_employe(self):
        owner_token, _owner_uid, emp_token, emp_uid, _org = self._org_with_employee()
        requests.put(f"{API}/organisations/members/{emp_uid}/role", json={"role": "manager"},
                    headers=_h(owner_token), timeout=30)

        _, _, other_email_1 = _register()
        as_employee = _invite(emp_token, other_email_1, role="employee")
        assert as_employee.status_code == 200

        _, _, other_email_2 = _register()
        as_manager = _invite(emp_token, other_email_2, role="manager")
        assert as_manager.status_code == 403

    def test_seul_le_proprietaire_change_un_role(self):
        _owner_token, _owner_uid, emp_token, emp_uid, _org = self._org_with_employee()
        # L'employé ne peut pas se promouvoir lui-même.
        r = requests.put(f"{API}/organisations/members/{emp_uid}/role", json={"role": "manager"},
                         headers=_h(emp_token), timeout=30)
        assert r.status_code == 403

    def test_le_proprietaire_ne_change_pas_son_propre_role_ici(self):
        owner_token, owner_uid, _emp_token, _emp_uid, _org = self._org_with_employee()
        r = requests.put(f"{API}/organisations/members/{owner_uid}/role", json={"role": "manager"},
                         headers=_h(owner_token), timeout=30)
        assert r.status_code == 400


class TestRetrait:
    def _org_with_employee(self):
        owner_token, owner_uid = _owner(_RETRAIT_OWNER_EMAIL)
        emp_token, emp_uid, emp_email = _register()
        org = _create_org(owner_token)
        _invite(owner_token, emp_email, role="employee")
        _accept(emp_token, _incoming_invites(emp_token)[0]["id"])
        return owner_token, owner_uid, emp_token, emp_uid, org

    def test_un_membre_peut_se_retirer_lui_meme(self):
        owner_token, _owner_uid, emp_token, emp_uid, _org = self._org_with_employee()
        r = requests.delete(f"{API}/organisations/members/{emp_uid}", headers=_h(emp_token), timeout=30)
        assert r.status_code == 200
        roster = requests.get(f"{API}/organisations/members", headers=_h(owner_token), timeout=30).json()
        assert emp_uid not in {m["user_id"] for m in roster}

    def test_un_employe_ne_peut_pas_retirer_un_collegue(self):
        owner_token, _owner_uid, emp_token, _emp_uid, _org = self._org_with_employee()
        emp2_token, emp2_uid, emp2_email = _register()
        _invite(owner_token, emp2_email, role="employee")
        _accept(emp2_token, _incoming_invites(emp2_token)[0]["id"])

        r = requests.delete(f"{API}/organisations/members/{emp2_uid}", headers=_h(emp_token), timeout=30)
        assert r.status_code == 403

    def test_le_proprietaire_ne_peut_pas_etre_retire(self):
        owner_token, owner_uid, _emp_token, _emp_uid, _org = self._org_with_employee()
        r = requests.delete(f"{API}/organisations/members/{owner_uid}", headers=_h(owner_token), timeout=30)
        assert r.status_code == 400

    def test_retirer_annule_une_invitation_jamais_acceptee(self):
        owner_token, _owner_uid = _owner(_RETRAIT_OWNER_EMAIL)
        target_token, target_uid, target_email = _register()
        _create_org(owner_token)
        _invite(owner_token, target_email)
        # Retiré avant d'accepter : l'invitation en attente doit s'annuler
        # plutôt que traîner sans aucun moyen de revenir dessus.
        r = requests.delete(f"{API}/organisations/members/{target_uid}", headers=_h(owner_token), timeout=30)
        assert r.status_code == 200
        assert r.json()["status"] == "invite_cancelled"
        assert _incoming_invites(target_token) == []

    def test_retirer_un_inconnu_reste_un_404(self):
        owner_token, _owner_uid = _owner(_RETRAIT_OWNER_EMAIL)
        _create_org(owner_token)
        r = requests.delete(f"{API}/organisations/members/user_jamais_invite", headers=_h(owner_token), timeout=30)
        assert r.status_code == 404


class TestBasculeMultiOrganisations:
    def test_une_seule_organisation_est_active_sans_bascule_manuelle(self):
        """Le cas majoritaire : une seule appartenance ne demande jamais
        d'appeler /activate pour être résolue."""
        token, _uid = _owner(_BASCULE_OWNER_EMAIL)
        org = _create_org(token)
        me = requests.get(f"{API}/organisations/me", headers=_h(token), timeout=30).json()
        assert me["active_org_id"] == org["id"]

    def test_basculer_change_l_organisation_active_sans_toucher_aux_roles(self):
        token, uid = _owner(_BASCULE_OWNER_EMAIL)
        org_a = _create_org(token, "A")
        org_b = _create_org(token, "B")  # devient active à la création

        me = requests.get(f"{API}/organisations/me", headers=_h(token), timeout=30).json()
        assert me["active_org_id"] == org_b["id"]

        switched = requests.post(f"{API}/organisations/{org_a['id']}/activate", headers=_h(token), timeout=30)
        assert switched.status_code == 200
        assert switched.json()["active_org_id"] == org_a["id"]

        roster_a = requests.get(f"{API}/organisations/members", headers=_h(token), timeout=30).json()
        assert uid in {m["user_id"] for m in roster_a}

    def test_activer_une_organisation_dont_on_n_est_pas_membre_est_un_404(self):
        token, _ = _owner(_BASCULE_OWNER_EMAIL)
        # "Autre" propriétaire : n'importe quelle autre adresse Équipe dédiée
        # fait l'affaire ici, seule l'organisation qu'elle crée compte — pas
        # son propre état, qu'une autre classe peut concurremment modifier.
        other_token, _ = _owner(_CREATION_OWNER_EMAIL)
        other_org = _create_org(other_token)
        r = requests.post(f"{API}/organisations/{other_org['id']}/activate", headers=_h(token), timeout=30)
        assert r.status_code == 404


class TestQuotaOrgMembers:
    """Nécessite le palier Équipe réel (`PLAN_OVERRIDES`) pour exercer le
    plafond lui-même — s'ignore si le serveur n'a pas l'interrupteur allumé,
    même convention que `test_productions_api.py::TestProPlan`."""

    def test_seizieme_invitation_est_refusee(self):
        owner_token, _owner_uid = _owner(_QUOTA_OWNER_EMAIL)
        if not _plan(owner_token)["enforced"]:
            pytest.skip("ENTITLEMENTS_ENFORCED est éteint sur ce serveur")
        if _plan(owner_token)["plan"] != "team":
            pytest.skip(f"{_QUOTA_OWNER_EMAIL} n'est pas résolu au palier Équipe (PLAN_OVERRIDES manquant ?)")

        # Une organisation à soi pour ce test précis, pas celle des autres
        # tests de ce fichier (dont le roster peut déjà contenir du monde).
        _create_org(owner_token, f"Quota {uuid.uuid4().hex[:6]}")

        # Le plafond exclut le propriétaire (voir gating.py::usage) : une
        # organisation neuve — toujours le cas ici, `_create_org` ci-dessus
        # en fabrique une fraîche — part donc de 0 employé, quel que soit
        # l'historique du compte propriétaire sur d'AUTRES organisations.
        emails = [f"org.quota.{uuid.uuid4().hex[:8]}@bakers.app" for _ in range(16)]
        for email in emails:
            _register(email=email, password="TestOrgQuota2026!")

        responses = [_invite(owner_token, e) for e in emails]
        assert [r.status_code for r in responses[:15]] == [200] * 15, [r.text for r in responses]
        assert responses[15].status_code == 403
        detail = responses[15].json()["detail"]
        assert detail["error"] == "plan_limit_reached"
        assert detail["limit"] == 15


class TestNonInterference:
    """Hors organisation, rien ne doit avoir changé — même les GET publics
    déjà couverts par test_gating_api.py restent ouverts."""

    def test_un_compte_hors_organisation_lit_toujours_son_plan(self):
        token, _, _ = _register()
        body = _plan(token)
        assert "plan" in body and "features" in body
