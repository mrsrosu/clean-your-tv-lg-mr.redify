# mr.redify edition

A small fork of [Clean Your TV for LG webOS](https://github.com/Razdva122/clean-your-tv-lg-webos) (MIT, see `LICENSE`) that adds layout tweaks for the **mr.redify** theme. Everything else is the upstream project. The tweaks apply **only while the mr.redify theme is selected**; with any other theme Home behaves as upstream.

## What changes with mr.redify selected

- The Inputs, Wi-Fi and Settings header buttons show only their icon (no text, square buttons).
- The focused app's name is shown on the right instead of the left.
- Weather (Settings → Weather) is placed on the left, under the clock, in every format.
- The forecast format shows **3 days** instead of 4 (labelled "3 days").

## Info features

These appear **only while mr.redify is selected**; Classic and every other theme show none of them. Settings has four new tabs (visible with mr.redify): **Idle screen**, **Rates & holidays**, **Calendar** and **Football**.

- **Idle screen**: after a period without input Home shows a full-screen overlay: big clock with date and weather, or an info panel. The first control of the Idle screen tab is the **Idle screen** ON/OFF switch (ON starts it after the saved timeout, OFF never starts it); below it you choose the style and the timeout (5, 10 or 30 minutes; default 10). The image is dimmed and moves slowly to protect OLED panels; any key closes it. It never starts while Settings is open or while another app is in front, and an info page left open past the timeout is closed first.
- **Calendar**: month view with Romanian public holidays (including the movable Orthodox Easter dates) and name days, plus your own events, stored on the TV.
- **Exchange rates**: official BNR (National Bank of Romania) rates for the currencies you pick in Rates & holidays.
- **Football**: fixtures, results and live scores (no standings) for the leagues and teams you follow, taken from ESPN (Romanian Liga 1 from TheSportsDB).
- **Main-page cards**: the first control of the Calendar, Rates & holidays and Football tabs is **Show on main page** (OFF by default). Each ON card appears on the Home screen, on the right under the header buttons, as a small glass card: Calendar (today's date, holiday, name days, your next event within 7 days), Rates (your currencies and the BNR date) and Football (live score, else next match, else last result of the teams you follow, up to 3). A card with no data is left out. Cards are not focusable, so remote navigation is unchanged. Only the cards that fit above the focused app's name are shown (the last ones are dropped), and they hide while the grid is scrolled or edited, while Settings, the info panel or the idle screen is open. With every toggle OFF nothing runs; with any ON, data refreshes at most once an hour while Home is in front.
- **Team logos**: football lists show the club logo before the team name (about 24 to 40 px). Logos are loaded from the providers' own image servers (a.espncdn.com, a1.espncdn.com, www.thesportsdb.com, r2.thesportsdb.com); only those https hosts are accepted, a logo that fails to load is simply left out, and only the address (not the image) is stored. No extra request is made for Liga 1: TheSportsDB sends the badge addresses with the match data.
- **Romanian**: Romanian is added to the UI languages.

**BNR rates need the Home Helper updated.** Reinstall it with `./install.sh <TV IP>`; until then the rates page shows "service update required". The info features are not available in the Root edition (they stay off there even with mr.redify).

Data sources and limits:

- Football uses unofficial, free public sources that can change, be rate limited or disappear without notice: ESPN's endpoints for the Premier League, La Liga, Serie A, Bundesliga, Ligue 1 and the UEFA competitions, and TheSportsDB's free key for Romanian Liga 1 (ESPN's Liga 1 data was stale). The free TheSportsDB key allows only a few requests per minute, so Liga 1 updates at most about once an hour and the live score refresh is slower than for the other leagues. A Liga 1 team followed before this change is matched again by name; if that fails, pick it again in Settings.
- Exchange rates come from the public BNR XML feed and update once per banking day.
- The LG system screensaver may start before the idle screen on some TVs. If it does, lengthen or turn off the screensaver in the TV's own settings; the idle screen cannot override it.
- Nothing leaves the TV except requests for public data (BNR, ESPN, TheSportsDB, weather). Your events, picks and settings stay on the TV.

## Install

You need an LG webOS TV with Developer Mode, and a computer on the same network with Node.js 20.19+, npm, Python 3.9+ and Git.

1. On the TV, install **Developer Mode** from LG Apps, sign in with an LG Developer account, turn on **Dev Mode Status** (the TV restarts), then turn on **Key Server** and keep that screen open.
2. On the computer:

   ```sh
   git clone https://github.com/mrsrosu/clean-your-tv-lg-mr.redify
   cd clean-your-tv-lg-mr.redify
   ./install.sh <TV IPv4 address>
   ```

   The script installs build tools locally, asks for the six-character passphrase shown on the TV (type it yourself), asks you to accept a pairing request on the TV, then builds and installs Home and Home Helper.
3. On the TV, open **Settings → Themes → Add by ID**, paste `https://github.com/mrsrosu/cytv-themes-mr-redify`, choose **Load**, pick **mr.redify**, download and select it.
4. Check Home, Back and the emergency exit (press Home three times within two seconds) before daily use.

The theme itself lives in [mrsrosu/cytv-themes-mr-redify](https://github.com/mrsrosu/cytv-themes-mr-redify).

## Notes and limits

- Not an official build and not tested on every TV model or firmware. Upstream documentation (`docs/`) applies.
- Installing this replaces the Home and Home Helper packages installed by the upstream `cytv` installer. A later `cytv` update may overwrite these tweaks; rerun `./install.sh` to restore them.
- Developer Mode sessions expire; use **EXTEND** in the Developer Mode app before they do, otherwise the TV removes sideloaded apps.
- `install.sh` stores a pairing key in `.lgtv-key.json` and a list of your TV's apps in `launcher/apps.js`. Both are git-ignored; never share them.
- To go back: open `cytv`, choose **Uninstall Clean Your TV**, or press Home three times to return to LG Home.
