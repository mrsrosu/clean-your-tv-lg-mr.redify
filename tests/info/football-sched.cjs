'use strict';
// Football scheduler (variant B): hourly base, kickoff wake-up, narrow live refresh, caps, backoff, consumers.
// Injected clock and timers, a fake network that counts requests per host.
const strict = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm');
const assert = Object.assign((v, m) => strict(v, m), strict, {
  deepEqual: (a, b) => strict.deepEqual(JSON.parse(JSON.stringify(a)), b)
});
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer/',
  SDB = 'https://www.thesportsdb.com/api/v1/json/123/',
  T0 = Date.parse('2026-11-16T10:00:00Z'),
  MIN = 60000,
  flush = async () => {
    for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
  };
function memory(seed) {
  const data = Object.assign({}, seed);
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem(k, v) {
      data[k] = String(v);
    }
  };
}
// A world: fake time, timers, document, XHR, the football modules.
function world(routes, opts) {
  opts = opts || {};
  let now = T0,
    seq = 0,
    timers = [];
  const listeners = {},
    state = { scope: true },
    surface = { classList: { contains: (c) => state.scope && c === 'ctv-mr-redify' } },
    document = {
      hidden: false,
      getElementById: () => surface,
      addEventListener(name, cb) {
        (listeners[name] = listeners[name] || []).push(cb);
      },
      readyState: 'complete'
    },
    requests = [];
  function XHR() {}
  XHR.prototype.open = function (m, url) {
    this.url = url;
  };
  XHR.prototype.send = function () {
    const self = this,
      url = this.url;
    requests.push({ url, at: now, host: /espn/.test(url) ? 'espn' : /thesportsdb/.test(url) ? 'sdb' : 'other' });
    Promise.resolve().then(() => {
      let body = routes[url];
      if (typeof body === 'function') body = body(url);
      if (body === 'err') {
        self.status = 500;
        self.onload();
      } else if (body === undefined) {
        self.status = 404;
        self.onload();
      } else {
        self.status = 200;
        self.responseText = body;
        self.onload();
      }
    });
  };
  const ctx = {
    document,
    localStorage: opts.storage || memory(),
    Promise,
    XMLHttpRequest: XHR,
    setTimeout(fn, ms) {
      timers.push({ id: ++seq, at: now + ms, fn });
      return seq;
    },
    clearTimeout(id) {
      timers = timers.filter((t) => t.id !== id);
    }
  };
  ctx.window = ctx;
  for (const f of ['info-store', 'info-fetch', 'football-espn', 'football-sportsdb', 'football'])
    vm.runInNewContext(fs.readFileSync('launcher/' + f + '.js', 'utf8'), ctx);
  ctx.HomeFootball.setClock(() => new Date(now));
  const w = {
    ctx,
    requests,
    state,
    document,
    now: () => now,
    pending: () => timers.length,
    // Advances the clock, firing timers in order.
    async run(ms) {
      const end = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > end) break;
        timers.shift();
        now = Math.max(now, next.at);
        next.fn();
        await flush();
      }
      now = end;
      await flush();
    },
    count(host, from, to) {
      return requests.filter((r) => (!host || r.host === host) && (from === undefined || r.at >= from) && (to === undefined || r.at < to)).length;
    },
    urls(from, to) {
      return requests.filter((r) => (from === undefined || r.at >= from) && (to === undefined || r.at < to)).map((r) => r.url.replace(ESPN, 'E:').replace(SDB, 'S:'));
    },
    scope(on) {
      state.scope = on;
      (listeners['ctv-scope'] || []).forEach((cb) => cb({}));
    },
    hidden(h) {
      document.hidden = h;
      (listeners.visibilitychange || []).forEach((cb) => cb({}));
    }
  };
  return w;
}
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');
// ESPN event factory (scoreboard and schedule share it).
function espnEvent(id, home, away, st, hs, as, startMs) {
  return {
    id,
    date: iso(startMs).replace(':00Z', 'Z'),
    competitions: [
      {
        id,
        status: { displayClock: st === 'in' ? "34'" : "0'", type: { state: st, completed: st === 'post' } },
        competitors: [
          { homeAway: 'home', score: String(hs), team: { id: home[0], displayName: home[1] } },
          { homeAway: 'away', score: String(as), team: { id: away[0], displayName: away[1] } }
        ]
      }
    ]
  };
}
const ARS = ['359', 'Arsenal'],
  HUL = ['306', 'Hull City'];
// A mutable ESPN match in eng.1: scoreboard, schedule and fixture routes read the same state.
function espnWorld(startMs, opts) {
  let w = null;
  // Before kickoff the provider says "pre" whatever the test wants the match to become later.
  const m = { st: 'pre', hs: 0, as: 0 },
    ev = () => espnEvent('m1', ARS, HUL, w && w.now() < startMs ? 'pre' : m.st, m.hs, m.as, startMs),
    routes = {
      [ESPN + 'eng.1/scoreboard']: () => JSON.stringify({ events: [ev()] }),
      [ESPN + 'eng.1/teams/359/schedule']: () => JSON.stringify({ events: [ev()] }),
      [ESPN + 'eng.1/teams/359/schedule?fixture=true']: JSON.stringify({ events: [] })
    };
  w = world(routes, opts);
  w.match = m;
  w.routes = routes;
  w.ctx.HomeInfo.football.set({ competitions: ['eng.1'], teams: [{ competition: 'eng.1', id: '359', name: 'Arsenal' }] });
  return w;
}
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('no consumer: no timer, no request (a configured team alone does nothing)', async () => {
  const w = espnWorld(T0 + 30 * MIN);
  await w.run(3 * 3600000);
  assert.equal(w.requests.length, 0);
  assert.equal(w.pending(), 0);
  assert.equal(w.ctx.HomeFootball.schedulerState().timer, false);
});
test('hourly base cadence with a consumer: one full refresh at attach, the next after an hour, nothing between', async () => {
  const w = espnWorld(T0 + 5 * 3600000); // kickoff far away
  w.ctx.HomeFootball.attach('page');
  await flush();
  assert.equal(w.count('espn'), 3, 'scoreboard + schedule + fixtures at attach');
  await w.run(59 * MIN);
  assert.equal(w.count('espn'), 3, 'nothing for 59 minutes');
  await w.run(2 * MIN);
  assert.equal(w.count('espn'), 6, 'the hourly full refresh');
  await w.run(58 * MIN);
  assert.equal(w.count('espn'), 6, 'nothing until the next hour (at 120 min)');
  await w.run(2 * MIN);
  assert.equal(w.count('espn'), 9, 'and the next hourly one');
});
test('kickoff wake-up: a followed match inside the hour wakes the scheduler at kickoff + 60 s', async () => {
  const start = T0 + 30 * MIN,
    w = espnWorld(start);
  w.ctx.HomeFootball.attach('page');
  await flush();
  const after = w.requests.length;
  await w.run(30 * MIN + 59000); // 59 s after kickoff
  assert.equal(w.requests.length, after, 'nothing before kickoff + 60 s');
  w.match.st = 'in';
  w.match.hs = 1;
  await w.run(2000);
  assert.deepEqual(w.urls(start + 59000), ['E:eng.1/scoreboard'], 'one scoreboard request at kickoff + 60 s');
  assert.equal(w.ctx.HomeFootball.landingItems()[0].kind, 'live', 'the start is noticed within a minute');
});
test('live window: exactly one scoreboard request per 60 s while the match is possibly live, no team schedules', async () => {
  const start = T0 + 5 * MIN,
    w = espnWorld(start);
  w.match.st = 'in';
  w.ctx.HomeFootball.attach('page');
  await flush();
  await w.run(5 * MIN + 1000); // up to just after kickoff
  const from = w.now();
  await w.run(10 * MIN);
  const got = w.requests.filter((r) => r.at >= from);
  assert.ok(got.every((r) => r.url === ESPN + 'eng.1/scoreboard'), 'only the scoreboard: ' + w.urls(from).join());
  assert.ok(got.length >= 9 && got.length <= 11, '10 minutes = about 10 requests: ' + got.length);
  // Every poll is ~60 s after the previous one.
  for (let i = 1; i < got.length; i++) assert.ok(got[i].at - got[i - 1].at >= 59000 && got[i].at - got[i - 1].at <= 62000, 'cadence ' + (got[i].at - got[i - 1].at));
  // Ends at post.
  w.match.st = 'post';
  w.match.hs = 2;
  await w.run(2 * MIN);
  const endAt = w.now();
  await w.run(20 * MIN);
  assert.equal(w.count('espn', endAt + 1000), 0, 'no more live requests after the match ended');
  assert.equal(w.ctx.HomeFootball.landingItems()[0].kind, 'last');
});
test('live window ends at kickoff + 130 minutes even if the provider never says post', async () => {
  const start = T0 + 2 * MIN,
    w = espnWorld(start);
  w.match.st = 'in';
  w.ctx.HomeFootball.attach('page');
  await flush();
  await w.run(133 * MIN);
  const afterEnd = w.now();
  await w.run(10 * MIN);
  // A live poll is a scoreboard request alone; the hourly full refresh asks the schedules at the same instant.
  const livePolls = (from, to) =>
    w.requests.filter((r) => r.at >= from && r.at < to && r.url === ESPN + 'eng.1/scoreboard' && !w.requests.some((q) => q.at === r.at && /schedule/.test(q.url))).length;
  assert.equal(livePolls(afterEnd, afterEnd + 10 * MIN), 0, 'no live polling after the window (the hourly refresh may still run)');
  const inWindow = livePolls(start, start + 130 * MIN);
  assert.ok(inWindow >= 125 && inWindow <= 131, 'about one per minute for 130 minutes: ' + inWindow);
});
test('no followed match in or about to enter the window: no live polling at all', async () => {
  const w = espnWorld(T0 + 90 * MIN); // kickoff in 90 minutes
  w.ctx.HomeFootball.attach('page');
  await flush();
  const first = w.requests.length;
  await w.run(59 * MIN);
  assert.equal(w.requests.length, first);
  // The hourly refresh at +60 min brings the kickoff inside the hour: the wake-up is planned.
  await w.run(2 * MIN);
  assert.ok(w.requests.length > first);
  const before = w.requests.length;
  await w.run(28 * MIN + 59000);
  assert.equal(w.requests.length, before, 'still waiting for kickoff + 60 s');
});
// Liga 1 (TheSportsDB): the round that holds the live match.
function sdbEvent(id, hid, aid, status, startMs, rnd, hs, as) {
  const d = new Date(startMs);
  return {
    idEvent: id,
    strHomeTeam: 'Home' + hid,
    strAwayTeam: 'Away' + aid,
    idHomeTeam: hid,
    idAwayTeam: aid,
    intHomeScore: status === 'NS' ? null : String(hs || 0),
    intAwayScore: status === 'NS' ? null : String(as || 0),
    dateEvent: d.toISOString().slice(0, 10),
    strTime: d.toISOString().slice(11, 19),
    strStatus: status,
    strProgress: status === '1H' ? "30'" : '',
    intRound: String(rnd),
    strSeason: '2026-2027'
  };
}
function sdbWorld(startMs, rounds) {
  rounds = rounds || [16];
  let w = null;
  const m = { st: 'NS', hs: 0, as: 0 },
    routes = {
      [SDB + 'eventsnextleague.php?id=4691']: JSON.stringify({ events: [{ intRound: '16', strSeason: '2026-2027' }] }),
      [SDB + 'eventspastleague.php?id=4691']: JSON.stringify({ events: [{ intRound: '15', strSeason: '2026-2027' }] })
    };
  for (let r = 13; r <= 18; r++)
    routes[SDB + 'eventsround.php?id=4691&r=' + r + '&s=2026-2027'] = () =>
      JSON.stringify({
        events: rounds.indexOf(r) >= 0 ? [sdbEvent('s' + r, '70' + r, '80' + r, w && w.now() < startMs ? 'NS' : m.st, startMs, r, m.hs, m.as), sdbEvent('x' + r, '9' + r, '10' + r, 'NS', startMs + 86400000, r)] : []
      });
  w = world(routes);
  w.match = m;
  w.routes = routes;
  w.ctx.HomeInfo.football.set({ teams: rounds.map((r) => ({ competition: 'rou.1', id: '70' + r, name: 'Home70' + r })) });
  return w;
}
test('Liga 1: only the round that holds the live match, one request per 120 s; no anchor, no other round', async () => {
  const start = T0 + 3 * MIN,
    w = sdbWorld(start);
  w.ctx.HomeFootball.attach('page');
  await flush();
  assert.equal(w.count('sdb'), 8, 'the first full refresh: 2 anchors + 2 hot + 4 cold rounds');
  await w.run(3 * MIN + 61000); // kickoff + 60 s: pre until TheSportsDB updates
  const from = w.now() - 2000;
  w.match.st = '1H';
  await w.run(10 * MIN);
  const got = w.requests.filter((r) => r.at >= from);
  assert.ok(got.length >= 4 && got.length <= 6, '10 minutes at 120 s: ' + got.length);
  assert.ok(got.every((r) => r.url === SDB + 'eventsround.php?id=4691&r=16&s=2026-2027'), 'only round 16: ' + w.urls(from).join());
  assert.equal(w.ctx.HomeFootball.landingItems()[0].kind, 'live', 'pre -> in followed');
  assert.equal(w.ctx.HomeFootball.landingItems()[0].match.round, 16);
  w.match.st = 'FT';
  w.match.hs = 2;
  await w.run(6 * MIN);
  assert.equal(w.ctx.HomeFootball.landingItems()[0].kind, 'last', 'in -> post');
  const e = w.now();
  await w.run(30 * MIN);
  assert.equal(w.count('sdb', e + 1000), 0, 'stopped at post');
});
test('Romania national team: the scoreboard of the league of the live match (not the schedules)', async () => {
  const start = T0 + 2 * MIN,
    ro = ['473', 'Romania'],
    m = { st: 'pre', hs: 0, as: 0 },
    ev = () => espnEvent('n9', ro, ['578', 'Wales'], m.st, m.hs, m.as, start),
    routes = {};
  ['fifa.friendly', 'fifa.worldq.uefa', 'uefa.nations', 'uefa.euro'].forEach((slug) => {
    routes[ESPN + slug + '/teams/473/schedule'] = () => JSON.stringify({ events: slug === 'fifa.friendly' ? [ev()] : [] });
  });
  routes[ESPN + 'fifa.friendly/teams/473/schedule?fixture=true'] = JSON.stringify({ events: [] });
  routes[ESPN + 'fifa.friendly/scoreboard'] = () => JSON.stringify({ events: [ev()] });
  const w = world(routes);
  w.ctx.HomeInfo.football.set({ competitions: ['nat'], teams: [{ competition: 'nat', id: '473', name: 'Romania' }] });
  w.ctx.HomeFootball.attach('card');
  await flush();
  assert.equal(w.count('espn'), 5, 'first full refresh: 4 league schedules + 1 fixture list');
  await w.run(2 * MIN + 61000);
  const from = w.now() - 5000;
  m.st = 'in';
  m.hs = 1;
  await w.run(5 * MIN);
  const got = w.requests.filter((r) => r.at >= from);
  assert.ok(got.length >= 4 && got.length <= 6, 'about one per minute: ' + got.length);
  assert.ok(got.every((r) => r.url === ESPN + 'fifa.friendly/scoreboard'), 'league scoreboard only: ' + w.urls(from).join());
  assert.equal(w.ctx.HomeFootball.landingItems()[0].kind, 'live');
  assert.equal(w.ctx.HomeFootball.landingItems()[0].match.league, 'fifa.friendly');
});
test('two live competitions at once: ESPN every 60 s and Liga 1 every 120 s, each its own request', async () => {
  const start = T0 + 2 * MIN,
    w = sdbWorld(start);
  const m = { st: 'in', hs: 0, as: 0 };
  w.routes[ESPN + 'eng.1/scoreboard'] = () => JSON.stringify({ events: [espnEvent('m1', ARS, HUL, m.st, 1, 0, start)] });
  w.routes[ESPN + 'eng.1/teams/359/schedule'] = () => JSON.stringify({ events: [espnEvent('m1', ARS, HUL, m.st, 1, 0, start)] });
  w.routes[ESPN + 'eng.1/teams/359/schedule?fixture=true'] = JSON.stringify({ events: [] });
  w.match.st = '1H';
  w.ctx.HomeInfo.football.set({ teams: [{ competition: 'rou.1', id: '7016', name: 'Home7016' }, { competition: 'eng.1', id: '359', name: 'Arsenal' }] });
  w.ctx.HomeFootball.attach('page');
  await flush();
  await w.run(3 * MIN);
  const from = w.now();
  await w.run(10 * MIN);
  assert.ok(w.count('espn', from) >= 9 && w.count('espn', from) <= 11, 'ESPN: ' + w.count('espn', from));
  assert.ok(w.count('sdb', from) >= 4 && w.count('sdb', from) <= 6, 'SportsDB: ' + w.count('sdb', from));
});
test('per-host caps with deferral: at most 3 TheSportsDB requests in any minute of live polling, nothing dropped', async () => {
  const start = T0 + 2 * MIN,
    w = sdbWorld(start, [14, 15, 16, 17, 18]);
  w.match.st = '1H';
  w.ctx.HomeFootball.attach('page');
  await flush();
  await w.run(3 * MIN);
  const from = w.now(); // five live rounds (five followed teams)
  await w.run(8 * MIN);
  const live = w.requests.filter((r) => r.at >= from);
  for (let t = from; t < from + 7 * MIN; t += 15000) {
    const inMinute = live.filter((r) => r.at >= t && r.at < t + MIN).length;
    assert.ok(inMinute <= 3, 'at most 3 per minute, found ' + inMinute + ' at +' + (t - from) / 1000 + ' s');
  }
  const rounds = new Set(live.map((r) => /r=(\d+)/.exec(r.url)[1]));
  assert.equal(rounds.size, 5, 'every live round was served (deferred, not dropped): ' + [...rounds]);
});
test('backoff: after an HTTP error the provider is left alone for 3 minutes, cached data stays, then it resumes', async () => {
  const start = T0 + 2 * MIN,
    w = espnWorld(start);
  w.match.st = 'in';
  w.ctx.HomeFootball.attach('page');
  await flush();
  await w.run(4 * MIN); // the kickoff poll at +3 min saw the match live
  const sb = ESPN + 'eng.1/scoreboard',
    good = w.routes[sb];
  w.routes[sb] = 'err';
  await w.run(61 * 1000);
  const errAt = w.requests.filter((r) => r.url === sb && r.at > start).pop().at;
  assert.equal(w.ctx.HomeFootball.landingItems()[0].kind, 'live', 'the cached live match stays on screen');
  w.routes[sb] = good;
  const mark = w.requests.length;
  await w.run(170 * 1000);
  assert.equal(w.requests.length, mark, 'no ESPN request for 3 minutes after the error: ' + w.urls(errAt + 1).join());
  await w.run(25 * 1000);
  assert.ok(w.requests.length > mark, 'resumes after the backoff');
});
test('scope off, hidden document, no consumer: the timer stops; coming back restarts it', async () => {
  const w = espnWorld(T0 + 2 * MIN);
  w.match.st = 'in';
  w.ctx.HomeFootball.attach('page');
  await flush();
  await w.run(5 * MIN);
  assert.equal(w.ctx.HomeFootball.schedulerState().timer, true);
  w.scope(false);
  await flush();
  assert.equal(w.pending(), 0, 'scope off: no timer');
  const n = w.requests.length;
  await w.run(30 * MIN);
  assert.equal(w.requests.length, n, 'scope off: no request');
  w.scope(true);
  await flush();
  assert.equal(w.ctx.HomeFootball.schedulerState().timer, true, 'scope on: running again');
  w.hidden(true);
  await flush();
  assert.equal(w.pending(), 0, 'hidden document: no timer');
  const m = w.requests.length;
  await w.run(30 * MIN);
  assert.equal(w.requests.length, m, 'hidden: no request');
  w.hidden(false);
  await flush();
  assert.equal(w.ctx.HomeFootball.schedulerState().timer, true, 'visible again at once');
  w.ctx.HomeFootball.detach('page');
  assert.equal(w.pending(), 0, 'no consumer: no timer');
  // Nothing followed: no timer either.
  const w2 = espnWorld(T0 + 2 * MIN);
  w2.ctx.HomeInfo.football.set({ competitions: [], teams: [] });
  w2.ctx.HomeFootball.attach('page');
  await flush();
  assert.equal(w2.pending(), 0);
  assert.equal(w2.requests.length, 0);
});
test('one scheduler serves the page, the main-page card and the idle panel: one timer, the same requests, every consumer told', async () => {
  const solo = espnWorld(T0 + 2 * MIN),
    all = espnWorld(T0 + 2 * MIN);
  solo.match.st = 'in';
  all.match.st = 'in';
  solo.ctx.HomeFootball.attach('page');
  const told = { page: 0, card: 0, idle: 0 };
  all.ctx.HomeFootball.attach('page', () => told.page++);
  all.ctx.HomeFootball.attach('card', () => told.card++);
  all.ctx.HomeFootball.attach('idle', () => told.idle++);
  await flush();
  await solo.run(20 * MIN);
  await all.run(20 * MIN);
  assert.equal(all.requests.length, solo.requests.length, 'the same requests as with one consumer');
  assert.deepEqual(all.ctx.HomeFootball.schedulerState().consumers.sort(), ['card', 'idle', 'page']);
  assert.ok(told.page > 5 && told.page === told.card && told.card === told.idle, 'all told: ' + JSON.stringify(told));
  all.ctx.HomeFootball.detach('page');
  all.ctx.HomeFootball.detach('card');
  assert.equal(all.ctx.HomeFootball.schedulerState().timer, true, 'idle still attached');
  all.ctx.HomeFootball.detach('idle');
  assert.equal(all.pending(), 0);
});
test('data written by the old version (no round / league fields) still works: one full refresh upgrades it, no loop', async () => {
  const start = T0 + 2 * MIN,
    w = sdbWorld(start);
  w.match.st = '1H';
  // An old snapshot: the match without round/season.
  const old = { boards: {}, teams: { 'rou.1:7016': [{ id: 's16', competition: 'rou.1', home: { id: '7016', name: 'Home7016', score: 0 }, away: { id: '8016', name: 'Away8016', score: 0 }, start: iso(start), state: 'pre', clock: '' }] } };
  w.ctx.localStorage.setItem('tvhome.football.snapshot.v1', JSON.stringify(old));
  w.ctx.HomeInfo.football.set({ teams: [{ competition: 'rou.1', id: '7016', name: 'Home7016' }] });
  await w.run(0);
  w.ctx.HomeFootball.attach('page');
  await flush();
  await w.run(10 * MIN);
  const live = w.requests.filter((r) => r.url === SDB + 'eventsround.php?id=4691&r=16&s=2026-2027');
  assert.ok(live.length >= 2, 'narrow polls after the upgrade');
  // The full refreshes stayed rare (the upgrade, not a loop).
  assert.ok(w.requests.filter((r) => /eventsnextleague/.test(r.url)).length <= 2, 'no full-refresh loop');
});
test('budget of a whole match: about 110 ESPN requests (60 s) or about 55 TheSportsDB requests (120 s, one round)', async () => {
  const start = T0 + 2 * MIN,
    e = espnWorld(start);
  e.match.st = 'in';
  e.ctx.HomeFootball.attach('page');
  await flush();
  const e0 = e.requests.length;
  await e.run(2 * MIN);
  const eFrom = e.now();
  await e.run(110 * MIN);
  e.match.st = 'post';
  await e.run(5 * MIN);
  const espnLive = e.requests.filter((r) => r.at >= eFrom && r.url === ESPN + 'eng.1/scoreboard').length;
  assert.ok(espnLive >= 106 && espnLive <= 116, 'ESPN requests for 110 live minutes: ' + espnLive);
  const s = sdbWorld(start);
  s.match.st = '1H';
  s.ctx.HomeFootball.attach('page');
  await flush();
  await s.run(2 * MIN);
  const sFrom = s.now();
  await s.run(110 * MIN);
  s.match.st = 'FT';
  await s.run(5 * MIN);
  const sdbLive = s.requests.filter((r) => r.at >= sFrom && /eventsround/.test(r.url) && /r=16/.test(r.url)).length;
  assert.ok(sdbLive >= 52 && sdbLive <= 60, 'TheSportsDB requests for 110 live minutes: ' + sdbLive);
  // The example of the brief: Romania + one Premier League club + one Liga 1 team, all live for 90 minutes, per minute.
  assert.ok(espnLive / 110 <= 1.1 && sdbLive / 110 <= 0.55, 'per minute: ESPN <= 1 per live competition, TheSportsDB <= 0.5');
  void e0;
});
test('a team added in Settings is fetched at once (not at the next hourly refresh); without a consumer nothing happens', async () => {
  const w = espnWorld(T0 + 5 * 3600000);
  w.routes[ESPN + 'eng.1/teams/361/schedule'] = JSON.stringify({ events: [] });
  w.routes[ESPN + 'eng.1/teams/361/schedule?fixture=true'] = JSON.stringify({ events: [] });
  w.ctx.HomeFootball.attach('page');
  await flush();
  const before = w.requests.length;
  w.ctx.HomeInfo.football.set({ teams: [{ competition: 'eng.1', id: '359', name: 'Arsenal' }, { competition: 'eng.1', id: '361', name: 'Newcastle' }] });
  await flush();
  assert.deepEqual(w.urls().slice(before), ['E:eng.1/teams/361/schedule', 'E:eng.1/teams/361/schedule?fixture=true'], 'only the new team (the rest is cached)');
  w.ctx.HomeFootball.detach('page');
  const n = w.requests.length;
  w.ctx.HomeInfo.football.set({ teams: [{ competition: 'eng.1', id: '359', name: 'Arsenal' }] });
  await flush();
  await w.run(3600000);
  assert.equal(w.requests.length, n, 'no consumer: no request');
});
(async () => {
  for (const [name, fn] of tests) {
    await fn();
    console.log('ok - ' + name);
  }
})().catch((e) => {
  console.error('not ok - ' + e.stack);
  process.exit(1);
});
