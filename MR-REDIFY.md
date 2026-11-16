# mr.redify edition

A small fork of [Clean Your TV for LG webOS](https://github.com/Razdva122/clean-your-tv-lg-webos) (MIT, see `LICENSE`) that adds layout tweaks for the **mr.redify** theme. Everything else is the upstream project. The tweaks apply **only while the mr.redify theme is selected**; with any other theme Home behaves as upstream.

## What changes with mr.redify selected

- The Inputs, Wi-Fi and Settings header buttons show only their icon (no text, square buttons).
- The focused app's name is shown on the right instead of the left.
- Weather (Settings → Weather) is placed on the left, under the clock, in every format.
- The forecast format shows **3 days** instead of 4 (labelled "3 days").

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
