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
- **Calendar**: month view with Romanian public holidays (including the movable Orthodox Easter dates) and name days, plus your own events, stored on the TV. An event can be **All day** (default) or have a time: switch All day off and set the Hour (0-23) and Minute (steps of 5); the list and the day detail show it in the Home clock format (12 h or 24 h). All-day events come first, then by time.
- **Exchange rates**: official BNR (National Bank of Romania) rates for the currencies you pick in Rates & holidays, shown with 3 decimals (the stored value keeps BNR's 4; the up/down arrows compare the stored values). BNR publishes the day's rates shortly after 13:00 Romanian time on banking days (measured 13:01 on 16.11.2026), so Home asks for them only at **13:05 and 14:05 Romanian time** of a banking day (Monday to Friday, not a Romanian legal holiday; Romanian time is computed from the TV's UTC clock with the EU summer-time rule, not from the TV's timezone setting): the 13:05 request normally brings the new date and ends the day; the 14:05 request is sent only when BNR was late. A TV switched on later makes one catch-up request as soon as Home is in front. A request that gets no answer does not use up its slot: it is retried after 10 minutes, at most 3 tries per slot. No request is made at weekends, on holidays, or at any other time, and nothing runs when no part of Home is showing rates.
- **Football**: fixtures, results and live scores (no standings) for the leagues and teams you follow, taken from ESPN (Romanian Liga 1 from TheSportsDB).
- **Main-page widgets**: under the clock and date, plain text over the wallpaper like the weather block (no boxes): the **Name day** in the top row (right of the date block, on the clock's line, left of the header buttons), and three equal columns (549 px wide, same top and bottom, 24 px apart, from the left margin to the header buttons' right edge): the weather block (it starts right under the date row and, with mr.redify, takes the first column), a **month calendar** of the current month (only today is highlighted; a small dot under the days that have an own event; no holidays or week numbers; the week starts as set in the Calendar tab) and three equal sections stacked in the third column, separated by thin lines: **Exchange rates** (your chosen currencies, three per line joined with " · ", at most two lines, with the BNR date), **Events** (the next two upcoming own events over the next 12 months, for example `Today 14:30 Dentist`, `Tomorrow 09:00 Title`, `Sat 21 Nov 18:00 Title`; all-day events have no time; "No events upcoming" when there are none) and **Football** (up to two events: live matches first, then the next matches by start time, then the last result, of the teams you follow). The Name day is never empty: names celebrated today (and the holiday name under them), or "No name days today" with the next name day, for example `21 Nov: Mihail, Gavril`. The first text line of the three columns starts at the same height and the titles share the weather city's size; the body text uses the largest size (up to 34 px, like the weather) at which every section fits above the dock. The focused app's name is no longer shown with mr.redify. Each part has its own OFF-by-default toggle: the Calendar tab's **Show on main page** (month grid and Events card), the Rates & holidays tab's **Show on main page** (Exchange rates) and **Show name day on main page** (Name day), and the Football tab's **Show on main page**. A part with no data (Exchange, Football) is left out. Nothing is focusable, so remote navigation is unchanged. If the room is short, Football's second event, Football, Events and Exchange are dropped in that order, and the cards or the grid go if they would touch a wide weather block; everything hides while the grid is scrolled or edited, and while Settings, the info panel or the idle screen is open. With every toggle OFF nothing runs; with any ON, the rates schedule is checked every minute (a request only at the BNR slots above) and football refreshes at most once an hour while Home is in front.
- **Team logos**: football lists show the club logo before the team name (about 24 to 40 px). Logos are loaded from the providers' own image servers (a.espncdn.com, a1.espncdn.com, www.thesportsdb.com, r2.thesportsdb.com); only those https hosts are accepted, a logo that fails to load is simply left out, and only the address (not the image) is stored. No extra request is made for Liga 1: TheSportsDB sends the badge addresses with the match data.
- **Romania national team**: the Football tab has a **National teams** group whose only team is Romania (ESPN id 473). Tick the group, pick Romania (it counts towards the 5 followed teams) and it is shown like any team, with its logo. Its matches are read from ESPN's friendly, World Cup qualifying (UEFA), Nations League and Euro leagues (at most 5 requests per refresh, cached for an hour). If ESPN has no matches for it, the page says "No matches found". A Euro 2028 qualifiers league is not included because its ESPN identifier is not known.
- **Settings**: Up/Down in the info tabs go to the nearest row, so no control is skipped.
- **Idle screen**: nothing of Home (app name, buttons, tiles, widgets, weather) shows through it at any darkness level.
- **Romanian**: Romanian is added to the UI languages.

**BNR rates need the Home Helper updated.** Reinstall it with `./install.sh <TV IP>`; until then the rates page shows "service update required". The info features are not available in the Root edition (they stay off there even with mr.redify).

Football refresh (one scheduler for the Football page, the main-page card and the idle panel): a full refresh at most hourly while one of them is showing; a followed match that kicks off inside the coming hour wakes it at kickoff + 60 s; from kickoff to kickoff + 130 minutes (while the match is not finished) only that match's competition is asked: ESPN's scoreboard every 60 s (for the Romania national team, the scoreboard of the ESPN league the match is played in), Liga 1's one round every 120 s. Live polls never bring a provider above 10 requests a minute (ESPN) or 3 (TheSportsDB); an error silences that provider for 3 minutes (the cached data stays on screen). No consumer, scope off, hidden Home or nothing followed: no timer, no request. A whole match costs about 110 requests to ESPN (60 s) or about 55 to TheSportsDB (120 s, one round), plus the hourly refreshes. Liga 1 stays without a real-time score: the free TheSportsDB key has no live scores, so a match turns "live" only when TheSportsDB updates the round data (it can lag); a Premium key (v2 livescore, 100 requests a minute, 2-minute updates) is a possible later step and is not part of this.

Name days: the table covers every day of the year except 21 days that have no saint with a Romanian given name (feasts of the Lord such as Christmas, groups of martyrs); on those days the card says "No name days today" and gives the next name day. Source: the Romanian Orthodox calendar of the Patriarchate (https://calendar.patriarhia.ro), through the CC BY 4.0 dataset "Romanian Name Days and Holidays" by trends.ro (https://huggingface.co/datasets/radool/romanian-name-days) for the 44 days it covers (kept exactly as they are); the other days were filled on 17 November 2026 from the saint(s) of the day in the 2026 Patriarhia calendar (the saint's own name plus the usual feminine or related forms, marked "derived" in `docs/name-days-review.md`; a few days that the 2026 calendar shows as movable feasts, and 29 February, come from the menologion and are marked there too). Weak attributions (Radu, Simona, Emil, Cristian) stay out. The Florii names are computed from the date of Orthodox Easter, not stored. The name-to-saint link is a popular convention, not church doctrine. To correct a name, tell the maintainer the day and the name (or edit the day's line in `launcher/ro-calendar-data.js`, `NAME_DAYS`, keyed `MM-DD`, names with comma-below ș/ț) and re-run `npm run test:info`; `docs/name-days-review.md` lists every day month by month for review.

Data sources and limits:

- Football uses unofficial, free public sources that can change, be rate limited or disappear without notice: ESPN's endpoints for the Premier League, La Liga, Serie A, Bundesliga, Ligue 1 and the UEFA competitions, and TheSportsDB's free key for Romanian Liga 1 (ESPN's Liga 1 data was stale). The free TheSportsDB key allows only a few requests per minute, so Liga 1 updates at most about once an hour and the live score refresh is slower than for the other leagues. A Liga 1 team followed before this change is matched again by name; if that fails, pick it again in Settings.
- Exchange rates come from the public BNR XML feed and update once per banking day (requested at 13:05 and 14:05 Romanian time, see above).
- The LG screensaver also runs over Home (verified on a TV). Turn it off in the TV settings (search for Screen Saver) or set it longer than the time chosen in the Idle screen tab, otherwise it appears on top of the idle screen; the idle screen cannot override it. The idle screen only works while Home is in the foreground.
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
