# Idle screen: input events probe (for the owner, TV)

Question: while Home is in front and nobody touches anything, does Home keep getting key and pointer events, and does it
stay running until the idle timeout (10 minutes by default), or does the LG system screensaver take over first? The idle
screen only works if Home stays running and still receives the wake input.

**Outcome (owner's TV, 16 Nov 2026):** the LG screensaver also runs over Home and appears on top of the idle screen. The Settings
note therefore tells the user to turn it off in the TV settings (Screen Saver) or set it longer than the idle timeout; the idle
screen only works while Home is in the foreground.

Nothing here is installed or run by the implementation. This is a procedure for the owner to run on the TV, when they decide.

## Probe snippet

Paste in the Home page console (webOS inspector, or Chrome remote debugging on the TV), or add temporarily to `index.html`
in a local build. It only listens and logs; it changes nothing and makes no requests.

```js
(function () {
  var t0 = Date.now(), log = [];
  function line(text) {
    var s = ((Date.now() - t0) / 1000).toFixed(1) + 's ' + text;
    log.push(s);
    if (window.console) console.log('[idle-probe] ' + s);
  }
  ['keydown', 'keyup', 'mousemove', 'mousedown', 'wheel', 'pointerdown'].forEach(function (type) {
    window.addEventListener(type, function (e) {
      line(type + (e.keyCode ? ' keyCode=' + e.keyCode : ''));
    }, true);
  });
  document.addEventListener('visibilitychange', function () { line('visibility=' + document.visibilityState); });
  window.addEventListener('pagehide', function () { line('pagehide'); });
  window.addEventListener('pageshow', function () { line('pageshow'); });
  setInterval(function () { line('alive'); }, 60000); // heartbeat: shows when Home is suspended
  window.__idleProbeLog = log;
})();
```

## Procedure

1. Open Home (mr.redify theme), run the snippet, note the time. Do not touch the TV or the remote for at least 15 minutes
   (longer than the LG screensaver timeout; check it in TV settings first and write it down).
2. Each minute a line `alive` must appear. A gap means Home was suspended or the screensaver took over.
3. After the wait, move the Magic Remote pointer, then press one key. Check that `mousemove` / `keydown` lines appear and
   what `visibility` says.
4. Repeat once with the LG screensaver timeout set to Off (or longer than the idle timeout).

## What to report back

- LG screensaver timeout used, and whether `alive` lines kept coming for the whole wait.
- Whether `mousemove` and `keydown` reached Home after the wait (and whether the first key was also delivered to the screensaver).
- Any `pagehide` / `visibility=hidden` lines.

## Decision

- Events and heartbeat continue until the idle timeout: the idle screen works as built.
- Home is suspended or the screensaver wins before the idle timeout: the LG screensaver timeout must be longer than the idle
  timeout, or off (the Settings tab says so), or the plan is changed with the owner (this is the risk recorded in the spec).
