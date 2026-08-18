# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Bakers is a French bakery companion app: a recipe library, technical tips, an AI baking assistant, and community features (likes, comments, friends, messaging). It's a two-part monorepo:

- `backend/` — FastAPI + MongoDB (Motor), a single-file API server
- `frontend/` — Expo Router (React Native + TypeScript), targets iOS/Android/Web

The project previously ran on "Emergent" (an AI app-builder platform) for auth, file storage, and the AI provider. That coupling has been removed: auth is email/password only, file storage is local disk, and the AI assistant calls the Anthropic API directly. A few harmless traces of the old scaffold remain (see Gotchas below) — don't be alarmed by them.

## Commands

### Backend (`backend/`)

```bash
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # then fill in JWT_SECRET / ANTHROPIC_API_KEY / MONGO_URL
uvicorn server:app --reload --port 8000
```

Needs a running MongoDB (`docker run -d -p 27017:27017 mongo:7`, or Atlas).

Tests are **HTTP integration tests**, not unit tests — they hit a live server over the network (default `http://localhost:8000`, override via `EXPO_PUBLIC_BACKEND_URL`). Start `uvicorn` first, then:

```bash
cd backend && pytest                        # runs the full suite (all files in tests/)
pytest tests/test_bakers_api.py             # single file
pytest tests/test_bakers_api.py::TestPublic::test_categories   # single test
```

`pytest.ini` pins `-n 2 --dist loadscope` (xdist) — tests within a class/module share sequential state (e.g. register-then-login on the same seeded account), so don't run with a different `-n` value or `-p no:xdist`; use `-n 0` for serial instead.

### Frontend (`frontend/`)

```bash
yarn install
cp .env.example .env        # EXPO_PUBLIC_BACKEND_URL -> your backend's URL
npx expo start               # then press i / a / w, or scan the QR code
```

```bash
npx tsc --noEmit             # typecheck (no dedicated script in package.json)
yarn lint                    # expo lint (eslint-config-expo)
```

No frontend test runner is configured.

EAS build profiles (`development` / `preview` / `production`) live in `eas.json`; `preview`/`production` need their `EXPO_PUBLIC_BACKEND_URL` placeholder replaced with a real deployed backend URL before building.

## Architecture

### Backend — `backend/server.py`

Everything (models, auth, all routes, startup seeding) lives in this one ~600-line file behind an `/api` prefix router. Key pieces:

- **Auth**: hand-rolled JWT (HMAC-SHA256 over base64url header/payload, `sign_jwt`/`verify_jwt`), not a third-party library. `get_current_user` is the single dependency every protected route uses. Passwords are bcrypt-hashed. There is no token revocation — logout is client-side only (stateless JWT).
- **Storage**: `put_object`/`get_object` in the "Storage Helpers" section write/read files under `backend/uploads/`, keyed by an app-generated path (`bakers-app/uploads/{user_id}/{uuid}.{ext}`). `_resolve_upload_path` guards against path traversal on the `/api/files/{path:path}` download route — keep that guard if you touch storage.
- **AI chat**: `/api/chat` calls the Anthropic API directly (`anthropic.AsyncAnthropic`, model `claude-sonnet-5`). It's stateless per-request — conversation history is reconstructed on every call by reading recent `db.chat_messages` for the `(user_id, session_id)` pair and replaying them as the `messages` array. Returns 503 if `ANTHROPIC_API_KEY` isn't set.
- **Data model**: MongoDB, no ORM, plain dicts. Collections: `users`, `recipes`, `favorites`, `likes`, `comments`, `notes`, `friendships`, `friend_requests`, `messages`, `chat_messages`, `tips`, `productions`, `schedules`. Indexes and demo-data seeding (20 recipes, 8 tips from `seed_data.py`) happen in the `startup` event handler, once, when `recipes` is empty.
- Recipes carry a computed `like_count` / `coup_de_coeur` (top-5-liked badge) via `enrich_recipes`, applied after every recipe fetch.
- Friends/messaging require an accepted friendship (`_are_friends`) before messages can be exchanged; friend pairs are stored as a sorted 2-element array so either ordering matches.

### Production planning — `backend/production.py`, `backend/plans.py`

A production is a planned baking day: recipes + quantities, back-planned from a target time. Two modules sit outside `server.py`:

- `production.py` — **pure functions, no DB or network**, so they can be unit-tested directly (the rest of the suite is HTTP-only). `parse_duration` ("1 h 30" → 90), `parse_ingredient`, `scale_ingredients`, `aggregate_ingredients`, `compute_batches`, `build_steps`, `compute_schedule`, `summarize`. Two rules that look like bugs but aren't: **nothing is ever guessed** — a step with no stated duration stays undated and everything *upstream* of it stays undated too (reported in `missing_durations`); and ingredients are grouped on the exact normalized name, so `farine T65` and `farine T45` are deliberately **not** merged.
- `plans.py` — the Free/Pro limits (`PLAN_LIMITS`) and `resolve_plan`. Free = 3 productions/month. There is **no billing provider**: Pro is granted by the `PRO_EMAILS` env var (comma-separated). Enforcement is server-side in `_enforce_production_quota`, which raises a 403 carrying a structured `{"error": "plan_limit_reached", ...}` body so the app can open the Pro screen instead of showing an error.
- Productions **snapshot** the recipe's ingredients, steps and `yield_pieces` at creation, so editing a recipe never rewrites a planning already in use. `_carry_over_step_state` re-matches steps by `(recipe_id, order)` on update, preserving tick status and manually-entered durations.
- Recipes have an optional `yield_pieces` (pieces per batch). When it's absent, quantities fall back to "fournées" — never to an invented piece count.

### Staff schedules — `backend/staff.py`, `frontend/src/schedule/`

A weekly grid of up to 15 people, Sunday to Saturday, with automatic hour totals. It lives under the **Planning** tab (a `Production` / `Personnel` segment), not a seventh tab.

- `staff.py` — pure functions, like `production.py`. Everything is counted in **minutes** and only formatted at the edges, so totals stay exact. A shift whose end is before its start has crossed midnight (`22:00 → 6:00` is 8 h). An empty cell, a day off and an unreadable time are three distinct states and stay distinguishable — an invalid time is rejected at the API rather than silently counted as zero.
- **Overtime is typed in by hand**, never derived: Baker is not told what a normal week is, and a guessed threshold would produce figures a manager could not justify. `total = worked + overtime`.
- Weeks must start on a Sunday (`_validate_week_start`), which is what makes the printed grid line up. `POST /api/schedules/{id}/duplicate` copies a week onto another one; the note is deliberately *not* copied, since it describes its own week.
- **Two export layouts, on purpose** (`frontend/src/schedule/`): `ExportLayout.tsx` is captured by `react-native-view-shot` into a PNG for Photos and sharing, at a fixed 1400 px so the result never depends on screen size; `printHtml.ts` builds A4-landscape HTML for `expo-print`, because a 15-row table rasterised at phone resolution is unreadable on paper. Both are black-on-white rather than themed, and carry no app chrome. User text is escaped in the HTML (`escapeHtml`).
- `export.ts` holds all three actions and never throws into the render tree — each returns `{ok, message}`. Photos is native-only, so the web build says so plainly instead of failing silently; a permanently denied permission offers Settings rather than a pointless retry.
- Exports always run against the **saved** schedule, so an image can never show figures the server has not computed. The buttons are disabled while there are unsaved edits.

### Advertising — `backend/plans.py` (`ads_config`), `frontend/src/ads/`

Ads are **built but switched off**. The architecture is complete; no ad SDK is installed and nothing renders.

- **The server decides.** `ads_config(plan)` in `plans.py` is the only authority: `ADS_ENABLED` (a master switch, default off) AND `plan == "free"`. `/api/me/plan` returns it under `ads`. A client bug therefore cannot show an ad to a Pro account. `available` reports the global switch regardless of plan, so the Pro screen only promises "no ads" when ads actually exist.
- **`frontend/src/ads/`** is the whole client side. `provider.ts` holds the `AdProvider` contract and the current `noopProvider` — swapping in AdMob means writing one object and changing one export, with no screen changes (the file carries the step-by-step instructions). `AdsContext.tsx` fetches the plan once at the root and exposes `canShowAds`. `AdSlot.tsx` is the only component screens use; it renders `null` (never an empty box) when ads aren't allowed, behind an error boundary so a misbehaving ad can't take a screen down. `layout.ts` decides where slots fall in a list.
- **Fails closed.** `canShowAds` requires the plan to be *loaded*, the server to allow it, and consent to be `granted`. Any failure — offline, server error, no consent flow — lands on "no ads".
- Placements: one slot on the home screen between sections, and inline in the recipe list (after the 6th card, then every 10 — tunable via `ADS_LIST_FIRST_SLOT`/`ADS_LIST_INTERVAL` without an app release). Deliberately **none** on recipe detail, planning, chat, calculator or the share form, and **no interstitials at all**.
- Do not turn `ADS_ENABLED` on until (a) Baker Pro is actually purchasable and (b) `provider.ts` implements the Google UMP consent flow plus iOS ATT — users are in the EEA and AdMob suspends accounts that request ads before a certified consent form has run.

### Frontend — `frontend/`

Expo Router (file-based routing) under `app/`:

- `app/_layout.tsx` — root: wraps everything in `AuthProvider` (`src/auth.tsx`), `AdsProvider` (`src/ads/`) and `TimerProvider` (`src/TimerContext.tsx`), renders the global floating `TimerBar`.
- `app/(tabs)/_layout.tsx` — the tab group (`Accueil`, `Recettes`, `Assistant`, `Amis`, `Profil`); redirects to `/auth` if `useAuth().user` is null. This is the entire route-protection mechanism — there's no per-screen guard.
- `app/auth.tsx`, `app/recipe/[id].tsx`, `app/baker/[id].tsx`, `app/chat/[id].tsx`, `app/calculator.tsx`, `app/share.tsx` — stack screens outside the tab group.

Cross-cutting modules in `src/`:

- `src/api.ts` — the only place that talks to the backend. `api(path, opts)` wraps `fetch`, injects the bearer token from `expo-secure-store` (web falls back to `localStorage`), and throws on non-2xx. All screens call through this rather than `fetch` directly.
- `src/auth.tsx` — `AuthProvider`/`useAuth()`; on mount, checks for a stored token and validates it against `/api/auth/me`.
- `src/TimerContext.tsx` — global baking timer state (single timer or a chained multi-step sequence), independent of whichever screen started it, backed by `expo-notifications` for background alerts. `recipe/[id].tsx` parses step text for durations (`parseDuration`) to auto-offer timers.
- `src/theme.ts` — the single source of design tokens (colors, spacing, radius, font sizes) consumed by every screen's `StyleSheet`. `design_guidelines.json` at the repo root is the original aspirational design brief and doesn't fully match the shipped theme (e.g. it specifies Cormorant Garamond/Geist; `theme.ts` actually uses Georgia/system-serif) — treat `theme.ts` as ground truth.

There's no data-fetching library (no React Query/SWR): each screen does its own `useEffect` + `useState` + manual loading/error state, calling `api()` directly.

## Gotchas

- `.emergent/`, `design_guidelines.json`, and `frontend/constants/testIds/` are leftovers from the app's original AI-scaffolded build (the "Emergent" platform) and from an unused automated-QA pipeline (`testIds/auth.js` is never imported anywhere). Harmless, safe to ignore or remove — just don't mistake them for live infrastructure.
- `frontend/scripts/cmd-guard.js` runs on `yarn`'s `preinstall` hook and blocks a handful of deprecated Expo packages (`expo-av`, `expo-barcode-scanner`, `expo-background-fetch`, `expo-file-system/legacy`). It no-ops for everything else outside its original sandbox (falls back to a small baked-in rule list) — if `yarn add`/`yarn install` ever fails with a "cmd-guard: Blocked" message, it's this script, not a real dependency conflict.
- Root `.gitignore` has `.env.*` (blocks committing local secrets) with an explicit `!.env.example` exception — keep that pairing if you add new env-var scaffolding.
