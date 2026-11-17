'use strict';
const assert = require('node:assert/strict'),
  { openHome } = require('./harness.cjs');
// Idle screen, mr.redify scope. Timers and Date run on Playwright's fake clock (page.clock), so minutes pass instantly.
(async () => {
  const home = await openHome({ mrRedify: true }),
    page = home.page,
    MIN = 60000;
  await page.clock.install({ time: new Date(2026, 10, 21, 10, 0, 0) });
  await page.evaluate(() => {
    window.__realSnapshot = HomeWeather.snapshot;
  });
  const overlay = () => page.locator('#idleScreen');
  const shown = () =>
    page.evaluate(() => {
      const e = document.getElementById('idleScreen');
      return !!e && !e.hidden;
    });
  const setup = async (config, stubs) => {
    await page.evaluate(
      ({ config, stubs }) => {
        if (RenewalPanel.isOpen())
          document.getElementById('renewalClose').click();
        InfoPanel.close();
        localStorage.removeItem('tvhome.idle.v1');
        HomeInfo.idle.set(config || {});
        window.__refresh = 0;
        window.__wake = 0;
        HomeFootball.idleLines = function () {
          return stubs && stubs.football ? stubs.football : [];
        };
        HomeFootball.refresh = function () {
          window.__refresh++;
          return Promise.resolve({});
        };
        HomeInfoFinance.refreshIfDue = function () {
          window.__refresh++;
          return Promise.resolve({});
        };
        HomeWeather.snapshot = function () {
          return stubs && stubs.weather ? stubs.weather : null;
        };
        HomeIdle.reload();
      },
      { config, stubs }
    );
  };
  const content = () => page.locator('#idleScreen .idle-content');
  const text = () => overlay().innerText();
  const transform = () =>
    page.evaluate(
      () => document.querySelector('#idleScreen .idle-content').style.transform
    );

  // 1. Clock style: overlay after the timeout, with the clock, the date and the weather snapshot.
  await setup(
    { timeoutMin: 5, style: 'clock' },
    { weather: { temp: 12, unit: '°C', label: 'Clear', icon: 'clear-day' } }
  );
  assert.equal(await shown(), false, 'hidden at start');
  await page.clock.runFor(5 * MIN - 2000);
  assert.equal(await shown(), false, 'not yet');
  await page.clock.runFor(3000);
  assert.equal(await shown(), true, 'shown after 5 minutes');
  assert.match(
    await page.locator('#idleScreen .idle-clock').innerText(),
    /^\d{1,2}:\d{2}/
  );
  assert.equal(
    await page
      .locator('#idleScreen .idle-clock')
      .innerText()
      .then((s) => /\d:\d\d:\d\d/.test(s)),
    false,
    'no seconds by default'
  );
  assert.match(await page.locator('#idleScreen .idle-date').innerText(), /\d/);
  assert.match(
    await page.locator('#idleScreen .idle-weather').innerText(),
    /12/
  );
  assert.equal(
    await page.evaluate(() => window.__refresh),
    0,
    'clock style requests nothing'
  );

  // 2. Any key closes it and is consumed: Home's own key handling (it launches the selected tile on Enter) never sees it.
  await page.evaluate(() => {
    window.__keys = [];
    ['keydown', 'keyup', 'keypress'].forEach((type) =>
      window.addEventListener(type, (e) =>
        window.__keys.push(type + ':' + e.key)
      )
    );
  });
  await page.keyboard.press('Enter');
  assert.equal(await shown(), false, 'closed by a key');
  assert.deepEqual(
    await page.evaluate(() => window.__keys),
    [],
    'key did not reach Home (no tile launched)'
  );
  // The next key works normally again.
  await page.keyboard.press('ArrowRight');
  assert.deepEqual(
    (await page.evaluate(() => window.__keys)).filter((k) =>
      /^keydown/.test(k)
    ),
    ['keydown:ArrowRight'],
    'next key is not consumed'
  );

  // 3. Pointer move and click also close it; click is consumed.
  await page.clock.runFor(5 * MIN + 1000);
  assert.equal(await shown(), true);
  await page.mouse.move(300, 300);
  await page.mouse.move(320, 330);
  assert.equal(await shown(), false, 'pointer move closes');
  await page.clock.runFor(5 * MIN + 1000);
  assert.equal(await shown(), true);
  await page.evaluate(() => {
    window.__clicks = 0;
    document.addEventListener('click', () => window.__clicks++);
  });
  await page.mouse.down(); // no move first: the pointer is resting where it was
  await page.mouse.up();
  assert.equal(await shown(), false, 'click closes');
  assert.equal(await page.evaluate(() => window.__clicks), 0, 'click consumed');

  // 4. Activity resets the timer.
  await page.clock.runFor(4 * MIN);
  await page.keyboard.press('ArrowRight');
  await page.clock.runFor(4 * MIN);
  assert.equal(await shown(), false, '4 min after a key: still not idle');
  await page.clock.runFor(1 * MIN + 1000);
  assert.equal(await shown(), true);
  await page.keyboard.press('ArrowLeft');

  // 5. Not shown while Settings or the info panel is open.
  await page.evaluate(() => RenewalPanel.open());
  await page.clock.runFor(8 * MIN);
  assert.equal(await shown(), false, 'not while Settings is open');
  await page.evaluate(() => document.getElementById('renewalClose').click());
  await page.evaluate(() => InfoPanel.open());
  await page.clock.runFor(8 * MIN);
  assert.equal(await shown(), false, 'not while the info panel is open');
  await page.evaluate(() => InfoPanel.close());
  await page.clock.runFor(5 * MIN + 1000);
  assert.equal(await shown(), true, 'shown once both are closed');
  await page.keyboard.press('ArrowLeft');

  // 6. OLED shift: the content moves at least once a minute (deterministic cycle of a few pixels).
  await page.clock.runFor(5 * MIN + 1000);
  assert.equal(await shown(), true);
  const seen = [await transform()];
  for (let i = 0; i < 4; i++) {
    await page.clock.runFor(MIN);
    seen.push(await transform());
  }
  for (let i = 1; i < seen.length; i++)
    assert.notEqual(seen[i], seen[i - 1], 'minute ' + i + ' shifted');
  for (const s of seen) {
    const m = /translate\((-?\d+)px,\s*(-?\d+)px\)/.exec(s);
    assert.ok(
      m && Math.abs(+m[1]) <= 6 && Math.abs(+m[2]) <= 6,
      'a few pixels: ' + s
    );
  }
  assert.equal(
    await page.evaluate(
      () =>
        getComputedStyle(document.querySelector('#idleScreen .idle-shade'))
          .opacity
    ),
    '0.6',
    'dim 60 -> shade opacity 0.6'
  );
  await page.keyboard.press('ArrowLeft');

  // 7. Scope off: timer stopped, overlay closed, no further display; on again starts anew.
  await page.clock.runFor(5 * MIN + 1000);
  assert.equal(await shown(), true);
  await home.setScope(false);
  assert.equal(await shown(), false, 'closed with the scope off');
  assert.equal(await page.evaluate(() => HomeIdle.isRunning()), false);
  await page.clock.runFor(30 * MIN);
  assert.equal(await shown(), false, 'stays hidden');
  await home.setScope(true);
  assert.equal(await page.evaluate(() => HomeIdle.isRunning()), true);
  await page.clock.runFor(5 * MIN + 1000);
  assert.equal(await shown(), true, 'works again with the scope on');
  await page.keyboard.press('ArrowLeft');

  // 8. Timeout Off never starts.
  await setup({ timeoutMin: 0 });
  assert.equal(await page.evaluate(() => HomeIdle.isRunning()), false);
  await page.clock.runFor(60 * MIN);
  assert.equal(await shown(), false);
  await setup({ timeoutMin: 5, enabled: false });
  assert.equal(await page.evaluate(() => HomeIdle.isRunning()), false, 'enabled:false never starts');
  await page.clock.runFor(60 * MIN);
  assert.equal(await shown(), false);

  // 9. Seconds on: the clock shows seconds and moves every second.
  await setup({ timeoutMin: 5, seconds: true });
  await page.clock.runFor(5 * MIN + 1000);
  const c1 = await page.locator('#idleScreen .idle-clock').innerText();
  assert.match(c1, /\d:\d\d:\d\d/);
  await page.clock.runFor(2000);
  assert.notEqual(
    await page.locator('#idleScreen .idle-clock').innerText(),
    c1,
    'ticks'
  );
  await page.keyboard.press('ArrowLeft');

  // 10. Panel style: blocks without data are omitted, no error text; refresh only for shown blocks.
  await page.evaluate(() => {
    localStorage.removeItem('tvhome.finance.v1');
    HomeInfo.daily.set({ showHolidays: true, showNameDays: true });
  });
  await setup({
    timeoutMin: 5,
    style: 'panel',
    blocks: { date: true, rates: true, football: true }
  });
  await page.clock.runFor(5 * MIN + 1000);
  assert.equal(await shown(), true);
  assert.equal(await page.locator('#idleScreen .idle-block-date').count(), 1);
  assert.equal(
    await page.locator('#idleScreen .idle-block-rates').count(),
    0,
    'no rates data: omitted'
  );
  assert.equal(
    await page.locator('#idleScreen .idle-block-football').count(),
    0,
    'no football data: omitted'
  );
  assert.doesNotMatch(await text(), /undefined|error|unavailable|null/i);
  assert.equal(
    await page.evaluate(() => window.__refresh),
    2,
    'both refreshes called once when shown'
  );
  await page.keyboard.press('ArrowLeft');

  // 11. Panel style with data and a holiday (25 Dec): rates and football lines, holiday under the date.
  await page.clock.setSystemTime(new Date(2026, 11, 25, 10, 0, 0));
  await page.evaluate(() => {
    localStorage.setItem(
      'tvhome.finance.v1',
      JSON.stringify({
        currencies: ['EUR'],
        current: {
          date: '2026-11-20',
          rates: { EUR: { value: 4.97, multiplier: 1 } }
        },
        previous: null
      })
    );
  });
  await setup(
    {
      timeoutMin: 5,
      style: 'panel',
      blocks: { date: true, rates: true, football: true }
    },
    { football: ["Arsenal 2-1 Hull City 34'"] }
  );
  await page.clock.runFor(5 * MIN + 1000);
  assert.match(
    await page.locator('#idleScreen .idle-block-rates').innerText(),
    /EUR 4\.970/
  );
  assert.match(
    await page.locator('#idleScreen .idle-block-football').innerText(),
    /Arsenal 2-1 Hull City/
  );
  assert.equal(
    (await page.locator('#idleScreen .idle-holiday').count()) > 0,
    true,
    'holiday shown'
  );
  await page.keyboard.press('ArrowLeft');
  // showHolidays off hides it; blocks off omit the sections and their refresh.
  await page.evaluate(() => HomeInfo.daily.set({ showHolidays: false }));
  await setup(
    {
      timeoutMin: 5,
      style: 'panel',
      blocks: { date: true, rates: false, football: false }
    },
    { football: ['x'] }
  );
  await page.clock.runFor(5 * MIN + 1000);
  assert.equal(
    await page.locator('#idleScreen .idle-holiday').count(),
    0,
    'holidays off'
  );
  assert.equal(await page.locator('#idleScreen .idle-block-rates').count(), 0);
  assert.equal(
    await page.locator('#idleScreen .idle-block-football').count(),
    0
  );
  assert.equal(
    await page.evaluate(() => window.__refresh),
    0,
    'no refresh for hidden blocks'
  );
  await page.keyboard.press('ArrowLeft');
  await page.evaluate(() => HomeInfo.daily.set({ showHolidays: true }));

  // 12. Panel with the scope off after being shown: no refresh requests once off.
  await setup({
    timeoutMin: 5,
    style: 'panel',
    blocks: { date: true, rates: true, football: true }
  });
  await home.setScope(false);
  await page.clock.runFor(10 * MIN);
  assert.equal(
    await page.evaluate(() => window.__refresh),
    0,
    'no request with the scope off'
  );
  await home.setScope(true);

  // 13. The real weather accessor: no request, null while nothing is loaded; a loaded sample is reported as shown.
  const real = await page.evaluate(() => {
    const f = window.__realSnapshot;
    return { before: f(), type: typeof f };
  });
  assert.equal(real.type, 'function');
  assert.equal(real.before, null, 'null without loaded data');

  // 14. Settings tab: style, timeout, dim, seconds, blocks, LG note.
  await setup({});
  await page.evaluate(() => RenewalPanel.open());
  await page.locator('[data-category="idle"]').click();
  const pane = page.locator('#settings-pane-idle');
  assert.match(await pane.innerText(), /LG screensaver also runs over Home/);
  assert.match(await pane.innerText(), /Screen Saver/);
  assert.match(await pane.innerText(), /only works while Home is in the foreground/);
  assert.doesNotMatch(await pane.innerText(), /only runs outside Home/);
  const cfg = () => page.evaluate(() => HomeInfo.idle.get());
  await pane.locator('.idle-style-panel').click();
  assert.equal((await cfg()).style, 'panel');
  await pane.locator('.idle-timeout-30').click();
  assert.equal((await cfg()).timeoutMin, 30);
  // The ON/OFF switch is the first control of the tab and replaces the old "Off" timeout choice.
  assert.equal(
    await pane.evaluate(
      (p) => p.querySelector('button, input, select').className,
      null
    ),
    await pane.locator('.idle-enabled').getAttribute('class'),
    'switch first'
  );
  assert.equal(await pane.locator('.idle-timeout-0').count(), 0, 'no Off choice');
  assert.equal(await pane.locator('.idle-enabled').innerText(), 'On');
  assert.equal(await pane.locator('.idle-enabled').getAttribute('aria-pressed'), 'true');
  await pane.locator('.idle-enabled').click();
  assert.equal((await cfg()).enabled, false);
  assert.equal((await cfg()).timeoutMin, 30, 'timeout kept while OFF');
  assert.equal(await pane.locator('.idle-enabled').innerText(), 'Off');
  assert.equal(await page.evaluate(() => HomeIdle.isRunning()), false, 'OFF stops the timer');
  await pane.locator('.idle-enabled').click();
  assert.equal((await cfg()).enabled, true);
  assert.equal(await page.evaluate(() => HomeIdle.isRunning()), true, 'ON starts it again');
  // A saved "0 minutes" from before reads as OFF; switching ON restores the default timeout.
  await page.evaluate(() => HomeInfo.idle.set({ timeoutMin: 0 }));
  await page.evaluate(() => HomeIdle.reload());
  await pane.locator('.idle-style-clock').click(); // re-sync the buttons
  assert.equal(await pane.locator('.idle-enabled').innerText(), 'Off');
  await pane.locator('.idle-enabled').click();
  assert.equal((await cfg()).timeoutMin, 10);
  assert.equal((await cfg()).enabled, true);
  await pane.locator('.idle-timeout-30').click();
  await pane.locator('.idle-dim-up').click();
  assert.equal((await cfg()).dim, 70);
  await pane.locator('.idle-dim-down').click();
  await pane.locator('.idle-dim-down').click();
  assert.equal((await cfg()).dim, 50);
  await pane.locator('.idle-seconds').click();
  assert.equal((await cfg()).seconds, true);
  await pane.locator('.idle-block-toggle-rates').click();
  assert.equal((await cfg()).blocks.rates, true);
  assert.equal((await cfg()).blocks.date, true, 'other blocks kept');
  await page.evaluate(() => document.getElementById('renewalClose').click());

  // 15. I1: while the document is hidden (another app in the foreground) the idle screen never shows and nothing is requested;
  // becoming visible again counts as activity (timer restarts, no stuck overlay).
  await setup({
    timeoutMin: 5,
    style: 'panel',
    blocks: { date: true, rates: true, football: true }
  });
  const setHidden = (hidden) =>
    page.evaluate((h) => {
      window.__hiddenFlag = h;
      if (!window.__hiddenPatched) {
        window.__hiddenPatched = true;
        Object.defineProperty(document, 'hidden', {
          configurable: true,
          get: () => window.__hiddenFlag
        });
      }
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  await setHidden(true);
  await page.clock.runFor(40 * MIN);
  assert.equal(await shown(), false, 'hidden document: no idle screen');
  assert.equal(
    await page.evaluate(() => window.__refresh),
    0,
    'hidden document: no refresh requests'
  );
  await setHidden(false);
  assert.equal(await shown(), false, 'visible again: not shown at once');
  await page.clock.runFor(4 * MIN);
  assert.equal(await shown(), false, 'timer restarted when visible again');
  await page.clock.runFor(1 * MIN + 1000);
  assert.equal(await shown(), true, 'shown after a full timeout while visible');
  // Hidden while the overlay is up: it closes and the tick stops; visible again does not leave it stuck.
  await page.evaluate(() => (window.__refresh = 0));
  await setHidden(true);
  assert.equal(await shown(), false, 'overlay closed when the document hides');
  assert.equal(
    await page.evaluate(() => document.body.classList.contains('idle-active')),
    false
  );
  await page.clock.runFor(40 * MIN);
  assert.equal(await page.evaluate(() => window.__refresh), 0, 'no ticks');
  await setHidden(false);
  assert.equal(await shown(), false, 'no stuck overlay');
  await page.keyboard.press('ArrowLeft');

  // 16. I3: a key held down after waking: repeats and the key up are consumed too; a tap behaves as before.
  await setup({ timeoutMin: 5, style: 'clock' });
  await page.clock.runFor(5 * MIN + 1000);
  assert.equal(await shown(), true);
  await page.evaluate(() => (window.__keys = []));
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.down('Enter');
  await page.keyboard.up('Enter');
  assert.equal(await shown(), false, 'held key closes it');
  assert.deepEqual(
    await page.evaluate(() => window.__keys),
    [],
    'repeats and key up of the waking key never reach Home'
  );
  await page.keyboard.press('ArrowRight');
  assert.deepEqual(
    (await page.evaluate(() => window.__keys)).filter((k) =>
      /^keydown/.test(k)
    ),
    ['keydown:ArrowRight'],
    'the next key works normally'
  );
  // Another key right after waking cancels the swallow.
  await page.clock.runFor(5 * MIN + 1000);
  assert.equal(await shown(), true);
  await page.evaluate(() => (window.__keys = []));
  await page.keyboard.down('Enter');
  await page.keyboard.down('ArrowDown');
  assert.deepEqual(
    (await page.evaluate(() => window.__keys)).filter((k) =>
      /^keydown/.test(k)
    ),
    ['keydown:ArrowDown'],
    'another key is not swallowed'
  );
  await page.keyboard.up('ArrowDown');
  await page.keyboard.up('Enter');
  await page.keyboard.press('ArrowLeft');

  // 17. M7: an info panel left open past the timeout is closed (OLED protection); Settings stays and blocks.
  await setup({ timeoutMin: 5, style: 'clock' });
  await page.evaluate(() => InfoPanel.open());
  await page.clock.runFor(5 * MIN + 1000);
  assert.equal(
    await page.evaluate(() => InfoPanel.isOpen()),
    false,
    'info panel closed at the timeout'
  );
  assert.equal(await shown(), false, 'idle starts on the next cycle');
  await page.clock.runFor(5 * MIN + 1000);
  assert.equal(await shown(), true, 'shown on the next cycle');
  await page.keyboard.press('ArrowLeft');
  await page.evaluate(() => RenewalPanel.open());
  await page.clock.runFor(12 * MIN);
  assert.equal(
    await page.evaluate(() => RenewalPanel.isOpen()),
    true,
    'Settings is not closed'
  );
  assert.equal(await shown(), false, 'not while Settings is open');
  await page.evaluate(() => document.getElementById('renewalClose').click());

  // 18. M11: a corrupt stored value falls back to the defaults through get().
  const fromBad = await page.evaluate(() => {
    localStorage.setItem(
      'tvhome.idle.v1',
      '{"timeoutMin":"abc","dim":400,"style":"x","blocks":7}'
    );
    return HomeInfo.idle.get();
  });
  assert.equal(fromBad.timeoutMin, 10);
  assert.equal(fromBad.dim, 100);
  assert.equal(fromBad.style, 'clock');
  assert.equal(fromBad.blocks.date, true);

  // 20. The weather location follows the weather text on the same line, " · "-separated; nothing extra when empty;
  // a long name is cut with an ellipsis (about 28 characters).
  const wline = () => page.locator('#idleScreen .idle-weather').innerText();
  await setup({ timeoutMin: 5, style: 'clock' }, { weather: { temp: 12, unit: '°C', label: 'Clear', icon: 'clear-day', location: 'Bucharest' } });
  await page.clock.runFor(5 * MIN + 2000);
  assert.equal(await wline(), '12°C Clear · Bucharest');
  await page.keyboard.press('ArrowLeft');
  await setup({ timeoutMin: 5, style: 'clock' }, { weather: { temp: 12, unit: '°C', label: 'Clear', icon: 'clear-day', location: '' } });
  await page.clock.runFor(5 * MIN + 2000);
  assert.equal(await wline(), '12°C Clear', 'empty location: nothing extra');
  await page.keyboard.press('ArrowLeft');
  await setup({ timeoutMin: 5, style: 'clock' }, { weather: { temp: 12, unit: '°C', label: 'Clear', icon: 'clear-day', location: 'Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch' } });
  await page.clock.runFor(5 * MIN + 2000);
  const longLine = await wline();
  assert.match(longLine, /^12°C Clear · Llanfairpwllgwyngyllgogeryc…$/, longLine);
  assert.ok(longLine.split(' · ')[1].length <= 28);
  await page.keyboard.press('ArrowLeft');

  // 19. Nothing of Home shows through the idle screen, whatever the style and the dim level: the app name (its inline
  // opacity used to beat the stylesheet), header buttons, tiles, dock band, landing widgets and the weather block.
  await page.addStyleTag({ content: '*{transition:none !important}' }); // read settled values
  const homeParts = ['#hero', '#topButtons', 'header', '#viewport', '#dockBand', '#landingWidgets', '#homeWeather'];
  const partStates = () =>
    page.evaluate((sels) => {
      const out = {};
      sels.forEach((sel) => {
        const e = document.querySelector(sel);
        if (!e) return;
        // Effective opacity along the ancestors, and visibility.
        let o = 1;
        for (let n = e; n && n !== document.documentElement; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity);
        out[sel] = { opacity: o, visibility: getComputedStyle(e).visibility };
      });
      return out;
    }, homeParts);
  for (const style of ['clock', 'panel'])
    for (const dim of [0, 60, 100]) {
      await setup({ timeoutMin: 5, style, dim });
      await page.evaluate(() => {
        const hero = document.getElementById('hero'),
          w = document.getElementById('homeWeather');
        hero.textContent = 'Netflix';
        hero.style.opacity = '1'; // as app.js sets it for the focused app
        w.hidden = false;
        w.style.left = '112px';
        w.style.top = '240px';
        w.style.width = '600px';
        w.style.height = '200px';
        HomeInfo.calendar.set({ landing: true });
        window.__focusBefore = document.activeElement && (document.activeElement.id || document.activeElement.tagName);
      });
      const before = await partStates();
      assert.equal(before['#hero'].visibility, 'hidden', 'the app name is never shown with mr.redify');
      assert.equal(before['#topButtons'].visibility, 'visible');
      await page.clock.runFor(5 * MIN + 2000);
      assert.equal(await shown(), true, 'idle shown (' + style + '/' + dim + ')');
      const during = await partStates();
      for (const sel of homeParts)
        if (during[sel])
          assert.ok(
            during[sel].opacity === 0 || during[sel].visibility === 'hidden',
            sel + ' shows through the idle screen (' + style + '/' + dim + '): ' + JSON.stringify(during[sel])
          );
      assert.equal(during['#hero'].opacity, 0, 'app name hidden');
      assert.equal(during['#hero'].visibility, 'hidden');
      await page.keyboard.press('ArrowLeft'); // wakes, consumed
      assert.equal(await shown(), false, 'woke');
      const after = await partStates();
      assert.equal(after['#hero'].visibility, 'hidden', 'app name stays hidden after wake');
      assert.equal(after['#topButtons'].visibility, 'visible');
      assert.equal(
        await page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName)),
        await page.evaluate(() => window.__focusBefore),
        'focus unchanged by the idle screen'
      );
    }

  assert.deepEqual(home.errors, [], 'no page errors');
  await home.close();
  console.log('PASS idle-ui');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
