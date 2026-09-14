"""Ad-eligibility rules.

Pure unit tests against `plans.ads_config` — the one place that decides whether
a user may be shown an ad. They need no server, so the Pro-never-sees-an-ad
guarantee is checked directly rather than inferred from an HTTP response.
"""
import os
import sys
import uuid
from pathlib import Path

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from plans import FREE, PRO, ads_allowed, ads_config  # noqa: E402

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', 'http://localhost:8000').rstrip('/')
API = f"{BASE_URL}/api"
PRO_EMAIL = os.environ.get('TEST_PRO_EMAIL', 'test.pro@bakers.app')
# The Pro account is a fixed, shared address: whichever test file registers it
# first owns it. This password must therefore match test_productions_api.py,
# or the second file to run gets a 401 on login.
PRO_PASSWORD = 'TestProd2026!'


@pytest.fixture
def ads_on(monkeypatch):
    monkeypatch.setenv("ADS_ENABLED", "true")


@pytest.fixture
def ads_off(monkeypatch):
    monkeypatch.delenv("ADS_ENABLED", raising=False)


class TestAdsAllowed:
    def test_free_may_see_ads(self):
        assert ads_allowed(FREE) is True

    def test_pro_may_never_see_ads(self):
        assert ads_allowed(PRO) is False

    def test_unknown_plan_is_not_pro(self):
        # An unrecognised plan is treated as Free, matching resolve_plan.
        assert ads_allowed("something-else") is False


class TestKillSwitch:
    def test_off_by_default(self, ads_off):
        """Ads must stay off until Baker Pro can actually be bought."""
        assert ads_config(FREE)["enabled"] is False
        assert ads_config(FREE)["available"] is False

    def test_free_enabled_when_switched_on(self, ads_on):
        cfg = ads_config(FREE)
        assert cfg["enabled"] is True
        assert cfg["available"] is True
        assert cfg["home_slot"] is True

    def test_pro_stays_off_even_when_switched_on(self, ads_on):
        cfg = ads_config(PRO)
        assert cfg["enabled"] is False
        assert cfg["home_slot"] is False
        assert cfg["network"] == "none"
        # `available` still reports the global state, so the Pro screen knows
        # whether promising "no ads" means anything.
        assert cfg["available"] is True

    @pytest.mark.parametrize("value", ["1", "true", "TRUE", "yes", "on"])
    def test_truthy_spellings(self, monkeypatch, value):
        monkeypatch.setenv("ADS_ENABLED", value)
        assert ads_config(FREE)["enabled"] is True

    @pytest.mark.parametrize("value", ["0", "false", "no", "off", "", "  "])
    def test_falsy_spellings(self, monkeypatch, value):
        monkeypatch.setenv("ADS_ENABLED", value)
        assert ads_config(FREE)["enabled"] is False


class TestNetwork:
    def test_network_reported_when_on(self, monkeypatch):
        monkeypatch.setenv("ADS_ENABLED", "true")
        monkeypatch.setenv("ADS_NETWORK", "admob")
        assert ads_config(FREE)["network"] == "admob"

    def test_network_hidden_from_pro(self, monkeypatch):
        monkeypatch.setenv("ADS_ENABLED", "true")
        monkeypatch.setenv("ADS_NETWORK", "admob")
        assert ads_config(PRO)["network"] == "none"

    def test_no_network_configured(self, ads_on):
        assert ads_config(FREE)["network"] == "none"


class TestFrequency:
    def test_defaults(self, ads_on):
        cfg = ads_config(FREE)
        assert cfg["list_first_slot"] == 6
        assert cfg["list_interval"] == 10

    def test_overridable(self, monkeypatch):
        monkeypatch.setenv("ADS_ENABLED", "true")
        monkeypatch.setenv("ADS_LIST_FIRST_SLOT", "8")
        monkeypatch.setenv("ADS_LIST_INTERVAL", "12")
        cfg = ads_config(FREE)
        assert cfg["list_first_slot"] == 8
        assert cfg["list_interval"] == 12

    def test_zero_interval_is_floored(self, monkeypatch):
        """A 0 would ask the app to wedge an ad between every single card."""
        monkeypatch.setenv("ADS_ENABLED", "true")
        monkeypatch.setenv("ADS_LIST_INTERVAL", "0")
        monkeypatch.setenv("ADS_LIST_FIRST_SLOT", "-5")
        cfg = ads_config(FREE)
        assert cfg["list_interval"] == 1
        assert cfg["list_first_slot"] == 1

    def test_garbage_falls_back_to_default(self, monkeypatch):
        monkeypatch.setenv("ADS_ENABLED", "true")
        monkeypatch.setenv("ADS_LIST_INTERVAL", "beaucoup")
        assert ads_config(FREE)["list_interval"] == 10

    def test_frequency_present_even_when_disabled(self, ads_off):
        # The app reads these unconditionally; they must never be missing.
        cfg = ads_config(FREE)
        assert cfg["list_first_slot"] >= 1
        assert cfg["list_interval"] >= 1


def _register(email=None):
    email = email or f"ads.{uuid.uuid4().hex[:10]}@bakers.app"
    password = PRO_PASSWORD if email == PRO_EMAIL else "TestAds2026!"
    r = requests.post(
        f"{API}/auth/register",
        json={"email": email, "password": password, "name": "Chef Pub"},
        timeout=30,
    )
    if r.status_code == 400:  # fixed emails (the Pro one) already exist
        r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


class TestPlanEndpoint:
    """The app reads its ad settings from /api/me/plan and nowhere else."""

    def test_payload_shape(self):
        token = _register()
        r = requests.get(f"{API}/me/plan", headers={"Authorization": f"Bearer {token}"}, timeout=30)
        assert r.status_code == 200, r.text
        ads = r.json()["ads"]
        for key in ("available", "enabled", "network", "home_slot", "list_first_slot", "list_interval"):
            assert key in ads, f"missing {key}"

    def test_free_user_has_ads_off_by_default(self):
        """The server ships with the kill switch off, so nobody is served ads."""
        token = _register()
        r = requests.get(f"{API}/me/plan", headers={"Authorization": f"Bearer {token}"}, timeout=30)
        assert r.json()["ads"]["enabled"] is False

    def test_pro_user_has_ads_off(self):
        token = _register(PRO_EMAIL)
        body = requests.get(f"{API}/me/plan", headers={"Authorization": f"Bearer {token}"}, timeout=30).json()
        assert body["plan"] == "pro"
        assert body["ads"]["enabled"] is False
        assert body["ads"]["home_slot"] is False

    def test_ad_settings_need_authentication(self):
        """No token, no plan — and therefore no ad configuration to leak."""
        assert requests.get(f"{API}/me/plan", timeout=30).status_code in (401, 403)


class TestAdEvents:
    """POST /ads/event — a minimal log, not an analytics platform.

    The endpoint never gates on the caller's plan (a Pro account should
    never call it in practice, since the client never renders an ad to
    generate an event from — see AdSlot/canShowAds), so a client bug would
    show up in the logged `plan` field rather than being silently dropped.
    """

    def test_requires_auth(self):
        r = requests.post(
            f"{API}/ads/event", json={"event_type": "impression", "placement": "home"}, timeout=30,
        )
        assert r.status_code in (401, 403)

    def test_logs_a_valid_event(self):
        token = _register()
        r = requests.post(
            f"{API}/ads/event",
            json={"event_type": "impression", "placement": "home"},
            headers={"Authorization": f"Bearer {token}"}, timeout=30,
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "logged"

    def test_rejects_unknown_event_type(self):
        token = _register()
        r = requests.post(
            f"{API}/ads/event",
            json={"event_type": "not-a-real-event", "placement": "home"},
            headers={"Authorization": f"Bearer {token}"}, timeout=30,
        )
        assert r.status_code == 422

    def test_rejects_unknown_placement(self):
        token = _register()
        r = requests.post(
            f"{API}/ads/event",
            json={"event_type": "impression", "placement": "not-a-real-placement"},
            headers={"Authorization": f"Bearer {token}"}, timeout=30,
        )
        assert r.status_code == 422

    @pytest.mark.parametrize("event_type", [
        "impression", "click", "interstitial_shown", "rewarded_completed", "rewarded_skipped",
    ])
    def test_accepts_every_documented_event_type(self, event_type):
        token = _register()
        r = requests.post(
            f"{API}/ads/event",
            json={"event_type": event_type, "placement": "interstitial"},
            headers={"Authorization": f"Bearer {token}"}, timeout=30,
        )
        assert r.status_code == 200, r.text
