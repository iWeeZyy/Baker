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

Most tests are **HTTP integration tests**, not unit tests — they hit a live server over the network (default `http://localhost:8000`, override via `EXPO_PUBLIC_BACKEND_URL`). The exceptions are `test_production_calc.py`, `test_staff_calc.py`, `test_seed_quality.py`, `test_moderation_calc.py` and `test_imaging_calc.py`, which are pure and need no server. Start `uvicorn` first, then:

The graduated-classification tests in `test_messaging_photos.py::TestGraduatedLevels` additionally need the server under test started with `MODERATION_PROVIDER=stub` (see "Message photos" below) — they skip themselves otherwise rather than failing, since a real Sightengine response to a solid-colour test image isn't predictable.

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
- **Storage**: `put_object`/`get_object` in the "Storage Helpers" section write/read files under `backend/uploads/`, keyed by an app-generated path (`bakers-app/uploads/{user_id}/{uuid}.{ext}`). `_resolve_upload_path` guards against path traversal on the `/api/files/{path:path}` download route — keep that guard if you touch storage. `put_private_object`/`get_private_object` are the same shape but rooted at a *different* directory (`backend/private_uploads/`) that `/api/files/{path:path}` cannot reach at all — used for message photos, which are never served through the public route (see "Message photos").
- **AI chat**: `/api/chat` calls the Anthropic API directly (`anthropic.AsyncAnthropic`, model `claude-sonnet-5`). It's stateless per-request — conversation history is reconstructed on every call by reading recent `db.chat_messages` for the `(user_id, session_id)` pair and replaying them as the `messages` array. Returns 503 if `ANTHROPIC_API_KEY` isn't set.
- **Data model**: MongoDB, no ORM, plain dicts. Collections: `users`, `recipes`, `favorites`, `likes`, `comments`, `notes`, `friendships`, `friend_requests`, `messages`, `reports`, `chat_messages`, `tips`, `productions`, `schedules`. Indexes are created in the `startup` handler, which also **syncs** recipes and tips from `seed_data.py` on every boot (upsert keyed on the title, so a fix reaches the DB on the next deploy). Community-submitted recipes are never touched. A `messages` doc has `type: "text"|"photo"`; a photo message additionally carries `photo_path`, `photo_blur_path` (only when `sensitive`) and a `moderation` dict — see "Message photos".
- Recipes carry a computed `like_count` / `coup_de_coeur` (top-5-liked badge) via `enrich_recipes`, applied after every recipe fetch.
- Friends/messaging require an accepted friendship (`_are_friends`) before messages can be exchanged; friend pairs are stored as a sorted 2-element array so either ordering matches.

### Recipe families — `backend/families.py`, `frontend/src/families.ts`

The catalogue is browsed by **family** (Pains, Tartes, Biscuits et sablés…), a rank between the three categories and the sheet: eighty recipes under "Pâtisseries" could not be read as one list. `backend/families.py` is the single source — an ordered `FAMILIES` list and a `FAMILY_BY_TITLE` table covering every seeded recipe. `seed_data.py` stamps `family` on each recipe at join time and **refuses to import** if a title is missing from the table, since a recipe no tile opens is a recipe nobody finds.

- A family belongs to exactly one category, which is why base doughs are split into `pates-tourees` (Viennoiseries) and `pates-a-tarte` (Pâtisseries) instead of one straddling family.
- `pains` is currently **declared but empty**: the imported work is a pastry and viennoiserie book. Empty families are not returned by the API and the browse chips are derived from the families actually present, so both the tile and the "Pains" chip reappear on their own with the first bread.
- Three `catch_all` families (`autres-*`) exist only for community recipes submitted without one. `GET /api/families` omits empty families, so they stay out of the grid until something lands in them; `?include_empty=1` is for the share form, which has to offer a family before anything is in it.
- Tiles are **drawn, not photographed**: `frontend/assets/images/families/*.svg` rendered to PNG by `frontend/scripts/build-tiles.mjs` (Chromium via Playwright, run by hand, not part of the build; it renders the `products/` tiles too). Only `src/theme.ts` colours are used. `FAMILY_TILES` in `src/families.ts` is a `Record<FamilyKey, …>`, so a family without a tile fails `tsc` rather than showing an empty box.
- Recipe cards inside a family carry **no image** on purpose: the imported sheets have no photo, and one generic picture repeated over nineteen tarts would read as a photo of each. (The recipe *screen* does carry a drawn illustration — see the next section for why a drawing is allowed to repeat where a photo isn't.)

### Recipe images — `backend/recipe_photos.py`, `backend/products.py`, `frontend/src/products.ts`

None of the 194 imported sheets carries a photo of its own: the books' photographs are not reproduced (the data is taken, the images are not). Images therefore come from outside, and one function decides which — `recipeImage(recipe, apiBase)` in `src/products.ts`, used by the recipe screen, the home screen, the profile and the baker page so they cannot diverge. Four steps, in order:

1. the **upload** of a community recipe (`image_path`);
2. a **photograph of the product**, when one exists that really shows *that* product (`image_url`, from `recipe_photos.py`);
3. the **drawing of its archetype** — the shape, not the dish (`products.py`);
4. nothing, and the screen paints a plain warm band (never a grey one, which reads as a failed image load).

A drawing reads as an **emblem** rather than as a picture of that particular piece, which is exactly what makes repetition acceptable where a photo would lie: nineteen tarts sharing one drawing say "a tart"; nineteen copies of one photo would say "here is *that* tart". A photograph earns its place only by being of the right product — which is why step 2 sits above step 3 but is much harder to fill.

#### Photographs — `backend/recipe_photos.py`

Photos come from **Pexels** (Pexels License, commercial use, no royalty). Wikimedia Commons was tried first and abandoned: it is a documentary archive, not a culinary photo library — a "croissant" search returned an *oranais*, a "bretzel" search a branded sandwich on a cafeteria tray. Both had a perfect title.

That failure is the whole design of this table:

- **A photo is never chosen on its title.** It is *looked at*. Every entry carries a `vu` field recording, in French, what was actually seen in the image; `tests/test_recipe_photos.py` rejects an entry without it. `tools/harvest_pexels.py` exists to make that review possible at scale — it queries Pexels and builds one **contact sheet** of candidates per recipe, and deliberately chooses nothing itself.
- **Nothing rather than roughly right.** A recipe whose product has no honest photo gets none and keeps its drawing. The table does not cover the whole catalogue, and that is deliberate.
- **The credit is not optional.** Pexels' *API Guidelines* go further than the licence and require naming the photographer with a link to their profile plus a link back to Pexels. That is what `image_credit` renders under the photo, in the style of the existing "D'après …". An entry with no author or no source page is rejected by the tests: you cannot credit what you did not record.
- `url` points at the Pexels CDN, which permits hotlinking; nothing is copied into the repo. The search happens once, at harvest time — the app never talks to Pexels.
- Harvesting needs `PEXELS_API_KEY` **and** `api.pexels.com` / `images.pexels.com` allowed by the environment's network policy. Without both, the table stays empty and every sheet keeps its drawing, which is a valid state rather than a failure.

- `backend/products.py` is the single source, same shape as `families.py`: an ordered `PRODUCTS` list of archetype keys and an `_ASSIGNMENTS` table mapping recipe titles to them. `seed_data.py` stamps `product` on each seeded recipe via `product_of`.
- Unlike `family`, `product` is **allowed to be absent**, and the table deliberately does not cover the whole catalogue (150/194). A kouglof, a braid or a palmier gets no archetype because no drawing renders that shape honestly — a pain de mie illustrated by a boule would be worse than nothing. `app/recipe/[id].tsx` then shows a plain warm band (not a grey one, which would read as a failed image load).
- Tiles come from the same pipeline as the family tiles: SVG in `frontend/assets/images/{families,products}/`, rendered to PNG by `frontend/scripts/build-tiles.mjs` (now walks both directories). Sixteen archetypes reuse a family tile that already draws exactly that shape; six are drawn for the products. Only `src/theme.ts` colours are used.
- `PRODUCT_TILES` in `src/products.ts` is a `Record<ProductKey, …>`, so an archetype without a tile fails `tsc`. `backend/tests/test_products.py` covers what `tsc` can't see: an unknown title, an archetype nobody uses, a `require` pointing at a missing PNG, a PNG with no SVG source.
- The short list of archetypes is the point, not a to-do: drawings that didn't read (a spiral overflowing its frame, a braid that looked like a chain of beads) were thrown away rather than shipped.
- There is **no hardcoded remote image left in the app**. Six render sites used to fall back to a single Unsplash URL (`photo-1509440159596-…`, a scaffold leftover of unverified licence) or to nothing at all — the home hero and its "Grands classiques" cards rendered empty white boxes for all 194 recipes. They all go through `recipeImage` now. If you add a screen that shows a recipe, use it rather than reaching for `image_url` directly.

### Recipe content — `backend/seed_data.py`, `backend/seed_books.py`

**Every recipe now comes from `seed_books.py`** — sheets taken from professional works, each carrying the page it was read from. The twenty demonstration recipes the app was scaffolded with have been removed: they were written by a language model, not a baker, and a recipe that cannot say where a quantity comes from has no place in a bakery tool. The eight original tips are the last of that batch and are still there, unsourced.

Two works are imported so far, and `source` names which one each sheet came from:

- **Josée Fiset, « Comme à la boulangerie », Pratico Édition** — 90 sheets, the home-baking pastry catalogue. Read from a PDF with a text layer, so it went through an extraction pipeline whose faults `test_seed_quality.py` was written against.
- **FERRANDI Paris, « Boulangerie Viennoiserie », Flammarion** — 104 sheets: the breads, the preferments, the base doughs, the viennoiserie and the filled breads. The PDF is a **scan with no text layer**, so its pages were read directly rather than OCR'd: an OCR turning an 8 into a 3 announces nothing, and a wrong quantity is the only really serious fault in a bakery tool.

**One sheet per product.** Where both books cover the same thing — croissant, pain au chocolat, babka, tarte au sucre, pâte à brioche… — the FERRANDI version replaces the Québec one, which leaves the seed and is deleted from the database by `retire_built_ins` on the next deploy. That is what keeps FERRANDI's chain of cross-references honest: its croissant leans on *its* pâte levée feuilletée, with its own quantities. The replaced titles are listed in the generator, not hidden in a diff.

**The seed is authoritative in both directions.** The startup handler upserts every recipe in `RECIPES_SEED` *and* deletes built-in recipes that are no longer in it (`retire_built_ins` in `server.py`, covered by `tests/test_retire_seed.py`). Retiring content is therefore a deploy, not a manual database cleanup. Two rules keep that safe: only `is_user_submitted: False` documents are ever considered, and the likes/comments/notes/favourites of a deleted recipe go with it. A production already built on a deleted recipe keeps working — it snapshots ingredients and steps — but *editing* it will 404 on the missing recipe.

- `seed_books.py` is **generated then reviewed**, not hand-maintained line by line. Quantities, temperatures, durations and yields are copied from the cited work; descriptions and step lists are written for Baker. Method paragraphs are deliberately **not** reproduced — the data is taken, the prose is not. That distinction is what makes the import legitimate in a distributed app, so keep it if you add a source.
- Two optional fields carry the import: `technical` (a dict — the keys the recipe screen knows how to render are listed in `TECHNICAL_ROWS` in `app/recipe/[id].tsx`; an unknown key is silently invisible) and `source` (the work and page). Absent means "not stated in the source", never an estimate.
- `hydration` is filled only when the water-and-milk over flour ratio is directly computable — preferment included, since its own flour and water are given; it stays 0 otherwise rather than being guessed. It also stays 0 when the figure would be *arithmetically* right but misleading: water drunk by a seed soaker, by cocoa powder, or a dough whose liquid is beer.
- Where a book contradicts itself — a sidebar saying 20 minutes and the method paragraph saying 35 — the **method paragraph wins**, because the sheet has to agree with itself on screen. These are listed in the import notes, not silently averaged.
- `tests/test_seed_quality.py` is the guardrail: it runs without a server and checks the whole catalogue for the faults a PDF extraction actually produces — sentence fragments in ingredient lists, unbalanced parentheses, leftover imperial measures, book cross-references ("photo B"), implausible temperatures, a `yield_pieces` that contradicts its own label. Run it before touching seed content.

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

### Message photos — `backend/moderation.py`, `backend/imaging.py`, `frontend/src/revealedPhotos.ts`

A message can carry a photo. The rule the whole feature is built around: a photo flagged as potentially sexual is never blocked — it sends normally, but the recipient sees it blurred behind a warning until they choose to reveal it. Only a photo scored as unambiguously explicit is refused outright, before anything is stored.

- **Detection**: Sightengine's classic `nudity` model (`raw`/`partial`/`safe` scores), chosen over Google Cloud Vision SafeSearch and AWS Rekognition specifically because it needs only a lightweight API user/secret pair — no cloud console, no billing account, no IAM — the same onboarding shape as `PEXELS_API_KEY`. Its free tier (2,000 checks/month) covers a friends-only messaging feature; see `backend/moderation.py`'s docstring for the full comparison and for why the classic model was used over the newer `nudity-2.1` (its field names are stable and well-documented; `nudity-2.1`'s were not verifiable against a live call from this environment's network policy at the time this was written).
- `moderation.classify(raw, partial)` is pure: only `raw` (fully explicit) can reach `blocked`; `partial` (partial nudity) can only ever push a photo to `sensitive`, never to `blocked` — potential nudity alone is never treated as forbidden. Both thresholds (`MODERATION_SENSITIVE_THRESHOLD`, `MODERATION_BLOCK_THRESHOLD`) are read from the environment, so they're retunable without a rebuild.
- **Fails cautious, not open.** If Sightengine is unreachable, unconfigured, or errors, `moderation.analyze()` never raises and never assumes a photo is safe — it returns the configured `MODERATION_FALLBACK` level (default `sensitive`). Running with no Sightengine credentials at all is therefore deploy-safe: every photo just stays blurred-by-default until real credentials are added.
- `MODERATION_PROVIDER=stub` swaps in a deterministic, network-free classifier keyed to a test image's average colour (red → blocked, orange → sensitive, blue → simulated outage, anything else → normal) — **test/local-dev only, never set in production**. This is what `test_messaging_photos.py::TestGraduatedLevels` needs to exercise all four outcomes without live credentials (see Commands above).
- **Images never leave the server larger than what gets shown.** `imaging.prepare_display()` resizes/compresses the upload before it is analyzed, stored, or shown (`MAX_DISPLAY_DIM`, 1600px). For a `sensitive` result, `imaging.make_blur_preview()` additionally produces a second artifact: the source is shrunk to `BLUR_SOURCE_DIM` (24px) *before* blurring, then scaled back up — detail is actually discarded, not just visually smeared, so the preview is safe to send before the recipient reveals anything, and the client never has to fetch the full photo just to render the blurred stand-in.
- **Private storage, not the public upload path.** Message photos are never written under `backend/uploads/` (served publicly, with no auth, by `GET /files/{path}`). They live in a separate `backend/private_uploads/` tree, reachable only through `GET /messages/photos/{message_id}`, which checks the requester is one of the message's two parties *and* is still friends with the other — same rule `GET /messages/{friend_id}` already enforces for text history. Two separate directory roots, not a prefix filter on a shared one, so a bug in the authorization check can never expose a private photo through the public route by construction.
- A `blocked` photo is refused at `POST /messages/{friend_id}/photo` (422) before `put_private_object` is ever called — nothing is written, nothing is sent, nothing is analyzed by anything downstream of that response.
- Reporting: `POST /messages/{message_id}/report` (reason: `sexual`/`illegal`/`violence`/`harassment`/`spam`/`other`) is new — no report system existed before this. Scoped to any message (not just photos) since the check (must be a party to the message) is identical either way, though only photo bubbles expose the report action in the UI today.
- Frontend: `src/revealedPhotos.ts` is a small AsyncStorage-backed set of revealed message ids (capped at 500, oldest dropped first) — "remember the choice" is a local preference, not a change to the message model. The sender always sees their own photo unblurred; only the recipient of a `sensitive` photo they haven't revealed yet sees the blur+warning overlay.

### Text moderation — `backend/text_moderation.py`

Recipe submissions (`POST /recipes`) and comments (`POST /recipes/{id}/comments`) are checked against a context-aware moderation model before being stored. Scope is deliberately just those two: messages are covered separately by `moderation.py` (image only, text out of scope there), and personal notes are never seen by anyone else. The problem this exists to solve: a generic banned-word filter would flag French baking vocabulary — "bâtard" is first and foremost a bread shape, not an insult — as forbidden. So a professional whitelist always wins over a ban-word match, not the other way around.

- Pure module, same family as `production.py`/`staff.py`/`moderation.py` — no DB, no network. `WHITELIST_TERMS` maps a normalized professional term (accents/case stripped via `production.normalize_name`, reused rather than duplicated) to either `None` (never has an insulting sense at all — "fougasse", "miche"…) or a list of context markers ("pain", "façonner", "levain"…) whose presence *anywhere in the same submitted text* confirms professional usage. `BAN_WORDS` is the operator-supplied list of forbidden terms — it ships **empty in the repo on purpose**: the real list belongs to whoever runs the app, not to a value invented here. Empty means nothing is ever blocked or flagged.
- Three-tier decision, in priority order: **SAFE** (no ban-word hit, or a ban word whose whitelist entry is `None` or whose context marker is found elsewhere in the text) → publishes normally. **REVIEW** (a whitelisted term matched with no context marker anywhere — genuinely ambiguous) → **still publishes normally**, never auto-blocked on ambiguity alone, but is logged to a new `flagged_content` collection for later manual review — there's no admin UI, it's a log to query directly. **BLOCKED** (a ban word with no whitelist entry at all — no professional sense to save it) → rejected with a generic 422 before anything is inserted; the response never names the matched term, so the message can't be reverse-engineered into a filter-bypass guide.
- `_moderate_and_flag()` in `server.py` is the single call site both `create_recipe` and `add_comment` go through, right after building the document and before `insert_one`. `classify_recipe(title, description, ingredients, steps)` searches for context across *all* of a recipe's fields, not just the one the term appeared in — a title like "Bâtard de campagne" is legitimized by "façonner" showing up in the steps.
- **Never remove "bâtard" from the terms this module watches without thinking about context first.** It must stay an explicit `WHITELIST_TERMS` entry (not just absent from `BAN_WORDS`) so the system always knows it's a legitimate professional term in this app, however the ban list evolves.
- `TEXT_MODERATION_TEST_BAN_WORDS` (env var, comma-separated) merges test-only words into `BAN_WORDS` at import — same idea as `MODERATION_PROVIDER=stub` above. **Test/dev only, never set in production.** It's what lets `tests/test_recipe_moderation.py` exercise the real BLOCKED/REVIEW paths of a running server without a real banned word ever living in the repo; those tests skip themselves when it's unset.

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
