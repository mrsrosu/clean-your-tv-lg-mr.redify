'use strict';
const assert = require('node:assert/strict'),
  { openHome } = require('./harness.cjs');
// Main-page widget cards (mr.redify only): visibility matrix, content, geometry at 1920x1080, timers and requests.
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
// Seeds every source and clock; the three toggles are set by the caller.
async function seed(page, opts) {
  opts = opts || {};
  await page.evaluate(
    ({ NOW, RATES, opts }) => {
      localStorage.clear();
      HomeCalendar.setClock(() => new Date(2026, 10, 16, 12, 0, 0));
      HomeFootball.setClock(() => new Date(NOW));
      HomeInfo.daily.set({ showHolidays: true, showNameDays: true });
      HomeInfo.calendar.set({
        events: opts.noEvents
          ? []
          : [
              {
                id: 'e1',
                day: 20,
                month: 11,
                title: 'Dentist appointment',
                yearly: true
              }
            ]
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
      HomeInfoFinance.refresh = () => {
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
// The real space between the header buttons and the app name (about 310 px) holds two small cards; the content tests
// give the stack room, the geometry test uses the real values too.
const room = (page, on) =>
  page.evaluate((v) => {
    const hero = document.getElementById('hero'),
      dock = document.getElementById('dockBand');
    window.__real = window.__real || { hero: hero.style.top, dock: dock.style.top };
    hero.style.top = v ? '1000px' : window.__real.hero;
    dock.style.top = v ? '1000px' : window.__real.dock;
  }, on);
const toggles = (page, on) =>
  page.evaluate((v) => {
    HomeInfo.calendar.set({ landing: v.calendar });
    HomeInfo.finance.set({ landing: v.rates });
    HomeInfo.football.set({ landing: v.football });
  }, on);
const state = (page) => page.evaluate(() => HomeLanding.state());
const visible = (page) => page.evaluate(() => HomeLanding.visible());
const ALL = { calendar: true, rates: true, football: true };
const NONE = { calendar: false, rates: false, football: false };

(async () => {
  const home = await openHome({ mrRedify: true }),
    page = home.page;
  let requests = 0;
  page.on('request', (r) => {
    if (/^https?:/.test(r.url())) requests++;
  });
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

  // 2. All ON: Calendar, Rates, Football in that order, with data.
  await toggles(page, ALL);
  s = await state(page);
  assert.deepEqual(s.cards, ['calendar', 'rates', 'football']);
  assert.equal(s.timer, true);
  assert.equal(await visible(page), true);
  const text = await page.evaluate(() => document.getElementById('landingWidgets').textContent);
  assert.match(text, /Monday, 16 November/);
  assert.match(text, /Dentist appointment/);
  assert.match(text, /20\.11/);
  assert.match(text, /EUR 5\.0912/);
  assert.match(text, /16\.11/, 'BNR date');
  assert.match(text, /Arsenal/);
  assert.match(text, /Live 34' · 2 - 1/);
  assert.match(text, /21\.11 \d\d:\d\d/);
  assert.match(text, /FT 0 - 3 · 14\.11/);
  assert.ok((await page.locator('#landingWidgets .lw-line').count()) >= 5);
  // First refresh happens once on activation (rates, football), none for the calendar.
  assert.deepEqual(await page.evaluate(() => window.__calls), { rates: 1, football: 1 });

  // 3. A card without data is left out, no error text.
  await seed(page, { noRates: true, noEvents: true });
  await toggles(page, ALL);
  s = await state(page);
  assert.deepEqual(s.cards, ['calendar', 'football']);
  await seed(page, { noFootball: true });
  await toggles(page, ALL);
  assert.deepEqual((await state(page)).cards, ['calendar', 'rates']);
  // Partial toggles.
  await seed(page);
  await toggles(page, { calendar: false, rates: true, football: false });
  assert.deepEqual((await state(page)).cards, ['rates']);

  // 4. Settings change re-renders at once (no clock needed).
  await page.evaluate(() => HomeInfo.calendar.set({ landing: true }));
  assert.deepEqual((await state(page)).cards, ['calendar', 'rates']);
  await page.evaluate(() => HomeInfo.finance.set({ landing: false }));
  assert.deepEqual((await state(page)).cards, ['calendar']);

  // 5. Cards are not focusable and do not take pointer events.
  await toggles(page, ALL);
  assert.equal(
    await page.evaluate(
      () => document.querySelectorAll('#landingWidgets button, #landingWidgets a, #landingWidgets [tabindex]').length
    ),
    0
  );
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('landingWidgets')).pointerEvents), 'none');

  // 6. Hidden while scrolled / editing / weather scrolled / idle screen / info panel / Settings / app picker.
  for (const cls of ['scrolled', 'editing', 'weather-scrolled', 'idle-active']) {
    await page.evaluate((c) => document.body.classList.add(c), cls);
    assert.equal(await visible(page), false, cls + ' hides the cards');
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

  // 7. Scope off (other theme / Classic): nothing, no timer; back on: cards again.
  await home.setScope(false);
  s = await state(page);
  assert.deepEqual(s.cards, []);
  assert.equal(s.timer, false);
  assert.equal(await visible(page), false);
  await home.setScope(true);
  assert.deepEqual((await state(page)).cards, ['calendar', 'rates', 'football']);

  // 8. Geometry at 1920x1080: right edge 1808, width 360, between the header buttons and the app name, no overlap.
  await seed(page);
  await toggles(page, ALL);
  const geo = () =>
    page.evaluate(() => {
      const r = (e) => {
        const b = e.getBoundingClientRect();
        return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width };
      };
      const host = document.getElementById('landingWidgets'),
        hero = document.getElementById('hero');
      return {
        host: r(host),
        buttons: r(document.getElementById('topButtons')),
        heroTop: hero.style.top ? parseFloat(hero.style.top) : null,
        heroRect: r(hero),
        cards: Array.prototype.map.call(host.children, (c) => ({ cls: c.className, ...r(c) }))
      };
    });
  let g = await geo();
  assert.equal(g.host.right, 1808, 'right edge = header buttons right edge');
  assert.equal(g.host.width, 360);
  assert.ok(g.cards.length >= 1);
  assert.equal(g.buttons.right, 1808);
  g.cards.forEach((c) => {
    assert.ok(c.top >= g.buttons.bottom, 'below the header buttons');
    assert.equal(c.right, 1808);
    assert.equal(c.width, 360);
    if (g.heroTop !== null) assert.ok(c.bottom <= g.heroTop, 'above the app name: ' + c.bottom + ' <= ' + g.heroTop);
  });
  for (let i = 1; i < g.cards.length; i++) {
    const gap = g.cards[i].top - g.cards[i - 1].bottom;
    assert.ok(gap >= 12 && gap <= 16, 'about 14 px gap: ' + gap);
  }
  // The real positions of this layout (app name at 532): at least two cards fit, none touches the app name.
  await room(page, false);
  await page.evaluate(() => HomeLanding.render());
  g = await geo();
  assert.ok(g.cards.length >= 2, 'real space holds at least two cards: ' + g.cards.length);
  assert.ok(g.heroTop > 400 && g.heroTop < 700, 'hero position as in dock-grid: ' + g.heroTop);
  const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  g.cards.forEach((c) => {
    assert.ok(c.bottom <= g.heroTop, 'above the app name');
    assert.equal(overlap(c, g.heroRect), false, 'no overlap with the app name');
    assert.equal(overlap(c, g.buttons), false, 'no overlap with the header buttons');
  });
  assert.equal(overlap(g.host, g.buttons), false);
  await room(page, true);
  await page.evaluate(() => HomeLanding.render());

  await page.evaluate(() => {
    const hero = document.getElementById('hero');
    hero.textContent = hero.textContent || 'Some App';
    hero.style.top = '400px';
    HomeLanding.render();
  });
  g = await geo();
  const kept = g.cards.length;
  g.cards.forEach((c) => assert.ok(c.bottom <= 400, 'inside the shorter space'));
  assert.ok(kept < 3, 'cards dropped when they do not fit: ' + kept);
  const names = await page.evaluate(() => HomeLanding.state().cards);
  assert.deepEqual(names, ['calendar', 'rates', 'football'].slice(0, kept), 'dropped from the end');
  await page.evaluate(() => {
    document.getElementById('hero').style.top = '60px'; // nothing fits
    HomeLanding.render();
  });
  assert.deepEqual(await page.evaluate(() => HomeLanding.state().cards), []);
  assert.equal(await page.evaluate(() => document.getElementById('landingWidgets').hidden), true);
  await page.evaluate(() => {
    document.getElementById('hero').style.top = '';
    HomeLanding.render();
  });

  // 9. Long team names: the card keeps its width, names are cut with an ellipsis.
  await seed(page, { long: true });
  await toggles(page, { calendar: false, rates: false, football: true });
  g = await geo();
  assert.equal(g.cards[0].width, 360);
  const cut = await page.evaluate(() =>
    Array.prototype.some.call(document.querySelectorAll('#landingWidgets .lw-name'), (n) => n.scrollWidth > n.clientWidth)
  );
  assert.equal(cut, true, 'long names are truncated, not wrapped');
  assert.equal(
    await page.evaluate(() => document.getElementById('landingWidgets').scrollWidth <= 360),
    true
  );

  // 10. Timers and requests (fake clock): hourly refresh at most, nothing with toggles OFF or scope off.
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
  assert.deepEqual(await page.evaluate(() => window.__calls), { rates: 1, football: 1 }, 'first refresh on activation');
  // Midnight passed: the calendar title shows the new date (own clock) after the minute timer.
  await page.evaluate(() => HomeCalendar.setClock(() => new Date()));
  await page.clock.runFor(3 * 60000);
  assert.match(await page.locator('#landingWidgets .lw-calendar .lw-label').textContent(), /^Tuesday, 17 November/);
  await page.clock.runFor(2 * 3600000 + 5 * 60000);
  const afterTwoHours = await page.evaluate(() => window.__calls);
  assert.deepEqual(afterTwoHours, { rates: 3, football: 3 }, 'one refresh per hour, not more: ' + JSON.stringify(afterTwoHours));
  await home.setScope(false);
  const before = await page.evaluate(() => window.__calls);
  await page.clock.runFor(3 * 3600000);
  assert.deepEqual(await page.evaluate(() => window.__calls), before, 'scope off: no refresh');
  assert.equal((await state(page)).timer, false);
  await toggles(page, NONE);
  assert.equal(requests, 0, 'no network request at all (the routes abort every http request)');
  assert.deepEqual(home.errors, [], 'page errors');
  await home.close();
  console.log('PASS landing-ui');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
