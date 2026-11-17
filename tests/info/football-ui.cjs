'use strict';
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  { openHome } = require('./harness.cjs');
const fx = (n) =>
  fs.readFileSync('tests/info/fixtures/espn-' + n + '.json', 'utf8');
const sdb = (n) =>
  fs.readFileSync('tests/info/fixtures/sportsdb-' + n + '.json', 'utf8');
const TEAM = { competition: 'eng.1', id: '359', name: 'Arsenal' };
// Football page (info panel) and Football tab, mr.redify scope; ESPN answered from fixtures (no live internet).
(async () => {
  const home = await openHome({ mrRedify: true }),
    page = home.page,
    seen = [],
    state = { mode: 'normal' };
  const liveBoard = JSON.stringify({
    events: [
      {
        id: '900',
        date: '2026-11-21T12:00Z',
        competitions: [
          {
            id: '900',
            status: {
              displayClock: "34'",
              type: { state: 'in', completed: false }
            },
            competitors: [
              {
                homeAway: 'home',
                score: '2',
                team: { id: '359', displayName: 'Arsenal' }
              },
              {
                homeAway: 'away',
                score: '1',
                team: { id: '306', displayName: 'Hull City' }
              }
            ]
          }
        ]
      }
    ]
  });
  await page.route(/^https:\/\/site\.api\.espn\.com\//, (route) => {
    const url = route
      .request()
      .url()
      .replace(/^.*\/soccer\//, '');
    seen.push(url);
    if (state.mode === 'offline') return route.abort();
    const body = /\/scoreboard$/.test(url)
      ? state.mode === 'live'
        ? liveBoard
        : fx('scoreboard')
      : /\/teams$/.test(url)
        ? fx('teams')
        : /fixture=true$/.test(url)
          ? fx('fixtures')
          : /\/schedule$/.test(url)
            ? fx('schedule')
            : null;
    if (body === null) return route.fulfill({ status: 404, body: '' });
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body
    });
  });
  // Liga 1 (rou.1) comes from TheSportsDB, answered from fixtures too.
  const sdbSeen = [];
  await page.route(/^https:\/\/www\.thesportsdb\.com\//, (route) => {
    const url = route.request().url();
    sdbSeen.push(url);
    const body = /eventsnextleague/.test(url)
      ? sdb('next')
      : /eventspastleague/.test(url)
        ? sdb('past')
        : /eventsround\.php\?id=4691&r=15&/.test(url)
          ? sdb('round15')
          : /eventsround\.php\?id=4691&r=16&/.test(url)
            ? sdb('round16')
            : null;
    if (state.mode === 'offline' || body === null)
      return route.fulfill({ status: 404, body: '' });
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body
    });
  });
  await page.evaluate(() => {
    // Timer bookkeeping: refresh timers are the 60 s / hourly setTimeout ones.
    const set = window.setTimeout,
      clear = window.clearTimeout;
    window.__ids = {};
    window.__delays = [];
    window.setTimeout = function (fn, ms) {
      const id = set.apply(window, arguments);
      if (ms === 60000 || ms === 3600000) {
        window.__ids[id] = ms;
        window.__delays.push(ms);
      }
      return id;
    };
    window.clearTimeout = function (id) {
      delete window.__ids[id];
      return clear.call(window, id);
    };
  });
  const setup = async (config, mode) => {
    state.mode = mode || 'normal';
    seen.length = 0;
    await page.evaluate((config) => {
      InfoPanel.close();
      Object.keys(localStorage)
        .filter((k) => /^tvhome\.(football|cache\.v1\.fb\.)/.test(k))
        .forEach((k) => localStorage.removeItem(k));
      if (config) HomeInfo.football.set(config);
      window.__delays = [];
      HomeFootball.setClock(() => new Date('2026-11-21T10:00:00Z'));
    }, config || null);
  };
  const open = async () => {
    await page.evaluate(() => InfoPanel.open());
    await page.locator('#infoPanel .info-tab', { hasText: 'Football' }).click();
  };
  const text = () => page.locator('#infoPanel .fb-page').innerText();
  // The football scheduler's single timer (its delay varies: hourly, kickoff wake-up, live cadence).
  const timers = () => page.evaluate(() => (HomeFootball.schedulerState().timer ? ['scheduler'] : []));
  const full = { competitions: ['eng.1'], teams: [TEAM] };

  // 1. Nothing configured: friendly message, no request, no timer-triggered fetch.
  await setup();
  await open();
  assert.match(await text(), /Choose teams in Settings/);
  assert.equal(seen.length, 0, 'no request without configuration');

  // 2. Followed team (next, last) and today's matches; no standings.
  await setup(full);
  await open();
  await page.waitForSelector('#infoPanel .fb-team .fb-next');
  const t2 = await text();
  assert.match(t2, /Arsenal/);
  assert.match(
    await page.locator('#infoPanel .fb-next').innerText(),
    /Newcastle United/
  );
  assert.match(
    await page.locator('#infoPanel .fb-last').innerText(),
    /\d+-\d+/
  );
  assert.equal(await page.locator('#infoPanel .fb-live').count(), 0);
  assert.match(t2, /Today's matches/);
  assert.match(t2, /Premier League/);
  assert.equal(await page.locator('#infoPanel .fb-match').count(), 2);
  assert.doesNotMatch(t2, /standing|table|points|Pts/i, 'no standings');
  assert.deepEqual(
    await timers(),
    ['scheduler'],
    'one scheduler timer while shown'
  );
  assert.equal(
    seen.filter((u) => /eng\.1\/(scoreboard|teams\/359\/schedule)/.test(u))
      .length,
    3
  );

  // 3. Live match: score and clock shown, 60 s timer.
  await setup(full, 'live');
  await open();
  await page.waitForSelector('#infoPanel .fb-team .fb-live');
  const live = await page.locator('#infoPanel .fb-team .fb-live').innerText();
  assert.match(live, /34'/);
  assert.match(live, /Arsenal 2-1 Hull City/);
  assert.deepEqual(await timers(), ['scheduler']);
  assert.equal(await page.locator('#infoPanel .fb-match.fb-live').count(), 1);

  // 4. Timers: none once hidden (page switch) or closed; none and no request once the scope is off.
  await page.keyboard.press('ArrowLeft');
  assert.equal(
    await page.locator('#infoPanel .fin-page').isVisible(),
    true,
    'Left falls through to the previous page'
  );
  assert.deepEqual(await timers(), [], 'no timer once hidden');
  await page.locator('#infoPanel .info-tab', { hasText: 'Football' }).click();
  assert.deepEqual(await timers(), ['scheduler']);
  await page.keyboard.press('ArrowRight');
  assert.equal(
    await page.locator('#infoPanel .fb-page').isVisible(),
    true,
    'Right at the last page stays'
  );
  await home.setScope(false);
  assert.equal(await page.evaluate(() => InfoPanel.isOpen()), false);
  assert.deepEqual(await timers(), [], 'no timer with the scope off');
  const count = seen.length;
  await page.waitForTimeout(300);
  assert.equal(seen.length, count, 'no request with the scope off');
  await home.setScope(true);

  // 5. Offline: cached values and "last updated"; no cache: neutral message.
  await setup(full);
  await open();
  await page.waitForSelector('#infoPanel .fb-team .fb-next');
  await page.evaluate(() => {
    InfoPanel.close();
    Object.keys(localStorage)
      .filter((k) => k.indexOf('tvhome.cache.v1.fb.') === 0)
      .forEach((k) => {
        const e = JSON.parse(localStorage.getItem(k));
        e.fetchedAt -= 3 * 3600000;
        localStorage.setItem(k, JSON.stringify(e));
      });
  });
  state.mode = 'offline';
  await open();
  await page.waitForFunction(() =>
    /Last updated/.test(document.querySelector('#infoPanel .fb-page').innerText)
  );
  assert.match(await text(), /Offline/);
  assert.match(
    await page.locator('#infoPanel .fb-next').innerText(),
    /Newcastle United/
  );
  await setup(full, 'offline');
  await open();
  await page.waitForFunction(() =>
    /unavailable/i.test(document.querySelector('#infoPanel .fb-page').innerText)
  );
  assert.equal(await page.locator('#infoPanel .fb-team .fb-next').count(), 0);
  assert.deepEqual(await timers(), ['scheduler']);
  await page.evaluate(() => InfoPanel.close());

  // 6. Tab: real tab, nothing fetched before it is used; teams come from the ticked competitions.
  await setup();
  await page.evaluate(() => RenewalPanel.open());
  await page.locator('[data-category="football"]').click();
  const pane = page.locator('#settings-pane-football');
  assert.equal(await pane.isVisible(), true);
  assert.equal(
    await pane.locator('.fb-comp-chip').count(),
    9, // eight leagues + the National teams group
    'real tab with the eight competitions and the national-teams group'
  );
  assert.equal(seen.length, 0, 'nothing fetched at build or on opening');
  const comp = (name) => pane.locator('.fb-comp-chip', { hasText: name });
  await comp('Premier League').click();
  assert.deepEqual(
    await page.evaluate(() => HomeInfo.football.get().competitions),
    ['eng.1']
  );
  assert.equal(
    await comp('Premier League').getAttribute('aria-pressed'),
    'true'
  );
  await pane.locator('.fb-team-chip').first().waitFor();
  assert.equal(await pane.locator('.fb-team-chip').count(), 6);
  assert.deepEqual(
    seen.filter((u) => /\/teams$/.test(u)),
    ['eng.1/teams']
  );
  assert.equal(
    await page.evaluate(() =>
      document.activeElement.className.includes('fb-comp-chip')
    ),
    true,
    'focus stays on the chip'
  );
  const team = (name) =>
    pane.locator('.fb-team-chip', { hasText: new RegExp('^' + name + '$') });
  await team('Arsenal').click();
  assert.deepEqual(
    await page.evaluate(() =>
      HomeInfo.football
        .get()
        .teams.map((t) => t.competition + ':' + t.id + ':' + t.name)
    ),
    ['eng.1:359:Arsenal']
  );
  assert.equal(
    await pane.locator('.fb-team-chip', { hasText: /^Arsenal$/ }).count(),
    0,
    'followed teams leave the list'
  );
  assert.equal(await pane.locator('.fb-followed').count(), 1);
  assert.equal(
    await page.evaluate(() =>
      document.activeElement.className.includes('fb-followed')
    ),
    true,
    'focus follows the team to the followed list'
  );
  for (const n of [
    'AFC Bournemouth',
    'Aston Villa',
    'Brentford',
    'Brighton & Hove Albion'
  ])
    await team(n).click();
  assert.equal(
    await page.evaluate(() => HomeInfo.football.get().teams.length),
    5
  );
  await team('Chelsea').click();
  assert.equal(
    await page.evaluate(() => HomeInfo.football.get().teams.length),
    5,
    'at most 5'
  );
  assert.match(await pane.locator('.fb-status').innerText(), /At most 5 teams/);
  await pane.locator('.fb-followed', { hasText: 'Brentford' }).click();
  assert.equal(
    await page.evaluate(() => HomeInfo.football.get().teams.length),
    4
  );
  assert.equal(
    await team('Brentford').count(),
    1,
    'removed team can be chosen again'
  );
  await comp('Premier League').click();
  assert.deepEqual(
    await page.evaluate(() => HomeInfo.football.get().competitions),
    []
  );
  assert.equal(
    await pane.locator('.fb-followed').count(),
    4,
    'followed teams stay when a competition is unticked'
  );
  assert.equal(
    seen.filter((u) => /\/teams$/.test(u)).length,
    1,
    'team list loaded once'
  );

  // 7. A failed team list shows a message and is not retried in a loop.
  await setup(null, 'offline');
  await comp('La Liga').click();
  await page.waitForFunction(() =>
    /unavailable/i.test(
      document.querySelector('#settings-pane-football').innerText
    )
  );
  const afterFail = seen.length;
  assert.ok(
    afterFail >= 1 && afterFail <= 2,
    'one load (http retries once on a network error)'
  );
  await page.waitForTimeout(300);
  assert.equal(
    seen.length,
    afterFail,
    'a failed load is not retried in a loop'
  );

  // 8. Corrupt store: defaults.
  await page.evaluate(() =>
    localStorage.setItem(
      'tvhome.football.v1',
      '{"competitions":["x"],"teams":{"a":1}}'
    )
  );
  assert.deepEqual(await page.evaluate(() => HomeInfo.football.get()), {
    competitions: [],
    teams: [],
    landing: false
  });

  await page.evaluate(() => document.getElementById('renewalClose').click());
  // 9. Liga 1 from TheSportsDB next to a Premier League team (both providers mocked), an old ESPN-id team re-matched.
  await setup({
    competitions: ['eng.1', 'rou.1'],
    teams: [TEAM, { competition: 'rou.1', id: '3000', name: 'FCSB' }]
  });
  sdbSeen.length = 0;
  await open();
  await page.waitForSelector('#infoPanel .fb-team .fb-next >> nth=1');
  const t9 = await text();
  assert.match(t9, /Arsenal/);
  assert.match(t9, /FCSB/);
  assert.match(t9, /Argeș Pitești/, 'FCSB next match from SportsDB');
  assert.match(t9, /Liga 1 România/, "Liga 1 in today's matches");
  assert.ok(sdbSeen.length >= 4 && sdbSeen.length <= 8, 'sportsdb requests');
  assert.equal(
    seen.filter((u) => /^rou\.1\//.test(u)).length,
    0,
    'no ESPN request for rou.1'
  );
  assert.equal(
    await page.evaluate(() => HomeInfo.football.get().teams[1].id),
    '134005',
    'old team id re-resolved by name'
  );

  // M8: the "not started" separator goes through HomeI18n.t ("vs"); status codes are covered in football.cjs (clockText).
  await setup(full);
  await open();
  await page.waitForSelector('#infoPanel .fb-match');
  assert.equal(
    (await page.locator('#infoPanel .fb-match .fb-score').first().innerText()).trim(),
    'vs'
  );
  await page.evaluate(() => InfoPanel.close());

  assert.deepEqual(home.errors, [], 'no page errors');
  await home.close();
  console.log('PASS football-ui');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
