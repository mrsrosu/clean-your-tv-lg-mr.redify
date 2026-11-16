# Home info features: idle screen, calendar, exchange rate, football

Date: 2026-11-16. Status: draft for review. Branch: `features` (local, not pushed).

## Purpose

Add four user-configurable features to the mr.redify Home fork (active only with the
mr.redify theme, see "Scoping"), each with its own
tab in **Settings**, so that anyone who installs this fork gets what the owner has:

1. **Idle screen** (Ecran de repaus), started by Home after inactivity.
2. **Exchange rate, holidays and name days** (Curs valutar, sărbători, onomastici).
3. **Calendar** (monthly view, personal events).
4. **Football** (teams and competitions).

Target TV: LG OLED55C22LB, webOS 26, No-root edition (Home `com.gathin.tvhome`,
Home Helper service `com.gathin.tvhome.renewal`). Language of the UI follows the
existing Home i18n; Romanian content (holidays, name days) is Romanian only.

## Decisions taken with the owner

| Topic | Decision |
| --- | --- |
| Idle styles | User picks in Settings: **Big clock + date + weather**, or **Info panel**. |
| Idle timeout | Off / 5 / 10 / 30 minutes, default 10. |
| Holidays, name days | **Romania only**, bundled in Home, work offline. |
| Calendar | Monthly calendar with holidays and **own events**, local to the TV. No Google Calendar. |
| Exchange rate | **BNR official rate**, through a new endpoint in the Home Helper service. |
| Football | **Both** favourite teams (1 to 5) and competitions. **No standings.** Source: ESPN public endpoints. |
| Where it is viewed | One new header button (calendar icon) opens a **full-screen panel with three pages**: Calendar, Exchange rate, Football (left/right to switch). |
| Distribution | Public fork `mrsrosu/clean-your-tv-lg-mr.redify`. The theme repo `cytv-themes-mr-redify` stays as is. |
| Scope | **Only the mr.redify theme** (owner decision, 2026-11-16). Other themes behave exactly as upstream. |

Assumption to confirm in review (not yet answered by the owner):
- Info panel blocks default to on for date/name day, off for exchange rate and football
  until the user enables them.

## Scoping to the mr.redify theme

All four features are active only while the mr.redify theme is the active theme, using
the mechanism already in the fork: `ThemeRuntime.apply/reset` in
`launcher/theme-runtime.js` toggles the class `ctv-mr-redify` on `#homeSurface` for the
theme IDs `github:mrsrosu/cytv-themes-mr-redify:mr-redify` and
`github:local/my-themes:mr-redify`. The new code reads the same signal (one shared
helper, for example `isMrRedify()`, as already used in `launcher/weather.js`).

When another theme is active:
- the four Settings tabs are not shown;
- the header calendar button is not shown;
- the idle screen does not start (the timer is stopped, not just hidden);
- no background requests are made (BNR, ESPN).

Saved settings, own events and favourite teams are kept when the user switches theme,
and become active again when mr.redify is selected. Switching theme while the info
panel or idle screen is open closes it first. Tests cover both states (mr.redify and
another theme such as Classic).

## Architecture

One module per feature, each registering its own Settings tab through
`SettingsCategories.attach` (the mechanism used by Appearance, Themes, Wallpapers in
`launcher/renewal-panel.js`). A failing module must not break the others.

```
launcher/
  info-store.js         settings per module in localStorage, versioned keys
                        (tvhome.idle.v1, tvhome.calendar.v1, tvhome.finance.v1, tvhome.football.v1),
                        defaults + validation; a corrupt value resets that module to defaults
  info-fetch.js         shared request helper: timeout, one retry, cache with expiry,
                        "last good value" fallback, never blocks the UI
  ro-calendar-data.js   pure logic: Orthodox Easter, legal holidays, name days (no I/O)
  idle-screen.js        inactivity detection, overlay, two styles, OLED protection
  info-panel.js         full-screen panel with three pages, opened from the header button
  calendar-page.js      monthly grid + own events
  finance.js            BNR rates (page + settings)
  football.js           ESPN provider + teams/competitions (page + settings)
renewal-service/
  bnr.js                new LS2 method `bnrRates` (fixed host, see below)
```

Existing weather data is reused by the idle screen and is not duplicated.

Compatibility: the code must pass `npm run lint:compat` (`scripts/check-tv-web.cjs`),
the TV web engine is older than desktop Chrome.

## Feature 1: idle screen

- **Start:** after N minutes without a key, pointer or wheel event while Home is the
  foreground app. Never while Settings or the info panel is open.
- **Stop:** any key or pointer movement closes it. That input **only wakes** the screen
  and is not forwarded to Home underneath (no accidental app launch).
- **Style "Big clock":** theme wallpaper darkened, large clock (12/24 h follows
  `HomeI18n.clockFormat()`), date, current weather from the existing weather module.
- **Style "Info panel":** smaller clock plus blocks the user toggles individually:
  date with holiday or name day, exchange rate, football. A block without data is
  omitted (no error text on the idle screen).
- **OLED protection:** content shifts a few pixels every minute and the overlay is
  dimmed to a configurable level.
- **Settings tab:** style, timeout, dim level, seconds on/off, which info blocks.
  Includes a note that the LG system screensaver is separate and runs only outside
  Home, so the LG timeout must be longer than ours or turned off.
- **First task of the implementation:** a probe on the TV to confirm that Home receives
  input events during inactivity before the LG screensaver starts (unverified today).

## Feature 2: exchange rate, holidays, name days

### Holidays and name days (offline)
- Fixed legal holidays: 1-2 Jan, 6-7 Jan, 24 Jan, 1 May, 1 Jun, 15 Aug, 30 Nov,
  1 Dec, 25-26 Dec (6-7 Jan added after review; the whole list is still subject to the
  verification below). Movable: Good Friday, Orthodox Easter Sunday and Monday, Pentecost Sunday
  and Monday, computed with the Orthodox Easter algorithm for any year.
- **To verify before bundling:** the list of legal holidays against the official source
  (the list changed in recent years, for example 25 October), and a sample of the
  name day table shown to the owner for confirmation.
- Name days: table by date; movable ones (Florii and similar) computed from Easter.
- Settings: show holidays on/off, show name days on/off. Used by the calendar and the
  idle info panel.

### Exchange rate (BNR)
- Source: `https://curs.bnr.ro/nbrfxrates.xml` (verified 2026-11-16: HTTP 200, XML,
  certificate accepted by the service CA bundle). `www.bnr.ro/nbrfxrates.xml` redirects
  to the home page and must not be used.
- New method `bnrRates` in the Home Helper service, same pattern as `weather.js`:
  the caller sends no destination; host and path are fixed; size limit; timeout;
  caller must be the Home app; legacy Node compatible; bundled CA file.
- The page parses the XML (rates in RON, `multiplier` attribute, for example HUF per
  100 units), shows the chosen currencies (default EUR, USD, GBP, CHF) and the
  publication date.
- Refresh on start and every few hours; BNR publishes on working days around noon.
- Up/down arrow compares with the previous published rate stored locally, so it appears
  from the second day on.
- Settings: choice of currencies from the rates BNR publishes.
- **Rollout:** the new service method reaches the TV only through `./install.sh`
  (reinstall of the Home Helper). Until then, or in the Root edition (different
  service name), the page shows a clear "service update required" message.

## Feature 3: calendar

- Monthly grid, today highlighted, holidays and own events marked, arrows move by
  month, optional week numbers. The selected day shows the holiday, name day and
  events.
- Settings: first day of week (default Monday), week numbers, what is marked.
- Own events: day, month, title, "every year" yes/no. Maximum 50. Entered with the TV
  on-screen keyboard. Stored locally only.

## Feature 4: football

- Provider: ESPN public site API (`site.api.espn.com`), no key, CORS open. Not an
  official API, so it is isolated in one provider file and replaceable.
- Competitions verified on 2026-11-16: Premier League, La Liga, Serie A, Bundesliga,
  Ligue 1, Champions League, Europa League, Liga 1 Romania (matches and results).
- **Teams (1 to 5):** picked from lists of the ticked competitions, no typing. The page
  shows the next match, the last result, and the live score during a match.
- **Competitions:** matches of the day for the ticked competitions. No standings.
- Refresh hourly; every 60 seconds only while a followed team has a live match.
- Failure: last cached values plus "last updated at" and a short message.

## Settings, errors, privacy

- All settings are local (`localStorage`), nothing personal leaves the TV. External
  requests carry only the public query (competition id, no user identifiers).
- Every network failure degrades to cached data or a short message; no feature may
  block Home start-up or key handling.
- Own events and favourite teams are stored only on the TV.

## Testing and preview

- Pure logic (Easter, holidays, name days, BNR XML parsing, idle timer, event storage,
  settings validation) gets Node tests in `tests/`, following the existing `tests/*.cjs`
  pattern, plus the existing `npm run lint:compat`.
- UI is previewed locally on `http://127.0.0.1:8766` (runtime exported with
  `scripts/export-theme-runtime.py --allow-dirty`), as for the earlier theme work.
- Network data in the preview uses recorded responses plus a live check.
- On-TV checks happen only after the owner approves installing the build.

## Out of scope (first version)

Other countries or languages for holidays and name days, Google Calendar, event sync
with a phone, football standings, Liga 1 standings, BNR in the Root edition,
notifications or alarms.

## Risks

- ESPN is unofficial and may change; mitigated by the isolated provider and fallback.
- Idle events during the LG screensaver window are unverified (first task).
- The service change needs a Home Helper reinstall on every TV that wants BNR.
- Public fork: the `Authored-By` commit trailer includes the owner's email address;
  decide before the first push whether to keep it.
