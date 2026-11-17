'use strict';
const assert = require('node:assert/strict'),
  { openHome } = require('./harness.cjs');
// Main-page widgets (mr.redify only): month grid + Name day / Exchange / Football cards. Visibility matrix, content,
// three-column geometry at 1920x1080 against the REAL weather block (forecast format, 3 days, Bucharest, like the TV),
// text sizes, timers and requests.
const NOW = '2026-11-16T12:00:00Z'; // a Monday
const RATES = {
  date: '2026-11-16',
  rates: {
    EUR: { value: 5.0912, multiplier: 1 },
    USD: { value: 4.6871, multiplier: 1 },
    GBP: { value: 5.7954, multiplier: 1 },
    CHF: { value: 5.4437, multiplier: 1 },
    HUF: { value: 1.3, multiplier: 100 }
  }
};
function m(id, home, away, state, start, hs, as, clock) {
  return {
    id,
    competition: 'eng.1',
    home: { id: home[0], name: home[1], score: hs === undefined ? null : hs },
    away: { id: away[0], name: away[1], score: as === undefined ? null : as },
    start,
    state,
    clock: clock || ''
  };
}
// Seeds every source and clock; the toggles are set by the caller.
async function seed(page, opts) {
  opts = opts || {};
  await page.evaluate(
    ({ NOW, RATES, opts }) => {
      localStorage.clear();
      HomeCalendar.setClock(() => new Date(2026, 10, 16, 12, 0, 0));
      HomeFootball.setClock(() => new Date(NOW));
      HomeInfo.daily.set({ showHolidays: true, showNameDays: true });
      HomeInfo.calendar.set({
        events: [{ id: 'e1', day: 20, month: 11, title: 'Dentist appointment', yearly: true }]
      });
      if (!opts.noRates)
        HomeInfo.finance.set({
          currencies: ['EUR', 'USD', 'GBP', 'CHF'],
          current: RATES,
          previous: null
        });
      if (!opts.noFootball) {
        const teams = [
          { competition: 'eng.1', id: '1', name: opts.long ? 'Wolverhampton Wanderers FC International' : 'Arsenal' },
          { competition: 'eng.1', id: '3', name: 'Everton' },
          { competition: 'eng.1', id: '5', name: 'Brighton' }
        ];
        HomeInfo.football.set({ competitions: ['eng.1'], teams });
        const board = [
          { id: 'm1', competition: 'eng.1', home: { id: '1', name: teams[0].name, score: 2 }, away: { id: '2', name: opts.long ? 'Brighton & Hove Albion Football Club' : 'Chelsea', score: 1 }, start: '2026-11-16T11:00:00Z', state: 'in', clock: "34'" },
          { id: 'm2', competition: 'eng.1', home: { id: '3', name: 'Everton', score: null }, away: { id: '4', name: 'Fulham', score: null }, start: '2026-11-21T15:00:00Z', state: 'pre', clock: '' },
          { id: 'm3', competition: 'eng.1', home: { id: '5', name: 'Brighton', score: 0 }, away: { id: '6', name: 'Leeds', score: 3 }, start: '2026-11-14T15:00:00Z', state: 'post', clock: '' }
        ];
        localStorage.setItem(
          'tvhome.football.snapshot.v1',
          JSON.stringify({ boards: { 'eng.1': board }, teams: {} })
        );
      }
      window.__calls = { rates: 0, football: 0 };
      HomeInfoFinance.refreshIfDue = () => {
        window.__calls.rates++;
        return Promise.resolve({});
      };
      HomeFootball.refresh = () => {
        window.__calls.football++;
        return Promise.resolve({});
      };
    },
    { NOW, RATES, opts }
  );
}
// Generous space for the content tests (the geometry tests use the real positions: dock top 715 as on the TV).
const room = (page, on) =>
  page.evaluate((v) => {
    const dock = document.getElementById('dockBand');
    window.__real = window.__real || { dock: dock.style.top };
    dock.style.top = v ? '1000px' : window.__real.dock;
  }, on);
const toggles = (page, on) =>
  page.evaluate((v) => {
    HomeInfo.calendar.set({ landing: v.calendar });
    HomeInfo.daily.set({ landing: v.nameday });
    HomeInfo.finance.set({ landing: v.rates });
    HomeInfo.football.set({ landing: v.football });
  }, on);
const state = (page) => page.evaluate(() => HomeLanding.state());
const visible = (page) => page.evaluate(() => HomeLanding.visible());
const ALL = { calendar: true, nameday: true, rates: true, football: true };
const NONE = { calendar: false, nameday: false, rates: false, football: false };
const ORDER = ['calendar', 'nameday', 'rates', 'football'];
// Real weather block (forecast format, 3 days) from a seeded cache: the same data the TV showed. A width overrides it to
// simulate a wider block (compact format / large scale); no width renders the real one again.
const WEATHER_SEED = {
  version: 1,
  provider: 'open-meteo',
  enabled: true,
  preferred: 'forecast',
  mode: 'manual',
  location: { name: 'Bucharest', latitude: 44.4268, longitude: 26.1, country: 'Romania' },
  caches: {
    'open-meteo': {
      key: '44.427,26.100',
      updated: 0,
      data: { temp: 7, code: 61, isDay: false, timezone: 'Europe/Bucharest', offset: 7200, time: '2026-11-16T23:06', days: [
        { date: '2026-11-16', low: 7, high: 7, code: 61 },
        { date: '2026-11-17', low: 6, high: 13, code: 61 },
        { date: '2026-11-18', low: 8, high: 14, code: 2 }
      ] }
    }
  }
};
const weather = (page, width) =>
  page.evaluate((w) => {
    const el = document.getElementById('homeWeather');
    if (w) {
      el.style.width = w + 'px';
      return;
    }
    HomeWeather.render();
  }, width);
const rect = (sel) =>
  `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height }; })()`;
const overlap = (a, b) => a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

(async () => {
  const home = await openHome({ mrRedify: true }),
    page = home.page;
  let requests = 0;
  // The weather block asks its own providers; only the football and BNR hosts count here.
  page.on('request', (r) => {
    if (/^https?:/.test(r.url()) && /espn|thesportsdb|bnr\.ro/.test(r.url())) requests++;
  });
  await page.context().addInitScript((seedJson) => {
    const w = JSON.parse(seedJson);
    w.caches['open-meteo'].updated = Date.now();
    localStorage.setItem('tvhome.weather.v1', JSON.stringify(w));
  }, JSON.stringify(WEATHER_SEED));
  await page.reload();
  await page.waitForFunction(() => window.RootLauncherRendered && window.HomeInfo);
  await home.setScope(true);
  await page.evaluate(() => HomeWeather.render());
  assert.equal(await page.evaluate(() => document.getElementById('homeWeather').hidden), false, 'real weather block is shown');
  await seed(page);
  await room(page, true);

  // 1. Everything OFF: nothing shown, no timer, no refresh, no request.
  await toggles(page, NONE);
  let s = await state(page);
  assert.deepEqual(s.cards, []);
  assert.equal(s.timer, false, 'no timer with every toggle OFF');
  assert.equal(await visible(page), false);
  assert.equal(await page.evaluate(() => document.getElementById('landingWidgets').hidden), true);
  assert.deepEqual(await page.evaluate(() => window.__calls), { rates: 0, football: 0 });

  // 2. All ON: grid, Name day, Exchange, Football in that order, with data.
  await toggles(page, ALL);
  s = await state(page);
  assert.deepEqual(s.cards, ORDER);
  assert.equal(s.timer, true);
  assert.equal(await visible(page), true);
  const text = await page.evaluate(() => document.getElementById('landingWidgets').textContent);
  assert.match(text, /November 2026/);
  assert.match(text, /Matei/, 'name day');
  assert.match(text, /EUR 5\.0912 {2}USD 4\.6871/);
  assert.match(text, /GBP 5\.7954 {2}CHF 5\.4437/);
  assert.match(text, /16\.11/, 'BNR date');
  assert.match(text, /Arsenal/);
  assert.match(text, /Live 34' · 2 - 1/);
  // Own events: the next ones under the grid, a dot under the marked days (the seeded yearly event is on 20 November).
  assert.match(text, /Fri 20 Nov Dentist appointment/, 'next event line');
  assert.deepEqual(
    await page.evaluate(() => Array.prototype.map.call(document.querySelectorAll('#landingWidgets .lw-mark'), (c) => c.textContent)),
    ['20'],
    'dot on the day with an event'
  );
  assert.equal(await page.locator('#landingWidgets .lw-today.lw-mark').count(), 0);
  // Name day card: title is the card's own, no date; first line = the names only.
  const nd = await page.evaluate(() => {
    const c = document.querySelector('#landingWidgets [data-lw="nameday"]');
    return {
      label: c.querySelector('.lw-label').textContent,
      lines: Array.prototype.map.call(c.querySelectorAll('.lw-line'), (l) => l.textContent),
      icon: !!c.querySelector('svg.lw-icon'),
      meta: !!c.querySelector('.lw-meta')
    };
  });
  assert.equal(nd.label, 'Name day');
  assert.deepEqual(nd.lines, ['Matei'], 'names only, no holiday today');
  assert.equal(nd.icon, true);
  assert.equal(nd.meta, false);
  assert.doesNotMatch(nd.label + nd.lines.join(' '), /Monday|November|16/, 'no date text on the card');
  // A holiday (30 November, St Andrew): the names first, the holiday name on a further line.
  await page.evaluate(() => {
    HomeCalendar.setClock(() => new Date(2026, 10, 30, 12, 0, 0));
    HomeLanding.render();
  });
  const hol = await page.evaluate(() =>
    Array.prototype.map.call(document.querySelectorAll('#landingWidgets [data-lw="nameday"] .lw-line'), (l) => l.textContent)
  );
  assert.equal(hol.length, 2, 'names + holiday: ' + hol.join(' | '));
  assert.match(hol[0], /Andrei/);
  assert.match(hol[1], /Andrei/i);
  await page.evaluate(() => {
    HomeCalendar.setClock(() => new Date(2026, 10, 16, 12, 0, 0));
    HomeLanding.render();
  });
  // Rates go through their schedule (refreshIfDue: a request only at the BNR slots, decided in finance.js), football hourly.
  let c0 = await page.evaluate(() => window.__calls);
  assert.ok(c0.rates >= 1 && c0.football === 1, 'schedule check and first football refresh on activation: ' + JSON.stringify(c0));

  // 3. Month grid: all 30 days, weekday header from the week start, today filled, nothing else marked.
  const grid = await page.evaluate(() => {
    const g = document.querySelector('#landingWidgets .lw-grid'),
      cells = Array.prototype.filter.call(g.querySelectorAll('.lw-cell:not(.lw-weekday)'), (c) => c.textContent !== '');
    return {
      days: cells.map((c) => c.textContent),
      weekdays: Array.prototype.map.call(g.querySelectorAll('.lw-weekday'), (c) => c.textContent),
      today: Array.prototype.map.call(g.querySelectorAll('.lw-today'), (c) => c.textContent),
      classes: Array.from(new Set(Array.prototype.map.call(g.querySelectorAll('.lw-cell'), (c) => c.className.replace(/\s*lw-today/, '').replace(/\s*lw-mark/, '')))),
      rows: g.querySelectorAll('.lw-row').length
    };
  });
  assert.deepEqual(grid.days, Array.from({ length: 30 }, (_, i) => String(i + 1)));
  assert.deepEqual(grid.weekdays, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  assert.deepEqual(grid.today, ['16']);
  assert.deepEqual(grid.classes.sort(), ['lw-cell', 'lw-cell lw-weekday'].sort(), 'no marks: holidays, events, week numbers');
  assert.equal(grid.rows, 7, 'weekday row + 6 week rows for November 2026');
  await page.evaluate(() => HomeInfo.calendar.set({ weekStart: 'sun', weekNumbers: true }));
  assert.equal(await page.locator('#landingWidgets .lw-weekday').first().textContent(), 'Sun');
  assert.equal(await page.locator('#landingWidgets .lw-weekno').count(), 0);
  await page.evaluate(() => HomeInfo.calendar.set({ weekStart: 'mon', weekNumbers: false }));

  // 4. A part without data is left out, no error text; Name day follows the calendar marks.
  await seed(page, { noRates: true });
  await toggles(page, ALL);
  assert.deepEqual((await state(page)).cards, ['calendar', 'nameday', 'football']);
  await seed(page, { noFootball: true });
  await toggles(page, ALL);
  assert.deepEqual((await state(page)).cards, ['calendar', 'nameday', 'rates']);
  await seed(page);
  await toggles(page, ALL);
  await page.evaluate(() => HomeInfo.daily.set({ showNameDays: false, showHolidays: false }));
  assert.deepEqual((await state(page)).cards, ['calendar', 'rates', 'football'], 'no marks, no name day card');
  await page.evaluate(() => HomeInfo.daily.set({ showNameDays: true, showHolidays: true }));
  // Partial toggles.
  await toggles(page, { calendar: false, nameday: false, rates: true, football: false });
  assert.deepEqual((await state(page)).cards, ['rates']);
  await toggles(page, { calendar: true, nameday: true, rates: false, football: false });
  assert.deepEqual((await state(page)).cards, ['calendar', 'nameday']);

  // 5. Settings change re-renders at once (no clock needed).
  await page.evaluate(() => HomeInfo.finance.set({ landing: true }));
  assert.deepEqual((await state(page)).cards, ['calendar', 'nameday', 'rates']);
  await page.evaluate(() => HomeInfo.calendar.set({ landing: false }));
  assert.deepEqual((await state(page)).cards, ['nameday', 'rates']);

  // 6. Not focusable, no pointer events.
  await toggles(page, ALL);
  assert.equal(
    await page.evaluate(() => document.querySelectorAll('#landingWidgets button, #landingWidgets a, #landingWidgets [tabindex]').length),
    0
  );
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('landingWidgets')).pointerEvents), 'none');

  // 7. Hidden while scrolled / editing / weather scrolled / idle screen / info panel / Settings / app picker.
  for (const cls of ['scrolled', 'editing', 'weather-scrolled', 'idle-active']) {
    await page.evaluate((c) => document.body.classList.add(c), cls);
    assert.equal(await visible(page), false, cls + ' hides the widgets');
    await page.evaluate((c) => document.body.classList.remove(c), cls);
    assert.equal(await visible(page), true, cls + ' removed: back');
  }
  await page.evaluate(() => InfoPanel.open());
  assert.equal(await visible(page), false, 'info panel open');
  await page.evaluate(() => InfoPanel.close());
  await page.evaluate(() => RenewalPanel.open());
  assert.equal(await visible(page), false, 'Settings open');
  await page.evaluate(() => document.getElementById('renewalClose').click());
  await page.evaluate(() => (document.getElementById('appPicker').hidden = false));
  assert.equal(await visible(page), false, 'app picker open');
  await page.evaluate(() => (document.getElementById('appPicker').hidden = true));
  assert.equal(await visible(page), true);

  // 8. Scope off (other theme / Classic): nothing, no timer; back on: widgets again.
  await home.setScope(false);
  s = await state(page);
  assert.deepEqual(s.cards, []);
  assert.equal(s.timer, false);
  assert.equal(await visible(page), false);
  await home.setScope(true);
  assert.deepEqual((await state(page)).cards, ORDER);

  // 9. Geometry at 1920x1080: three EQUAL columns weather | grid | cards on one line, plain text (no boxes), against the
  // real weather block. The TV measured: timeRow [112,82,1248,104], topButtons [1392,90,416,84], dock top about 715.
  await seed(page);
  await toggles(page, ALL);
  await weather(page, 0);
  const tvRoom = () =>
    page.evaluate(() => {
      document.getElementById('dockBand').style.top = '715px';
      HomeLanding.render();
    });
  await tvRoom();
  const firstText = (sel) =>
    page.evaluate((sel) => {
      const root = document.querySelector(sel);
      if (!root) return null;
      const walker = document.createTreeWalker(root, 4, null, false);
      let t;
      while ((t = walker.nextNode())) {
        if (!/\S/.test(t.nodeValue)) continue;
        const r = document.createRange();
        r.selectNodeContents(t);
        const b = r.getBoundingClientRect();
        if (b.height) return { top: b.top, font: parseFloat(getComputedStyle(t.parentNode).fontSize), lh: getComputedStyle(t.parentNode).lineHeight };
      }
      return null;
    }, sel);
  const geo = async () => ({
    grid: await page.evaluate(rect('#landingWidgets .lw-grid')),
    stack: await page.evaluate(rect('#landingWidgets .lw-stack')),
    cards: await page.evaluate(
      `Array.prototype.map.call(document.querySelectorAll('#landingWidgets .lw-stack .lw-card'), (c) => { const b = c.getBoundingClientRect(); return { id: c.getAttribute('data-lw'), left: b.left, right: b.right, top: b.top, bottom: b.bottom, height: b.height, lines: c.querySelectorAll('.lw-line, .lw-sub').length }; })`
    ),
    weather: await page.evaluate(rect('#homeWeather')),
    buttons: await page.evaluate(rect('#topButtons')),
    time: await page.evaluate(rect('#timeRow')),
    dock: await page.evaluate(rect('#dockBand')),
    heroVisible: await page.evaluate(() => {
      const h = document.getElementById('hero');
      return getComputedStyle(h).visibility;
    }),
    t: {
      weather: await firstText('#homeWeather'),
      grid: await firstText('#landingWidgets .lw-grid .lw-month'),
      stack: await firstText('#landingWidgets .lw-stack .lw-label')
    }
  });
  const overlap = (a, b) => a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, msg + ': ' + a + ' vs ' + b);
  let g = await geo();
  assert.ok(g.grid && g.stack, 'grid and cards present');
  assert.equal(g.heroVisible, 'hidden', 'the app name is not shown with mr.redify');
  // Equal widths, tops, bottoms; right edge 1808, left edge 112, equal gaps.
  const cols = { weather: g.weather, grid: g.grid, stack: g.stack };
  near(g.weather.width, g.grid.width, 2, 'weather/grid width');
  near(g.grid.width, g.stack.width, 2, 'grid/cards width');
  near(g.weather.left, 112, 1, 'left margin');
  near(g.stack.right, 1808, 1, 'right edge = header buttons right edge');
  near(g.grid.left - g.weather.right, g.stack.left - g.grid.right, 2, 'equal gaps');
  assert.ok(g.grid.left - g.weather.right >= 20, 'gap at least 20 px');
  near(g.grid.top, g.weather.top, 2, 'tops');
  near(g.stack.top, g.weather.top, 2, 'tops');
  near(g.grid.bottom, g.weather.bottom, 2, 'bottoms');
  near(g.stack.bottom, g.weather.bottom, 2, 'bottoms');
  assert.ok(g.stack.bottom <= g.dock.top - 20, 'columns end above the dock: ' + g.stack.bottom + ' / ' + g.dock.top);
  // The first visible text of each column starts on the same line, with the same title size and line height.
  near(g.t.grid.top, g.t.weather.top, 2, 'first text: month title vs city');
  near(g.t.stack.top, g.t.weather.top, 2, 'first text: Name day title vs city');
  assert.equal(g.t.grid.font, g.t.weather.font, 'title size = city size');
  assert.equal(g.t.stack.font, g.t.weather.font);
  assert.equal(g.t.grid.lh, g.t.weather.lh);
  assert.equal(g.t.stack.lh, g.t.weather.lh);
  assert.ok(g.t.weather.top >= g.time.bottom && g.t.weather.top <= g.time.bottom + 30, 'under the date row: ' + g.t.weather.top);
  // No overlap among the columns, the header buttons, the clock/date row and the dock.
  const named = { ...cols, buttons: g.buttons, time: g.time, dock: g.dock };
  const names = Object.keys(named);
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++)
      assert.equal(overlap(named[names[i]], named[names[j]]), false, 'overlap: ' + names[i] + ' / ' + names[j]);
  // The three sections are equal boxes (same width, same height) that fill the column; all three present.
  assert.deepEqual(g.cards.map((c) => c.id), ['nameday', 'rates', 'football']);
  g.cards.forEach((c) => {
    near(c.height, g.cards[0].height, 2, 'equal section heights');
    near(c.right - c.left, g.stack.width, 1, 'section width = column width');
  });
  for (let i = 1; i < g.cards.length; i++) near(g.cards[i].top, g.cards[i - 1].bottom, 1.5, 'stacked without gaps');
  near(g.cards[g.cards.length - 1].bottom, g.stack.bottom, 3, 'sections fill the column');
  // Exchange keeps its two lines and Football its two events (the freed height of the hidden app name).
  assert.equal(await page.locator('#landingWidgets [data-lw="rates"] .lw-line').count(), 2, 'Exchange: two lines');
  assert.equal(await page.locator('#landingWidgets [data-lw="football"] .lw-match').count(), 2, 'two football events');
  assert.equal(await page.locator('#landingWidgets [data-lw="nameday"] .lw-line').count(), 1);
  // Plain text like the weather block: no box, no background, no border, no radius, no shadow, no blur; same color.
  const looks = await page.evaluate(() => {
    const cs = (e) => {
      const c = getComputedStyle(e);
      return { bg: c.backgroundColor, bgi: c.backgroundImage, border: c.borderTopWidth + ' ' + c.borderLeftWidth, radius: c.borderRadius, shadow: c.boxShadow, text: c.textShadow, color: c.color, filter: c.backdropFilter || c.webkitBackdropFilter || 'none' };
    };
    const w = cs(document.querySelector('#homeWeather .weather-city')),
      boxes = ['.lw-grid', '.lw-stack', '[data-lw="nameday"]', '[data-lw="rates"]', '[data-lw="football"]'].map((q) => [q, cs(document.querySelector('#landingWidgets ' + q))]),
      label = cs(document.querySelector('#landingWidgets .lw-label')),
      body = cs(document.querySelector('#landingWidgets .lw-line'));
    return { w, boxes, label, body };
  });
  looks.boxes.forEach(([q, c]) => {
    assert.equal(c.bg, 'rgba(0, 0, 0, 0)', q + ' background');
    assert.equal(c.bgi, 'none', q + ' background image');
    assert.equal(c.radius, '0px', q + ' radius');
    assert.equal(c.shadow, 'none', q + ' box shadow');
    assert.equal(c.border.split(' ')[1], '0px', q + ' side border');
    assert.ok(['none', ''].indexOf(c.filter) >= 0, q + ' backdrop blur');
  });
  assert.equal(looks.label.color, looks.w.color, 'title color = weather text color');
  assert.equal(looks.body.color, looks.w.color, 'body color = weather text color');
  assert.equal(looks.label.text, looks.w.text, 'title text-shadow = weather text-shadow');
  assert.equal(looks.body.text, looks.w.text, 'body text-shadow = weather text-shadow');
  // Text sizes: toward the weather's 34 px; never below 0.7 of it (the largest size that fits all sections).
  const sizes = await page.evaluate(() => {
    const fs = (sel) => Array.prototype.map.call(document.querySelectorAll(sel), (e) => parseFloat(getComputedStyle(e).fontSize));
    return {
      weatherDetail: parseFloat(getComputedStyle(document.querySelector('#homeWeather .weather-row')).fontSize),
      body: fs('#landingWidgets .lw-line').concat(fs('#landingWidgets .lw-cell:not(.lw-weekday)'), fs('#landingWidgets .lw-teams')),
      grid: fs('#landingWidgets .lw-cell:not(.lw-weekday)')[0],
      titles: fs('#landingWidgets .lw-head').concat(fs('#landingWidgets .lw-month'))
    };
  });
  assert.equal(sizes.weatherDetail, 34);
  sizes.body.forEach((f) => assert.ok(f >= sizes.weatherDetail * 0.7, 'font ' + f));
  assert.ok(sizes.grid >= 30, 'calendar cells use the freed height: ' + sizes.grid);
  sizes.titles.forEach((f) => assert.equal(f, 34));
  // Football and rate text are not clipped: nothing overflows its section.
  assert.equal(
    await page.evaluate(() => Array.prototype.some.call(document.querySelectorAll('#landingWidgets .lw-card, #landingWidgets .lw-grid'), (e) => e.scrollHeight > e.clientHeight + 1)),
    false,
    'no clipped section'
  );

  // 9a. Less room (dock higher, as in the harness): sizes shrink, columns stay equal, nothing overlaps the dock.
  await page.evaluate(() => {
    document.getElementById('dockBand').style.top = '640px';
    HomeLanding.render();
  });
  g = await geo();
  assert.ok(g.grid && g.stack);
  near(g.grid.bottom, g.stack.bottom, 2, 'equal bottoms');
  assert.ok(g.stack.bottom <= 640 - 20);
  assert.equal(await page.evaluate(() => document.querySelector('#landingWidgets .lw-stack').scrollHeight <= document.querySelector('#landingWidgets .lw-stack').clientHeight + 1), true);
  await tvRoom();

  // 9b. Columns whose top would collide with the header buttons all start just below them.
  await page.evaluate(() => {
    document.getElementById('homeWeather').style.top = '60px';
    HomeLanding.render();
  });
  g = await geo();
  assert.ok(g.stack.top >= g.buttons.bottom + 19, 'cards start below the buttons: ' + g.stack.top + ' vs ' + g.buttons.bottom);
  near(g.grid.top, g.stack.top, 2, 'grid and cards on one line');
  assert.equal(overlap(g.stack, g.buttons), false);
  assert.equal(overlap(g.grid, g.buttons), false);
  await weather(page, 0);
  await tvRoom();

  // 9c. Little room: Exchange goes first, then Name day, then Football's second event, then Football; the grid goes
  // when it cannot hold a readable size.
  const shrink = async (dockTop) => {
    await page.evaluate((t) => {
      document.getElementById('dockBand').style.top = t + 'px';
      HomeLanding.render();
    }, dockTop);
    return page.evaluate(() => ({
      cards: HomeLanding.state().cards,
      events: document.querySelectorAll('#landingWidgets [data-lw="football"] .lw-match').length
    }));
  };
  let r = await shrink(520);
  assert.ok(r.cards.indexOf('football') >= 0, 'Football kept: ' + r.cards);
  assert.ok(r.cards.indexOf('rates') < 0 || r.cards.indexOf('nameday') >= 0, 'Exchange dropped before Name day: ' + r.cards);
  r = await shrink(400);
  assert.deepEqual(r.cards.filter((c) => c !== 'calendar'), ['football'].filter((c) => r.cards.indexOf(c) >= 0), 'only Football left: ' + r.cards);
  r = await shrink(330);
  assert.ok(r.cards.indexOf('football') < 0 || r.events === 1, 'second event before the card: ' + JSON.stringify(r));
  r = await shrink(200);
  assert.deepEqual(r.cards, [], 'nothing fits: nothing shown');
  assert.equal(await page.evaluate(() => document.getElementById('landingWidgets').hidden), true);
  await tvRoom();

  // 9d. A wide weather block (text format) pushes the cards out first, then the grid; never overlapped.
  await weather(page, 1000);
  await page.evaluate(() => HomeLanding.render());
  g = await geo();
  assert.equal(g.stack, null, 'cards column given up for the weather block');
  assert.ok(g.grid && g.grid.left >= g.weather.right, 'grid kept right of the weather block');
  assert.equal(overlap(g.weather, g.grid), false);
  await weather(page, 1400);
  await page.evaluate(() => HomeLanding.render());
  assert.deepEqual(await page.evaluate(() => HomeLanding.state().cards), [], 'nothing left: nothing shown');
  await weather(page, 0);
  await tvRoom();

  // 9e. Events under the grid: lines (max 2), dots, today's highlight kept, nothing overlapping; none -> no line.
  await page.evaluate(() => {
    HomeInfo.calendar.set({
      events: [
        { id: 'a', day: 16, month: 11, title: 'Today timed', yearly: true, time: '14:30' },
        { id: 'b', day: 17, month: 11, title: 'Tomorrow all day', yearly: true },
        { id: 'c', day: 18, month: 11, title: 'Third is never shown', yearly: true, time: '08:00' },
        { id: 'd', day: 2, month: 12, title: 'Next month', yearly: true }
      ]
    });
    localStorage.setItem('tvhome.clockFormat', '24h');
    HomeI18n.refresh();
    HomeLanding.render();
  });
  let lines = await page.evaluate(() => Array.prototype.map.call(document.querySelectorAll('#landingWidgets .lw-event'), (e) => e.textContent));
  assert.deepEqual(lines, ['Today 14:30 Today timed', 'Tomorrow Tomorrow all day'], 'max two lines, in order');
  assert.deepEqual(
    await page.evaluate(() => Array.prototype.map.call(document.querySelectorAll('#landingWidgets .lw-mark'), (c) => c.textContent)),
    ['16', '17', '18'],
    'dots only for this month'
  );
  assert.equal(await page.locator('#landingWidgets .lw-today').textContent(), '16', 'today keeps its highlight (with a dot)');
  assert.equal(await page.locator('#landingWidgets .lw-today.lw-mark').count(), 1);
  g = await geo();
  assert.ok(g.grid && g.stack);
  const evBox = await page.evaluate(rect('#landingWidgets .lw-events'));
  assert.ok(evBox.top >= g.grid.top && evBox.bottom <= g.grid.bottom + 1, 'events inside the grid column');
  assert.ok(g.grid.bottom <= g.dock.top - 20);
  assert.equal(overlap(g.grid, g.stack), false);
  assert.equal(overlap(g.grid, g.weather), false);
  assert.equal(overlap(g.grid, g.buttons), false);
  assert.equal(
    await page.evaluate(() => Array.prototype.some.call(document.querySelectorAll('#landingWidgets .lw-grid'), (e) => e.scrollHeight > e.clientHeight + 1)),
    false,
    'nothing clipped'
  );
  // Rows keep a readable size with the events block (cells at least 1.4 line heights).
  assert.ok(await page.evaluate(() => Array.prototype.every.call(document.querySelectorAll('#landingWidgets .lw-row:not(.lw-weekdays)'), (r) => r.getBoundingClientRect().height >= 30)));
  // A long title ends with an ellipsis, inside the column.
  await page.evaluate(() => {
    HomeInfo.calendar.set({ events: [{ id: 'l', day: 16, month: 11, title: 'An extremely long event title that cannot possibly fit in one column line', yearly: true, time: '23:00' }] });
  });
  const longEv = await page.evaluate(() => {
    const e = document.querySelector('#landingWidgets .lw-event');
    return { cut: e.scrollWidth > e.clientWidth, over: getComputedStyle(e).textOverflow, w: e.getBoundingClientRect().right, grid: document.querySelector('#landingWidgets .lw-grid').getBoundingClientRect().right };
  });
  assert.equal(longEv.cut, true);
  assert.equal(longEv.over, 'ellipsis');
  assert.ok(longEv.w <= longEv.grid + 0.5);
  // Little room: the event lines go first (whole lines), the grid itself stays while it fits.
  await page.evaluate(() => {
    HomeInfo.calendar.set({ events: [{ id: 'a', day: 16, month: 11, title: 'One', yearly: true, time: '14:30' }, { id: 'b', day: 17, month: 11, title: 'Two', yearly: true }] });
    document.getElementById('dockBand').style.top = '640px';
    HomeLanding.render();
  });
  const tight = await page.evaluate(() => ({ lines: document.querySelectorAll('#landingWidgets .lw-event').length, grid: !!document.querySelector('#landingWidgets .lw-grid'), clip: document.querySelector('#landingWidgets .lw-grid') ? document.querySelector('#landingWidgets .lw-grid').scrollHeight > document.querySelector('#landingWidgets .lw-grid').clientHeight + 1 : false }));
  assert.equal(tight.clip, false, 'never clipped');
  assert.ok(tight.lines <= 2);
  await page.evaluate(() => {
    document.getElementById('dockBand').style.top = '250px'; // grid cannot fit even without lines
    HomeLanding.render();
  });
  assert.equal(await page.evaluate(() => document.querySelectorAll('#landingWidgets .lw-event').length), 0, 'no event line without a grid');
  await tvRoom();
  // No event in range: no line, no dot.
  await page.evaluate(() => {
    HomeInfo.calendar.set({ events: [{ id: 'f', day: 28, month: 11, title: 'Far', yearly: true }, { id: 'g', day: 3, month: 11, title: 'Passed', yearly: true }] });
    HomeLanding.render();
  });
  assert.equal(await page.locator('#landingWidgets .lw-event').count(), 0);
  assert.equal(await page.locator('#landingWidgets .lw-events').count(), 0);
  assert.deepEqual(await page.evaluate(() => HomeCalendar.landingMonth().marked), [3, 28]);
  // Romanian: Azi / Mâine / weekday day month in Romanian.
  await page.evaluate(() => {
    HomeInfo.calendar.set({ events: [{ id: 'a', day: 16, month: 11, title: 'Azi test', yearly: true, time: '23:30' }, { id: 'b', day: 17, month: 11, title: 'Mâine test', yearly: true }, ] });
    localStorage.setItem('tvhome.language', 'ro');
    HomeI18n.refresh();
    HomeLanding.render();
  });
  assert.deepEqual(
    await page.evaluate(() => Array.prototype.map.call(document.querySelectorAll('#landingWidgets .lw-event'), (e) => e.textContent)),
    ['Azi 23:30 Azi test', 'Mâine Mâine test']
  );
  await page.evaluate(() => {
    HomeInfo.calendar.set({ events: [{ id: 'a', day: 21, month: 11, title: 'Meci', yearly: true, time: '18:00' }] });
  });
  assert.match(await page.locator('#landingWidgets .lw-event').first().textContent(), /^Sâm 21 nov 18:00 Meci$/);
  await page.evaluate(() => {
    localStorage.removeItem('tvhome.language');
    localStorage.removeItem('tvhome.clockFormat');
    HomeI18n.refresh();
    HomeInfo.calendar.set({ events: [{ id: 'e1', day: 20, month: 11, title: 'Dentist appointment', yearly: true }] });
    HomeLanding.render();
  });

  // 10. Long team names: the card keeps its width, names are cut with an ellipsis.
  await seed(page, { long: true });
  await toggles(page, { calendar: false, nameday: false, rates: false, football: true });
  g = await geo();
  assert.equal(Math.round(g.stack.width), 549);
  const cut = await page.evaluate(() =>
    Array.prototype.some.call(document.querySelectorAll('#landingWidgets .lw-name'), (n) => n.scrollWidth > n.clientWidth)
  );
  assert.equal(cut, true, 'long names are truncated, not wrapped');
  assert.equal(await page.evaluate(() => document.querySelector('#landingWidgets .lw-stack').scrollWidth <= 549), true);

  // 11. Romanian: month title, weekday names and card titles are localized.
  await seed(page);
  await toggles(page, ALL);
  await page.evaluate(() => {
    localStorage.setItem('tvhome.language', 'ro');
    HomeI18n.refresh();
    HomeLanding.render();
  });
  const ro = await page.evaluate(() => ({
    month: document.querySelector('#landingWidgets .lw-month').textContent,
    days: Array.prototype.map.call(document.querySelectorAll('#landingWidgets .lw-weekday'), (c) => c.textContent),
    labels: Array.prototype.map.call(document.querySelectorAll('#landingWidgets .lw-label'), (c) => c.textContent)
  }));
  assert.match(ro.month, /^noiembrie 2026$/i);
  assert.equal(ro.days[0], 'Lun');
  assert.ok(ro.labels.includes('Onomastica'), ro.labels.join());
  g = await geo();
  assert.equal(overlap(g.grid, g.stack), false);
  assert.equal(overlap(g.weather, g.grid), false);
  await page.evaluate(() => {
    localStorage.removeItem('tvhome.language');
    HomeI18n.refresh();
  });

  // 12. Timers and requests (fake clock): hourly refresh at most, nothing with toggles OFF or scope off.
  await seed(page);
  await toggles(page, NONE);
  await page.clock.install({ time: new Date(2026, 10, 16, 23, 58, 0) });
  await page.evaluate(() => {
    HomeLanding.setClock(() => Date.now());
    window.__calls = { rates: 0, football: 0 };
  });
  await page.clock.runFor(3 * 3600000);
  assert.deepEqual(await page.evaluate(() => window.__calls), { rates: 0, football: 0 }, 'OFF: no refresh in 3 h');
  assert.equal((await state(page)).timer, false);
  await toggles(page, ALL);
  c0 = await page.evaluate(() => window.__calls);
  assert.ok(c0.rates >= 1 && c0.football === 1, 'first checks on activation: ' + JSON.stringify(c0));
  // Midnight passed: the grid highlights the new day after the minute timer.
  await page.evaluate(() => HomeCalendar.setClock(() => new Date()));
  await page.clock.runFor(3 * 60000);
  assert.equal(await page.locator('#landingWidgets .lw-today').textContent(), '17');
  await page.clock.runFor(2 * 3600000 + 5 * 60000);
  const afterTwoHours = await page.evaluate(() => window.__calls);
  assert.equal(afterTwoHours.football, 3, 'football: one refresh per hour, not more: ' + JSON.stringify(afterTwoHours));
  assert.ok(afterTwoHours.rates >= 100, 'the rates schedule is asked on the minute tick (it costs nothing unless a slot is due): ' + afterTwoHours.rates);
  await home.setScope(false);
  const before = await page.evaluate(() => window.__calls);
  await page.clock.runFor(3 * 3600000);
  assert.deepEqual(await page.evaluate(() => window.__calls), before, 'scope off: no refresh');
  assert.equal((await state(page)).timer, false);
  await toggles(page, NONE);
  assert.equal(requests, 0, 'no network request at all (the routes abort every http request)');
  // 13. The weather in its text (compact) format: the first visible text of the weather and of the grid still start on
  // one line, and nothing overlaps the weather block (the cards column gives way to its width).
  const home2 = await openHome({ mrRedify: true }),
    p2 = home2.page;
  await p2.context().addInitScript((seedJson) => {
    const w = JSON.parse(seedJson);
    w.caches['open-meteo'].updated = Date.now();
    w.preferred = 'text';
    localStorage.setItem('tvhome.weather.v1', JSON.stringify(w));
  }, JSON.stringify(WEATHER_SEED));
  await p2.reload();
  await p2.waitForFunction(() => window.RootLauncherRendered && window.HomeInfo);
  await home2.setScope(true);
  await p2.evaluate(() => HomeWeather.render());
  await seed(p2);
  await toggles(p2, ALL);
  await p2.evaluate(() => {
    document.getElementById('dockBand').style.top = '715px';
    HomeLanding.render();
  });
  const tx = await p2.evaluate(() => {
    const walker = (sel) => {
      const root = document.querySelector(sel);
      if (!root) return null;
      const w = document.createTreeWalker(root, 4, null, false);
      let t;
      while ((t = w.nextNode())) {
        if (!/\S/.test(t.nodeValue)) continue;
        const r = document.createRange();
        r.selectNodeContents(t);
        const b = r.getBoundingClientRect();
        if (b.height) return b.top;
      }
      return null;
    };
    const rc = (sel) => {
      const e = document.querySelector(sel);
      if (!e) return null;
      const b = e.getBoundingClientRect();
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
    };
    return {
      weatherText: walker('#homeWeather'),
      gridText: walker('#landingWidgets .lw-grid .lw-month'),
      stackText: walker('#landingWidgets .lw-stack .lw-label'),
      weather: rc('#homeWeather'),
      grid: rc('#landingWidgets .lw-grid'),
      stack: rc('#landingWidgets .lw-stack'),
      buttons: rc('#topButtons'),
      time: rc('#timeRow'),
      format: document.querySelector('#homeWeather .weather-header') ? 'full' : 'text'
    };
  });
  assert.equal(tx.format, 'text', 'weather in text format');
  assert.ok(tx.grid, 'grid shown next to the compact weather');
  assert.ok(Math.abs(tx.gridText - tx.weatherText) <= 2, 'first text lines: grid ' + tx.gridText + ' vs weather ' + tx.weatherText);
  if (tx.stack) assert.ok(Math.abs(tx.stackText - tx.weatherText) <= 2, 'first text lines: cards ' + tx.stackText);
  assert.ok(tx.weatherText <= tx.time.bottom + 30 && tx.weatherText >= tx.time.bottom - 4, 'under the date row: ' + tx.weatherText);
  [tx.grid, tx.stack].forEach((r) => {
    if (!r) return;
    assert.equal(overlap(r, tx.weather), false, 'no overlap with the compact weather');
    assert.equal(overlap(r, tx.buttons), false);
  });
  assert.deepEqual(home2.errors, [], 'page errors (text weather)');
  await home2.close();

  assert.deepEqual(home.errors, [], 'page errors');
  await home.close();
  console.log('PASS landing-ui');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
