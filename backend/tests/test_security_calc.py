"""security.py — pur, sans serveur (même famille que test_production_calc.py)."""
import pytest

import security


class TestPasswords:
    def test_trop_court_refuse(self):
        assert security.password_problem("abc1234") is not None

    def test_huit_caracteres_accepte(self):
        assert security.password_problem("abcd1234") is None

    def test_au_dela_de_72_octets_refuse_au_lieu_d_une_erreur_500(self):
        # 40 "é" = 80 octets UTF-8 : bcrypt 4.1 leverait une exception.
        assert security.password_problem("é" * 40) is not None
        assert security.password_problem("a" * 72) is None


class TestJwtSecret:
    def test_valeur_d_exemple_publique_refusee(self):
        assert security.jwt_secret_problem("changeme-generate-a-real-secret") is not None

    def test_secret_court_refuse(self):
        assert security.jwt_secret_problem("x" * 20) is not None

    def test_secret_genere_accepte(self):
        assert security.jwt_secret_problem("3f9c" * 16) is None


class TestLoginThrottle:
    def _throttle(self):
        now = [1000.0]
        t = security.LoginThrottle(max_failures=3, window_s=60, clock=lambda: now[0])
        return t, now

    def test_verrouille_apres_trop_d_echecs(self):
        t, _ = self._throttle()
        for _ in range(3):
            assert t.retry_after("a@b.fr") == 0
            t.record_failure("a@b.fr")
        assert t.retry_after("a@b.fr") > 0

    def test_deverrouille_apres_la_fenetre(self):
        t, now = self._throttle()
        for _ in range(3):
            t.record_failure("a@b.fr")
        now[0] += 61
        assert t.retry_after("a@b.fr") == 0

    def test_un_succes_remet_a_zero(self):
        t, _ = self._throttle()
        for _ in range(2):
            t.record_failure("a@b.fr")
        t.reset("a@b.fr")
        t.record_failure("a@b.fr")
        assert t.retry_after("a@b.fr") == 0

    def test_les_comptes_sont_independants(self):
        t, _ = self._throttle()
        for _ in range(3):
            t.record_failure("a@b.fr")
        assert t.retry_after("autre@b.fr") == 0


class TestUploadOwnership:
    OWN = "bakers-app/uploads/user_abc/" + "0" * 32 + ".jpg"

    def test_son_propre_fichier_accepte(self):
        assert security.is_own_upload_path(self.OWN, "user_abc", "bakers-app")

    def test_fichier_d_un_autre_refuse(self):
        assert not security.is_own_upload_path(self.OWN, "user_xyz", "bakers-app")

    @pytest.mark.parametrize("path", [
        "bakers-app/uploads/user_abc/../user_xyz/" + "0" * 32 + ".jpg",
        "bakers-app/uploads/user_abc/avatar.jpg",
        "../../server.py",
        "",
    ])
    def test_chemins_forges_refuses(self, path):
        assert not security.is_own_upload_path(path, "user_abc", "bakers-app")


class TestAiLimits:
    def test_valeurs_par_defaut(self, monkeypatch):
        for var in ("AI_DAILY_LIMIT_FREE", "AI_DAILY_LIMIT_PRO", "AI_GLOBAL_DAILY_LIMIT"):
            monkeypatch.delenv(var, raising=False)
        assert security.ai_daily_limit("free") == security.AI_DAILY_LIMIT_FREE_DEFAULT
        assert security.ai_daily_limit("pro") == security.AI_DAILY_LIMIT_PRO_DEFAULT
        assert security.ai_global_daily_limit() == security.AI_GLOBAL_DAILY_LIMIT_DEFAULT

    def test_reglable_par_variable_d_environnement(self, monkeypatch):
        monkeypatch.setenv("AI_GLOBAL_DAILY_LIMIT", "50")
        assert security.ai_global_daily_limit() == 50

    def test_valeur_invalide_retombe_sur_le_defaut(self, monkeypatch):
        monkeypatch.setenv("AI_DAILY_LIMIT_FREE", "beaucoup")
        assert security.ai_daily_limit("free") == security.AI_DAILY_LIMIT_FREE_DEFAULT
