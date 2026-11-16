# Home info features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an idle screen, a calendar, a BNR exchange-rate page and a football page to the Home fork, each with its own Settings tab, active only with the mr.redify theme.

**Architecture:** One module per feature under `launcher/`, each registering a Settings tab and (except the idle screen) a page in one full-screen info panel opened from a new header button. A shared store and a shared cache/HTTP helper sit underneath. BNR needs one new LS2 method in the Home Helper service (`renewal-service/bnr.js`); everything else runs in the page.

**Tech Stack:** Vanilla JS for the old TV web engine (must pass `npm run lint:compat`), CSS, Node `.cjs` tests plus Playwright UI tests (pattern: `tests/weather/`), Python build scripts (`scripts/home_assets.py`).

**Spec:** `docs/superpowers/specs/2026-11-16-home-info-features-design.md`

## Global Constraints

- Scope: everything is active **only while the mr.redify theme is active** (class `ctv-mr-redify` on `#homeSurface`, set in `launcher/theme-runtime.js`). On any other theme: no tabs, no header button, idle timer stopped, no network requests.
- Romania only for holidays and name days; bundled offline; Romanian content text.
- Language: Romanian (`ro`) is added to Home (Task 0). Every new UI text goes through `HomeI18n.t('<English text>')` with the English text as key; the Romanian value lives in `launcher/info-locales.js` (`HomeI18n.add({ en: {...}, ro: {...} })`). Other languages fall back to English. Never hard-code a user-visible string outside `info-locales.js`.
- Idle timeout choices: Off / 5 / 10 / 30 minutes, default 10. Styles: `clock` (big clock + date + weather) and `panel` (info panel with per-block toggles).
- Own events: maximum 50. Favourite teams: 1 to 5. BNR default currencies: EUR, USD, GBP, CHF.
- BNR source: `https://curs.bnr.ro/nbrfxrates.xml` (never `www.bnr.ro`, it redirects to the home page). Service method host and path are fixed; the caller sends no destination.
- Football: ESPN public site API (`site.api.espn.com`), no standings. Refresh hourly, every 60 s only while a followed team has a live match.
- Settings are local only, keys `tvhome.idle.v1`, `tvhome.daily.v1`, `tvhome.calendar.v1`, `tvhome.finance.v1`, `tvhome.football.v1`; cache keys `tvhome.cache.v1.<name>`. A corrupt value resets that module to defaults.
- Every network failure degrades to cached data or a short message; nothing may block Home start-up or key handling.
- Work stays **local** (branch `features` of `~/cytv-fork`): no push, no install on the TV, no change to the TV without the owner's explicit approval.
- Commit messages end with `Authored-By: Marius ROSU <salut@ronorai.ro>` and never with a `Co-Authored-By` line (owner's standing rule).
- After each task the controller reports, in Romanian, the table `Task | Implementat | Review | Fix | Re-review | Stare` with model and effort per stage.

## Review Focus

- Corrupt or hostile stored values (for example `tvhome.idle.v1` = `{"timeoutMin":"abc"}`, a non-array `events`): the module falls back to defaults and Home keeps working (tests in Tasks 1, 6, 9).
- Device clock wrong or outside 1900-2099: calendar and holiday functions return empty results, never throw (Task 4).
- No internet, BNR method missing (Root edition, old Helper) or ESPN returns an unexpected JSON shape: page shows a short message or the cached values, idle blocks are omitted, no exception reaches Home (Tasks 7, 8).
- Theme switched while the info panel or idle screen is open: both close, timers stop, no further requests (Tasks 5, 9).
- The key or pointer move that wakes the idle screen must not also activate anything underneath; Back inside the panel must not exit Home (Tasks 5, 9).

## File Structure

```
launcher/info-locales.js      en + ro texts of all new features (Task 0 creates, later tasks add keys)
launcher/info-store.js        HomeInfo: scope signal, createStore, registerTab/tabs
launcher/info-fetch.js        HomeInfoFetch: http(), cached()
launcher/ro-calendar-data.js  HomeRoCalendar: pure Easter, holidays, name days
launcher/info-panel.js/.css   InfoPanel: header button page host
launcher/calendar-page.js/.css  Calendar page + Calendar tab + HomeInfo.daily store
launcher/finance.js/.css      Rates page + "Rates & holidays" tab (daily toggles live here)
launcher/football-espn.js     ESPN provider (only file that knows ESPN)
launcher/football.js/.css     Football page + tab
launcher/idle-screen.js/.css  Idle controller, overlay, tab
renewal-service/bnr.js        LS2 method bnrRates
tests/info/*.cjs              tests; tests/info/fixtures/ recorded responses
```

Modified: `launcher/index.html`, `launcher/app.js`, `launcher/theme-runtime.js`, `launcher/settings-categories.js`, `launcher/renewal-panel.js`, `renewal-service/service.js`, `scripts/home_assets.py`, `scripts/build-cytv.py` (only if it lists service files explicitly), `package.json`, `scripts/test.sh`, `MR-REDIFY.md`.

---

### Task 0: Romanian language

**Files:**
- Modify: `launcher/i18n.js` (language list line ~14), `launcher/catalogs.js`, `launcher/theme-locales.js`, `launcher/wallpaper-locales.js`, `launcher/weather-locales.js`, `launcher/settings-categories.js` (the `labels` map near line 4), `launcher/i18n.css` only if a font rule is needed (Romanian is Latin script: expected none)
- Create: `launcher/info-locales.js` (empty `HomeI18n.add({ en: {}, ro: {} })`), `tests/info/ro-locale.cjs`
- Modify: `launcher/index.html`, `scripts/home_assets.py`
- Create `docs/i18n/ro.md` only if `tests/i18n/*.cjs` or `scripts/ci-scope.py` requires one document per language

**Interfaces:**
- Produces: language code `ro` (name `Română`) selectable in Settings > Language and chosen by "Automatic (system language)" for `ro`/`ro-RO`; `info-locales.js` is the single place later tasks add `en`/`ro` pairs.

- [ ] **Step 1: Write failing tests** `tests/info/ro-locale.cjs`:
  - `ro is in the language list and normalize('ro-RO') returns 'ro'`
  - `every English key in catalogs.js, theme-locales.js, wallpaper-locales.js and weather-locales.js has a ro value` (same key sets as `en`, read from the files)
  - `ro values keep the {placeholders} of their English source`
  - `HomeI18n.t('Settings') returns the Romanian text when ro is active`
- [ ] **Step 2:** Run `node tests/info/ro-locale.cjs`. Expected: FAIL.
- [ ] **Step 3:** Add `{ code: 'ro', name: 'Română' }` to the language list, add a `'ro'` block in every locale file next to the other languages (translate each string; keep product names and technical terms such as Developer Mode, Wi-Fi, HDMI, Home Helper, webOS in their original form), add `ro` labels for the two special labels in `settings-categories.js`.
- [ ] **Step 4:** Run `node tests/info/ro-locale.cjs && for f in tests/i18n/*.cjs; do node $f; done && npm run lint:compat`. Expected: PASS. Ask the owner to skim 15 translated strings (menus and settings) before committing.
- [ ] **Step 5:** Commit `feat(i18n): add Romanian language`.

### Task 1: Scope signal and settings store

**Files:**
- Create: `launcher/info-store.js`, `tests/info/store.cjs`
- Modify: `launcher/theme-runtime.js` (dispatch an event after the `ctv-mr-redify` class is set/cleared in `apply` and `reset`), `launcher/index.html` (script right after `weather.js`), `scripts/home_assets.py` (add `INFO_FILES` list to `THEME_FILES`), `package.json` (`test:info`), `scripts/test.sh` (run `npm run test:info` next to `test:weather`)

**Interfaces:**
- Produces: `window.HomeInfo` with
  - `isMrRedify(): boolean` (reads `#homeSurface.ctv-mr-redify`)
  - `onScopeChange(cb: (active: boolean) => void): void` (fired by the DOM event `ctv-scope`, created with `document.createEvent('Event')`, not `CustomEvent`)
  - `createStore(key: string, defaults: object, sanitize: (raw: object) => object): { get(): object, set(patch: object): object, reset(): object }`

- [ ] **Step 1: Write failing tests** in `tests/info/store.cjs` (load the file in `node:vm` with stub `window`, `document`, `localStorage`):
  - `get() returns defaults on empty storage`
  - `set merges patch and runs sanitize` (sanitize rejects `timeoutMin: 7`, keeps the previous value)
  - `corrupt JSON resets to defaults without throwing`
  - `throwing localStorage does not throw and get() returns defaults`
  - `onScopeChange callback receives true then false when the ctv-scope event fires after the surface class changes`
- [ ] **Step 2:** Run `node tests/info/store.cjs`. Expected: FAIL (file missing).
- [ ] **Step 3:** Implement `launcher/info-store.js`. Wrap every storage access in try/catch. In `theme-runtime.js` dispatch `ctv-scope` from `document` after toggling the class (no dependency on load order: `info-store.js` only listens).
- [ ] **Step 4:** Add `test:info` to `package.json`, call it from `scripts/test.sh`, add `INFO_FILES` to `home_assets.py`. Run `node tests/info/store.cjs && npm run lint:compat`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(info): scope signal and settings store`.

### Task 2: Cache and HTTP helper

**Files:**
- Create: `launcher/info-fetch.js`, `tests/info/fetch.cjs`
- Modify: `launcher/index.html`, `scripts/home_assets.py`

**Interfaces:**
- Consumes: `HomeInfo.createStore` is not required; uses `localStorage` directly under `tvhome.cache.v1.<key>`.
- Produces: `window.HomeInfoFetch` with
  - `http(url: string, opts?: { timeoutMs?: number }): Promise<string>` (XHR GET, default 12000 ms, one retry on network error)
  - `cached(key: string, ttlMs: number, loader: () => Promise<any>, opts?: { now?: () => number }): Promise<{ value: any, fetchedAt: number, stale: boolean }>`

- [ ] **Step 1: Write failing tests** with a fake clock and fake loader:
  - `fresh cache returns without calling loader`
  - `expired cache calls loader and stores the new value`
  - `loader failure with a cached value resolves stale:true`
  - `loader failure without cache rejects`
  - `two concurrent calls for the same key call loader once`
- [ ] **Step 2:** Run `node tests/info/fetch.cjs`. Expected: FAIL.
- [ ] **Step 3:** Implement. Concurrent calls share one in-flight promise per key.
- [ ] **Step 4:** Run `node tests/info/fetch.cjs && npm run lint:compat`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(info): cache and http helper`.

### Task 3: Settings tab infrastructure

**Files:**
- Create: `tests/info/harness.cjs`, `tests/info/tabs-ui.cjs`
- Modify: `launcher/info-store.js` (add `registerTab`/`tabs`), `launcher/settings-categories.js`, `launcher/renewal-panel.js` (groups built around line 775-822), `scripts/test.sh`/`package.json` (`test:info:browser`)

**Interfaces:**
- Produces:
  - `HomeInfo.registerTab(spec: { id: 'idle'|'daily'|'calendar'|'football', label: string, build: (pane: HTMLElement) => void }): void` and `HomeInfo.tabs(): spec[]` in registration order
  - `SettingsCategories.attach(...)` now returns a view with `setGroupVisible(id: string, visible: boolean): void`; hidden tabs are skipped by arrow/Tab navigation; if the selected tab becomes hidden, tab 0 is selected
  - Test harness `openHome(opts: { mrRedify: boolean }): Promise<{ page, setScope(on: boolean): Promise<void>, close(): Promise<void> }>`; copy the preview build + compile prologue from `tests/weather/ui.cjs`; `setScope` toggles the class and dispatches `ctv-scope`

- [ ] **Step 1: Write failing UI test** `tests/info/tabs-ui.cjs`:
  - with mr.redify on: tabs `[data-category=idle]`, `daily`, `calendar`, `football` exist, visible, and reachable by ArrowDown
  - after `setScope(false)`: the four tabs are not visible and ArrowDown through the tab list never focuses them
  - when `calendar` is the selected tab and scope turns off, tab 0 becomes selected
  - the existing Appearance/Themes/Wallpapers tabs behave as before in both scopes
- [ ] **Step 2:** Run `node tests/info/tabs-ui.cjs`. Expected: FAIL.
- [ ] **Step 3:** Implement. In `renewal-panel.js` append one group per `HomeInfo.tabs()` entry (empty content div filled by `build`). Add icon paths for the new ids (simple 24x24 paths) with a fallback so an unknown id never throws. Subscribe `onScopeChange` and call `setGroupVisible` for the four ids; apply the current scope once at attach. Register temporary empty tabs from `tests/info/harness.cjs` only if the feature modules are not loaded yet.
- [ ] **Step 4:** Run `node tests/info/tabs-ui.cjs && node tests/info/store.cjs && npm run lint:compat`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(info): scoped settings tabs`.

### Task 4: Romanian calendar data (pure)

**Files:**
- Create: `launcher/ro-calendar-data.js`, `tests/info/ro-calendar.cjs`
- Modify: `launcher/index.html`, `scripts/home_assets.py`

**Interfaces:**
- Produces: `window.HomeRoCalendar` with
  - `orthodoxEaster(year: number): { month: number, day: number } | null` (null outside 1900-2099)
  - `holidays(year: number): Array<{ month: number, day: number, name: string }>` sorted by date
  - `holidayNames(year: number, month: number, day: number): string[]`
  - `nameDays(year: number, month: number, day: number): string[]` (fixed table plus Easter-relative entries; `[]` outside 1900-2099)

- [ ] **Step 1: Verify sources (owner gate).** Fetch the official list of legal holidays (Codul muncii art. 139 and later amendments, for example 25 October) and reconcile it with the spec list; write the source URL and date in the file header. Build the name day table from a primary source (Orthodox calendar). Show the owner 10 sample dates (including Florii and Rusalii) and wait for confirmation before committing the table.
- [ ] **Step 2: Write failing tests:**
  - `orthodoxEaster`: 2024 -> 5 May, 2025 -> 20 Apr, 2026 -> 12 Apr, 2027 -> 2 May; 1899 and 2100 -> `null`
  - `holidays(2026)` equals the verified list with exact dates (Vinerea Mare 10 Apr, Paște 12-13 Apr, Rusalii 31 May and 1 Jun, 6-7 Jan included)
  - `holidayNames(2026, 6, 1)` contains both `Rusalii` (Monday) and Children's Day text
  - `nameDays(2026, 4, 12)` contains no crash and returns an array; Easter-relative entries move with the year
  - every month/day of a leap year returns an array (no exception for 29 Feb)
- [ ] **Step 3:** Run `node tests/info/ro-calendar.cjs`. Expected: FAIL.
- [ ] **Step 4:** Implement: Julian computus plus 13 days for 1900-2099; static table keyed `MM-DD`; holiday names in Romanian.
- [ ] **Step 5:** Run `node tests/info/ro-calendar.cjs && npm run lint:compat`. Expected: PASS. Commit `feat(info): romanian holidays and name days data`.

### Task 5: Info panel and header button

**Files:**
- Create: `launcher/info-panel.js`, `launcher/info-panel.css`, `tests/info/panel-ui.cjs`
- Modify: `launcher/index.html` (new pill `#btnInfo` as the last child of `#topButtons`, plus `#infoPanel`), `launcher/app.js` (`topButtons` array near line 140, `activateTopButton` near line 2324, `focusTopButton`, `nearestTopButton`, header key handling, and the places that ignore Home keys while `RenewalPanel.isOpen()` at lines ~960 and ~2475), `scripts/home_assets.py`

**Interfaces:**
- Consumes: `HomeInfo.isMrRedify`, `HomeInfo.onScopeChange`
- Produces: `window.InfoPanel` with `registerPage(spec: { id: string, label: string, render: (container: HTMLElement) => void, onShow?: () => void, onHide?: () => void }): void`, `open(): void`, `close(): void`, `isOpen(): boolean`. The button is `hidden` unless the scope is active; `activateTopButton(3)` opens the panel.

- [ ] **Step 1: Write failing UI test** `tests/info/panel-ui.cjs`:
  - mr.redify on: `#btnInfo` visible and shows no text (existing icon-only CSS applies); OK opens the panel; Right/Left switch pages; Back closes and focus returns to `#btnInfo`; Back does not exit Home
  - mr.redify off: `#btnInfo` hidden; focus never lands on it by arrow keys from Settings
  - `setScope(false)` while the panel is open closes it
- [ ] **Step 2:** Run `node tests/info/panel-ui.cjs`. Expected: FAIL.
- [ ] **Step 3:** Implement. Header navigation must skip hidden buttons (today only index 0 is special-cased). Page pages are registered by Tasks 6-8.
- [ ] **Step 4:** Run `node tests/info/panel-ui.cjs && node tests/info/tabs-ui.cjs && npm run test:themes:browser` (existing header/focus tests must still pass). Expected: PASS.
- [ ] **Step 5:** Commit `feat(info): info panel with header button`.

### Task 6: Calendar page, Calendar tab and daily store

**Files:**
- Create: `launcher/calendar-page.js`, `launcher/calendar-page.css`, `tests/info/calendar.cjs`, `tests/info/calendar-ui.cjs`
- Modify: `launcher/index.html`, `scripts/home_assets.py`

**Interfaces:**
- Consumes: `HomeRoCalendar`, `HomeInfo.createStore`, `HomeInfo.registerTab`, `InfoPanel.registerPage`
- Produces:
  - `HomeInfo.daily` store, key `tvhome.daily.v1`, defaults `{ showHolidays: true, showNameDays: true }` (UI controls are built in Task 7)
  - calendar store `tvhome.calendar.v1`: `{ weekStart: 'mon'|'sun', weekNumbers: boolean, events: Array<{ id: string, day: number, month: number, title: string, yearly: boolean }> }`, defaults `{ 'mon', false, [] }`; sanitize drops invalid items and truncates to 50
  - `HomeCalendar.monthGrid(year: number, month: number, weekStart: 'mon'|'sun'): Array<Array<{ year: number, month: number, day: number, inMonth: boolean }>>`

- [ ] **Step 1: Write failing tests:**
  - `monthGrid(2026, 11, 'mon')` has 6 or fewer rows, first cell is Monday 26 Oct, rows have 7 cells
  - sanitize: 60 events -> 50; event with `month: 13` dropped; `events` not an array -> `[]`
  - UI: calendar page shows today highlighted, holiday cells marked (Easter 2026 on 12 Apr), selected day shows holiday, name day and own events; arrows change month; adding an event through the Calendar tab shows it on the grid
- [ ] **Step 2:** Run both tests. Expected: FAIL.
- [ ] **Step 3:** Implement; read the device date once per render, wrap holiday/name day lookups so a bad date renders an empty month, not an error.
- [ ] **Step 4:** Run `node tests/info/calendar.cjs && node tests/info/calendar-ui.cjs && npm run lint:compat`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(info): calendar page and tab`.

### Task 7: BNR service, rates page and "Rates & holidays" tab

**Files:**
- Create: `renewal-service/bnr.js`, `launcher/finance.js`, `launcher/finance.css`, `tests/info/bnr-service.cjs`, `tests/info/finance.cjs`, `tests/info/finance-ui.cjs`, `tests/info/fixtures/nbrfxrates.xml`
- Modify: `renewal-service/service.js` (register next to `require('./weather')`, near line 235), `scripts/build-cytv.py` (only if the service files are listed explicitly near line 27), `launcher/index.html`, `scripts/home_assets.py`

**Interfaces:**
- Produces:
  - LS2 method `bnrRates` on `com.gathin.tvhome.renewal`: payload `{ id }` only, caller must be the Home app, response `{ returnValue: true, xml: string }` or `{ returnValue: false, errorCode }` with codes `bnr-timeout`, `bnr-network-error`, `bnr-http-status`, `bnr-response-too-large` (limit 262144 bytes), `bnr-invalid-response`
  - `HomeInfoFinance.parse(xml: string): { date: string, rates: { [code: string]: { value: number, multiplier: number } } }` (throws on invalid XML)
  - finance store `tvhome.finance.v1`: `{ currencies: string[], current: object|null, previous: object|null }`, defaults EUR, USD, GBP, CHF; sanitize keeps 1 to 8 three-letter uppercase codes
  - the "Rates & holidays" tab (`id: 'daily'`) with toggles for `HomeInfo.daily` and currency choice from the cached rates

- [ ] **Step 1:** Save today's real response: `curl -s -A "Mozilla/5.0" https://curs.bnr.ro/nbrfxrates.xml > tests/info/fixtures/nbrfxrates.xml`.
- [ ] **Step 2: Write failing tests:**
  - service (follow `tests/weather/service.cjs`): fixed host `curs.bnr.ro` and path `/nbrfxrates.xml`; caller not Home -> `caller-not-authorized`; payload with extra keys -> `invalid-request`; non-200 -> `bnr-http-status`; body over limit -> `bnr-response-too-large`; non-XML body -> `bnr-invalid-response`
  - `parse(fixture)`: `date` equals the fixture's `PublishingDate`; `rates.EUR.value` equals the fixture's EUR text as a number; HUF has `multiplier: 100`
  - rotation: when the fetched date differs from `current.date`, `previous` becomes the old `current`; same date keeps `previous`
  - UI: shows chosen currencies with the date; a missing service shows "service update required"; cached values shown with "last updated" when offline
- [ ] **Step 3:** Run the three tests. Expected: FAIL.
- [ ] **Step 4:** Implement `bnr.js` after `renewal-service/weather.js` (same request, timeout 12000 ms, bundled CA file, legacy Node compatible); `finance.js` calls `luna://<service>/bnrRates` the way `launcher/weather-transport.js` does (service name differs when `ROOT_VERSION` is set: Root has no `bnrRates`, show the message); cache with `HomeInfoFetch.cached('bnr', 3 hours, ...)`.
- [ ] **Step 5:** Run `node tests/info/bnr-service.cjs && node tests/info/finance.cjs && node tests/info/finance-ui.cjs && for f in renewal-service/*.js launcher/*.js; do node --check $f; done && npm run lint:compat`. Expected: PASS. Commit `feat(info): BNR rates, service method and rates tab`.

### Task 8: Football

**Files:**
- Create: `launcher/football-espn.js`, `launcher/football.js`, `launcher/football.css`, `tests/info/football.cjs`, `tests/info/football-ui.cjs`, `tests/info/fixtures/espn-*.json`
- Modify: `launcher/index.html`, `scripts/home_assets.py`

**Interfaces:**
- Produces:
  - `FootballEspn` (only file that knows ESPN URLs): `competitions: Array<{ id: string, name: string }>` = `eng.1, esp.1, ita.1, ger.1, fra.1, rou.1, uefa.champions, uefa.europa`; `scoreboard(competitionId: string): Promise<Match[]>`; `teams(competitionId: string): Promise<Array<{ id: string, name: string }>>`; `teamMatches(competitionId: string, teamId: string): Promise<Match[]>`
  - `Match`: `{ id: string, competition: string, home: { id: string, name: string, score: number|null }, away: { id: string, name: string, score: number|null }, start: string /* ISO */, state: 'pre'|'in'|'post', clock: string }`
  - `HomeFootball.teamStatus(matches: Match[], teamId: string, nowIso: string): { next: Match|null, last: Match|null, live: Match|null }`
  - football store `tvhome.football.v1`: `{ competitions: string[], teams: Array<{ competition: string, id: string, name: string }> }`; sanitize keeps known competition ids and at most 5 teams

- [ ] **Step 1:** Verify the endpoints with `curl` (scoreboard exists; confirm the teams list and team schedule URLs) and save trimmed responses as `tests/info/fixtures/espn-scoreboard.json`, `espn-teams.json`, `espn-schedule.json`.
- [ ] **Step 2: Write failing tests:**
  - normalisation of each fixture into `Match`/team lists; a payload missing fields or with a different shape yields `[]` and no exception
  - `teamStatus` picks the next, last and live match by `state` and `start`
  - sanitize: 6 teams -> 5; unknown competition id dropped
  - UI: teams chosen from the lists of ticked competitions, page shows next match, last result, live score; competitions page lists the day's matches with no standings; offline shows cached values and "last updated"
  - refresh timing: 60 s only while a followed team is live, hourly otherwise, none when scope is off
- [ ] **Step 3:** Run the tests. Expected: FAIL.
- [ ] **Step 4:** Implement with `HomeInfoFetch.http` and `cached`.
- [ ] **Step 5:** Run `node tests/info/football.cjs && node tests/info/football-ui.cjs && npm run lint:compat`. Expected: PASS. Commit `feat(info): football page and tab`.

### Task 9: Idle screen

**Files:**
- Create: `launcher/idle-screen.js`, `launcher/idle-screen.css`, `tests/info/idle.cjs`, `tests/info/idle-ui.cjs`
- Modify: `launcher/index.html` (overlay element), `launcher/weather.js` (only if no accessor for current conditions exists: add `HomeWeather.snapshot(): { temp: number, unit: string, label: string, icon: string } | null`), `scripts/home_assets.py`

**Interfaces:**
- Consumes: `HomeInfo.isMrRedify/onScopeChange/createStore/registerTab`, `HomeInfo.daily`, `HomeRoCalendar`, finance and football stores, `RenewalPanel.isOpen()`, `InfoPanel.isOpen()`
- Produces:
  - idle store `tvhome.idle.v1`: `{ style: 'clock'|'panel', timeoutMin: 0|5|10|30, dim: number /* 0-100 */, seconds: boolean, blocks: { date: boolean, rates: boolean, football: boolean } }`, defaults `{ 'clock', 10, 60, false, { true, false, false } }`
  - `createIdleController(opts: { timeoutMs: number, onIdle: () => void, onWake: () => void, now: () => number, schedule: (fn: () => void, ms: number) => number, cancel: (id: number) => void }): { activity(): void, start(): void, stop(): void, isIdle(): boolean }`

- [ ] **Step 1: Owner gate (TV probe).** Prepare a small build that logs key and pointer events during inactivity; **ask the owner before installing it on the TV**, and record the result in the spec risk section. If Home gets no events before the LG screensaver, change the plan with the owner.
- [ ] **Step 2: Write failing tests:**
  - controller: idle fires once after `timeoutMs` without `activity()`; `activity()` before the timeout restarts it; `stop()` cancels; `timeoutMin: 0` never starts
  - sanitize: `timeoutMin: "abc"` -> default 10; `dim: 400` -> clamped to 100
  - UI: overlay shows after the timeout with the clock in the style chosen; any key closes it and does not trigger anything underneath (a focused tile is not launched); not shown while Settings or the info panel is open; `setScope(false)` stops the timer and closes the overlay; content shifts at least once per minute; `panel` style omits a block whose data is missing
- [ ] **Step 3:** Run the tests. Expected: FAIL.
- [ ] **Step 4:** Implement: capture-phase listeners that consume the waking input, dim via an overlay opacity from `dim`, a deterministic pixel-shift cycle of a few pixels each minute, and a note in the tab about the LG screensaver with a button that opens the LG screensaver setting if an existing helper for opening TV settings is available (see `openNetworkSettings` in `launcher/app.js` for the pattern).
- [ ] **Step 5:** Run `node tests/info/idle.cjs && node tests/info/idle-ui.cjs && npm run lint:compat`. Expected: PASS. Commit `feat(info): idle screen`.

### Task 10: Integration, docs and preview

**Files:**
- Modify: `MR-REDIFY.md` (what the four features do, settings, BNR needs `./install.sh`), `tests/setup/test_ci_scope.py` and `scripts/ci-scope.py` only if the full suite reports new files as unrouted, `package.json`/`scripts/test.sh` for any missing test wiring

- [ ] **Step 1:** Run `npm run test:info && npm run test:info:browser && npm run lint:compat && npm run test:themes && npm run test:themes:browser && bash scripts/test.sh`. Expected: PASS everywhere. Fix routing failures in the CI scope files and rerun.
- [ ] **Step 2:** Rebuild and restart the preview on `http://127.0.0.1:8766`: re-export the runtime with `scripts/export-theme-runtime.py --allow-dirty` into the toolkit as done for earlier theme work; check the four tabs, the header button, the three pages and the idle overlay with the mr.redify theme, and check that Classic shows none of them.
- [ ] **Step 3:** Update `MR-REDIFY.md`; commit `docs: describe info features`. Do not push; report to the owner and ask before any install on the TV or push.

### Task 11 (deferred, owner decision): Live TV preview feasibility spike

Done last, after Task 10 and only on the owner's go-ahead. Output is an answer, not shipped code.

- [ ] **Step 1:** Ask the owner for approval to install a small test build on the TV (and to extend Developer Mode first if needed).
- [ ] **Step 2:** Test build tries the tuner in a `<video>` (candidate source types for the broadcast plane) with sound, releasing it with the release order used in `launcher/input-preview.js`; log what webOS allows and whether sound persists after leaving Home.
- [ ] **Step 3:** Record the result in the spec. If it works, write a follow-up plan (preview on focus of the Live TV tile, mute policy, themes without shelf); if not, document why and stop.

---

## Self-Review notes

- Spec coverage: scope (T1, T3, T5, T9), idle (T9), holidays/name days (T4, T6, T7 toggles), BNR (T7), calendar and events (T6), football (T8), caching and failure (T2 plus each page), testing and preview (T10). Info panel pages are registered in T6-T8.
- Spec correction found while planning: the fixed-holiday list lacked 6-7 January; fixed in the spec and verified in T4 Step 1.
- Type consistency: `HomeInfo.createStore`, `registerTab`, `InfoPanel.registerPage`, `HomeInfo.daily` are defined in T1, T3, T5, T6 and only consumed later.
