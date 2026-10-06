# Roblox Analytics

A data analytics platform for Roblox game developers. It collects **real data from Roblox every day**
(the games on Roblox's charts, their player counts, visits, favorites and likes), keeps a daily history,
calculates which games and genres are growing, and shows it on a dashboard. A landing page collects
beta signups into a real database and gives each beta member a personal access link.

> **Step-by-step setup for non-developers is in [SETUP.md](SETUP.md).** This README is the reference.

---

## What the application does

| Part | What it does |
|---|---|
| **Data collector** (`npm run scrape`) | Once a day: asks Roblox which games are on its charts, downloads each game's public numbers, checks them for bad data, and saves a daily snapshot in the database. Then recalculates trends. |
| **Dashboard** (`/dashboard`) | Top games (sortable, filter by genre), fastest-growing games, genre breakdown, and a "Data updated" time. Beta members can open any game and see its history charts. |
| **Landing page** (`/`) | Explains the product, shows live numbers from the database, and collects beta signups. |
| **Beta access** | Every signup gets a secure personal link. Confirming the email (or opening the on-screen link if email is off) unlocks beta features. |
| **Product analytics** | Anonymous events (landing views, signups, dashboard views, feature use) stored in the `events` table. |

**Honesty rule:** the app never shows a number Roblox doesn't publish. Retention, session length and
revenue are shown as **"Not publicly available"**. Trends show **"Not enough history yet"** until there
are 14 days of daily snapshots.

---

## Architecture

```
                         ┌──────────── once a day (GitHub Actions) ─────────────┐
                         │                                                        │
Roblox public endpoints ─┤  src/roblox/provider.js     (only file that knows Roblox URLs)
                         │        ↓
                         │  src/roblox/normalizer.js   (Roblox JSON → our shape)
                         │        ↓
                         │  src/roblox/validators.js   (reject impossible / malformed data)
                         │        ↓
                         │  Supabase Postgres: games, game_snapshots
                         │        ↓
                         │  src/analytics/trends.js    (calculate trends → game_stats)
                         └────────────────────────────────────────────────────────┘
                                  ↓
                Express API (server.js → src/app.js → src/routes/*)
                                  ↓
             public/landing.html, public/dashboard.html (plain HTML/CSS/JS)
```

* **Hosting:** Vercel runs the Express app (auto-detected from `server.js`) and serves `public/` from its CDN.
* **Database:** Supabase (PostgreSQL). The app connects **server-side** with `DATABASE_URL`.
* **Daily job:** GitHub Actions (`.github/workflows/daily-scrape.yml`) runs `npm run scrape`.
* **Email:** Resend (optional; isolated in `src/email/`).

```
server.js                 entry point (local server + Vercel)
src/
  config.js               every environment variable, with defaults
  logger.js
  app.js                  Express app: security headers, CORS, rate limits, routes
  db/index.js             Postgres connection (parameterized queries only)
  db/migrate.js           applies db/migrations/*.sql once each
  roblox/httpClient.js    polite HTTP: delays, retries, backoff, Retry-After, circuit breaker
  roblox/provider.js      Roblox endpoints
  roblox/normalizer.js
  roblox/validators.js
  roblox/scraper.js       the pipeline
  analytics/trends.js     trend maths (pure functions)
  repositories/           all SQL
  routes/                 API endpoints
  middleware/             validation, errors, beta access check
  beta/tokens.js          secure tokens (stored hashed)
  email/provider.js       Resend or "none"
  email/templates.js
public/                   landing.html, dashboard.html, js/
db/migrations/            database schema (SQL)
scripts/                  scrape.js, migrate.js, check-env.js
test/                     automated tests (node:test)
```

---

## Where every number comes from

| Metric | Source | Reliable? |
|---|---|---|
| Which games to track | `apis.roblox.com/explore-api/v1/get-sort-content` (the Roblox **Charts** page: `top-playing-now`, `top-trending`, `up-and-coming`, `top-revisited`). Sponsored/ad entries are excluded. Fallback: `explore-api/v1/get-sorts`. | **Undocumented endpoint.** Works without a login, but Roblox can change it any time. It's isolated in `provider.js`, and games we already track keep being collected even if discovery breaks. |
| Name, description, creator, universe ID, root place ID | `games.roblox.com/v1/games?universeIds=…` | Yes (documented public API) |
| **Total visits** | `games.roblox.com/v1/games` → `visits` | Yes |
| **Concurrent players** | `games.roblox.com/v1/games` → `playing` | Yes, as of the moment of the daily snapshot (not a daily average or peak). |
| **Genre / subgenre** | `games.roblox.com/v1/games` → `genre_l1` / `genre_l2` (falls back to legacy `genre`; "All" = no genre) | Yes, set by the creator; some games have none. |
| **Release date** | `games.roblox.com/v1/games` → `created` | Partial: it's when the experience was created, which may be before its public launch. |
| Last updated | `games.roblox.com/v1/games` → `updated` | Yes |
| Favorites | `games.roblox.com/v1/games` → `favoritedCount` | Yes |
| Likes / dislikes | `games.roblox.com/v1/games/votes?universeIds=…` | Yes |
| Which charts listed a game that day | Discovery step above | Yes |
| **Trend** (Growing / Stable / Declining) | **Calculated** from our own daily snapshots (see below) | Yes, once 14 days of history exist; before that: "Not enough history yet". |
| Visits per day, 7-day and 30-day growth, 7-day player change | **Calculated** from our snapshots | Yes (needs 7 / 14 / 60 days of history) |
| Retention | — | **Not publicly available.** Stored as `null`. |
| Average session length | — | **Not publicly available.** Stored as `null`. |
| Monetization / revenue | — | **Not publicly available.** Stored as `null`. (Game passes can be listed publicly, but a list of passes says nothing about revenue; not collected yet.) |
| Historical data before we started | — | **Not available** from Roblox. History starts the day you first run the collector. |

The `game_metrics` table exists (empty) so retention/session/monetization can be added later **only**
from a legitimate source (for example, numbers developers share with you), with a required `source`
column and an `is_estimate` flag.

### How trends are calculated

1. *Visit velocity* = visits gained per day between two daily snapshots.
2. Compare velocity over the **last 7 days** with the **7 days before that**.
3. Change ≥ **+10%** → **Growing**; ≤ **−10%** → **Declining**; otherwise **Stable**
   (threshold: `TREND_THRESHOLD_PCT`).
4. Fewer than 14 days of history, or missing days → **insufficient_data** (shown as "Not enough history yet").

Visit velocity is used rather than player counts because visit totals don't swing with time of day.
A game whose total visits still rise but *more slowly* than last week is correctly shown as Declining.

### Data-quality safeguards

Records are **skipped and logged, never stored**, if: the universe ID is not a positive integer; the name is
missing; visits or players are negative, non-numeric or impossibly large; dates are malformed or before
2006; or total visits dropped by more than 1% since the previous day (visits can only go up). Games are
never duplicated (unique `universe_id`; one snapshot per game per UTC day; re-running updates that day).
Games not refreshed for `STALE_AFTER_DAYS` are hidden from lists.

### Being polite to Roblox

Requests are sequential with a delay (`ROBLOX_REQUEST_DELAY_MS`, default 250 ms), batched 50 games per request,
retried on 429/5xx/network errors with exponential backoff + jitter (`ROBLOX_MAX_RETRIES`, default 3),
honoring `Retry-After`. After 5 consecutive failed requests the run stops. A typical run makes about 15–20
requests. The collector never logs in, uses no cookies, and does not try to get around any Roblox protection.

---

## Database

Schema: [`db/migrations/001_initial_schema.sql`](db/migrations/001_initial_schema.sql).

| Table | Purpose |
|---|---|
| `games` | One row per Roblox experience (unique `universe_id`): name, genre, creator, release date… |
| `game_snapshots` | One row per game per day: visits, concurrent players, favorites, votes, charts. Unique `(game_id, snapshot_date)`. |
| `game_stats` | Calculated trend numbers per game (refreshed after each collection). |
| `game_metrics` | Empty on purpose: future retention/session/monetization from legitimate sources. |
| `scrape_runs` | Log of each collection run (powers "Data updated at"). |
| `beta_signups` | Name, email (unique, case-insensitive), answers, status, email confirmation, **hashed** tokens. |
| `events` | Anonymous product analytics. |
| `schema_migrations` | Which migrations have been applied. |

Row Level Security is switched on for every table with **no policies**, so Supabase's public REST API
(the "anon" key) can read nothing. The app itself connects directly with `DATABASE_URL` and is unaffected.

---

## API

All responses are JSON. Data responses include `meta.dataUpdatedAt`.

| Method & path | Description |
|---|---|
| `GET /api/health` | Database connectivity + whether email is configured. |
| `GET /api/games?sort=playing\|visits\|growth\|newest&genre=&trend=&limit=25&offset=0` | Games with latest numbers and trend. |
| `GET /api/games/:universeId` | One game. |
| `GET /api/games/:universeId/history?days=90` | Daily snapshots. **Beta only** (`Authorization: Bearer <token>`). |
| `GET /api/trends` | Counts per trend + fastest rising/falling games + method/threshold. |
| `GET /api/genres` | Per genre: games, players now, visits, rising/falling counts. |
| `GET /api/status` | Games tracked, snapshots stored. |
| `POST /api/beta-signups` | `{ name, email, robloxUsername?, gameExperience?, interest? }` → 201 new / 200 already registered / 400 invalid / 429 too many. |
| `GET /api/beta/confirm?token=` | Email confirmation link → redirects to the dashboard with access. |
| `GET /api/beta/access` | Checks a beta token (`Authorization: Bearer <token>`). |
| `POST /api/events` | `{ name, path, sessionId, props }` (allow-listed event names only). |

### How beta access works

1. On signup the server creates two random 256-bit tokens (a one-time **confirmation** token, valid 72 h,
   and an **access** token). Only their SHA-256 hashes are stored. Tokens contain no personal data.
2. With email on: the confirmation link is emailed. Clicking it marks the email confirmed, issues a fresh
   access token, and redirects to `/dashboard#access=<token>`.
   With email off: the API returns the access link directly and the email stays unconfirmed.
3. The token is in the URL **fragment** (`#…`), which browsers never send to servers, so it doesn't show up in
   logs. The dashboard saves it in the browser, removes it from the address bar, and sends it as an
   `Authorization` header.
4. Signing up again with the same email doesn't create a duplicate; it issues a fresh link (old links stop working).
   With email on, re-sends are limited to one per 10 minutes.

---

## Prerequisites

* Node.js 20 or newer (22 recommended)
* A free Supabase project
* A free GitHub account (for the daily job) and a free Vercel account (hosting)
* Optional: a free Resend account and a domain you own (for emails)

## Installation & running locally

```bash
npm install
cp .env.example .env      # then fill in DATABASE_URL (see SETUP.md)
npm run check-env         # checks your settings in plain English
npm run db:migrate        # creates the tables
npm run scrape            # collects today's Roblox data
npm run dev               # starts the site at http://localhost:5000 (restarts on file changes)
```

`npm start` runs without auto-restart. Landing page: `http://localhost:5000/`. Dashboard: `http://localhost:5000/dashboard`.

## Environment variables

See [`.env.example`](.env.example) for every variable with explanations. Required: `DATABASE_URL`.
Recommended in production: `BASE_URL`, `NODE_ENV=production`. Email: `EMAIL_PROVIDER=resend`,
`EMAIL_API_KEY`, `EMAIL_FROM`.

**Which keys are secret?** All of them. Nothing from `.env` is sent to the browser: the frontend only calls
this app's own `/api`. This app doesn't use the Supabase anon key or service-role key at all
(it connects straight to Postgres), so there's no Supabase key to leak in frontend code.

## Tests

```bash
npm test
```

51 automated tests cover: trend maths, data validation, the HTTP client (retries, backoff, Retry-After,
malformed JSON, circuit breaker), the full collection pipeline against a fake Roblox server (storage,
idempotent re-runs, malformed records, Roblox outages, fallbacks), and every API endpoint (validation,
duplicates, honeypot, rate limit, confirmation flow, beta gating, CORS, security headers). Tests use a
local PostgreSQL at `TEST_DATABASE_URL` (default `postgres://postgres:postgres@localhost:5432/ra_test`) or,
if none is running, an in-memory Postgres. **Tests wipe that database; never point it at production.**
Test fixtures (`test/fixtures/`) are only used by tests.

## Deployment

Vercel (app) + Supabase (database) + GitHub Actions (daily collection). Step by step: [SETUP.md](SETUP.md).

## Daily scraper

`.github/workflows/daily-scrape.yml` runs every day at 03:17 UTC, and can be started by hand from the
GitHub **Actions** tab ("Run workflow"). It needs the `DATABASE_URL` repository secret. Why GitHub Actions
instead of Vercel Cron: a run can take a minute or more, which is close to Vercel's function time limits,
and GitHub Actions is free for this usage and shows a full log of every run.

GitHub only runs scheduled workflows from the repository's **default branch** (usually `main`), and pauses
them in public repositories after 60 days with no commits (one click re-enables them).

## Troubleshooting

| Problem | Fix |
|---|---|
| Dashboard says "No data has been collected yet" | Run `npm run scrape`, or start the GitHub workflow by hand. |
| `DATABASE_URL is not set` | Create `.env` from `.env.example` and fill it in (SETUP.md step 3). |
| `password authentication failed` | Wrong database password in `DATABASE_URL`. Reset it in Supabase → Project Settings → Database. |
| `getaddrinfo ENOTFOUND` / timeouts to Supabase | Use the **Transaction pooler** connection string (port 6543); the "Direct connection" needs IPv6. |
| Scrape says `HTTP 403` or `HTTP 429` from Roblox | Roblox is refusing or rate-limiting. Wait and retry; raise `ROBLOX_REQUEST_DELAY_MS` (e.g. 1000). |
| Scrape says `Chart "…" unavailable` for every chart | Roblox changed its Charts endpoint. Already-tracked games still update; update `src/roblox/provider.js`. |
| Trends all say "Not enough history yet" | Normal for the first 14 days. |
| Signups get the link on screen instead of by email | Email isn't configured. See SETUP.md step 7. |
| `Too many signup attempts` | Rate limit: 5 signups per network per hour. |
| Data is shown with a "more than 3 days old" warning | The daily job is failing. Check GitHub → Actions → the latest run's log. |

## Security notes

* Helmet security headers and a strict Content-Security-Policy (no inline scripts).
* All SQL is parameterized; all input is validated on the server (and the browser).
* Rate limits: 120 API requests/min, 5 signups/hour, 60 events/min per IP. On Vercel each running instance
  counts separately, so these limits are approximate. Signups also have a hidden honeypot field.
* Tokens: 256-bit random, stored only as SHA-256 hashes, sent in a header, never logged.
* Error responses never include stack traces or secrets.
* CORS: only the site's own address (`BASE_URL`) plus `CORS_ORIGINS`.
* Row Level Security blocks Supabase's public REST API from all tables.
* `.env` is git-ignored. Never commit it.

## Known limitations

* **No history before day one.** Roblox doesn't publish past numbers, so trends appear after 14 days.
* **Discovery uses an undocumented Roblox endpoint** (the Charts page API). It may change without notice.
* **Concurrent players are a single daily reading**, not an average or peak.
* Collecting more than once a day only updates that day's snapshot (by design).
* Rate limiting on Vercel is per instance (approximate).
* Using public Roblox data in a paid product: these are public, unauthenticated endpoints, but Roblox's
  Terms of Use apply. Review them (and consider asking Roblox) before charging money.
* The Privacy and Terms links on the landing page are placeholders. You're collecting emails, so publish a
  privacy policy before promoting the page.
