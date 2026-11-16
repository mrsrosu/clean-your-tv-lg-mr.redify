const strict = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm');
const assert = Object.assign((v, m) => strict(v, m), strict, {
  deepEqual: (a, b) =>
    strict.deepEqual(
      JSON.parse(JSON.stringify(a)),
      JSON.parse(JSON.stringify(b))
    )
});
const fx = (n) =>
  fs.readFileSync('tests/info/fixtures/espn-' + n + '.json', 'utf8');
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/';
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
// info-store.js + info-fetch.js + football-espn.js + football.js in a bare context; XHR served from `routes`
// (url -> body string; a missing url answers 404; 'net' answers with a network error).
function context(storage, routes, extra) {
  const surface = { classList: { contains: () => false } },
    document = {
      getElementById: () => surface,
      addEventListener() {},
      readyState: 'complete'
    },
    requests = [];
  function XHR() {}
  XHR.prototype.open = function (m, url) {
    this.url = url;
  };
  XHR.prototype.send = function () {
    const self = this;
    requests.push(this.url);
    setTimeout(function () {
      const body = routes[self.url];
      if (body === 'net') self.onerror();
      else if (body === undefined) {
        self.status = 404;
        self.onload();
      } else {
        self.status = 200;
        self.responseText = body;
        self.onload();
      }
    }, 0);
  };
  const ctx = Object.assign(
    {
      document,
      localStorage: storage,
      Promise,
      setTimeout,
      clearTimeout,
      XMLHttpRequest: XHR
    },
    extra || {}
  );
  ctx.window = ctx;
  ctx.requests = requests;
  for (const f of ['info-store', 'info-fetch', 'football-espn', 'football'])
    vm.runInNewContext(fs.readFileSync('launcher/' + f + '.js', 'utf8'), ctx);
  return ctx;
}
const tests = [];
function test(name, fn) {
  tests.push([name, fn]);
}
// ESPN-shaped scoreboard event.
function event(id, home, away, state, hs, as, date, extra) {
  const comp = {
    id,
    status: {
      displayClock: state === 'in' ? "34'" : "0'",
      type: { state, completed: state === 'post' }
    },
    competitors: [
      {
        homeAway: 'home',
        score: String(hs),
        team: { id: home[0], displayName: home[1] }
      },
      {
        homeAway: 'away',
        score: String(as),
        team: { id: away[0], displayName: away[1] }
      }
    ]
  };
  return Object.assign({ id, date, competitions: [comp] }, extra || {});
}
const ARS = ['359', 'Arsenal'],
  HUL = ['306', 'Hull City'],
  NEW = ['361', 'Newcastle United'];

test('competitions: the eight ids and names', () => {
  const E = context(memory(), {}).FootballEspn;
  assert.deepEqual(
    E.competitions.map((c) => c.id),
    [
      'eng.1',
      'esp.1',
      'ita.1',
      'ger.1',
      'fra.1',
      'rou.1',
      'uefa.champions',
      'uefa.europa'
    ]
  );
  assert.equal(E.competitions[0].name, 'Premier League');
  assert.equal(E.competitions[5].name, 'Liga 1 România');
  assert.equal(E.competitions[7].name, 'Europa League');
});
test('scoreboard(fixture): Match shape, no score before kick-off', async () => {
  const ctx = context(memory(), {
      [BASE + 'eng.1/scoreboard']: fx('scoreboard')
    }),
    list = await ctx.FootballEspn.scoreboard('eng.1');
  assert.deepEqual(ctx.requests, [BASE + 'eng.1/scoreboard']);
  assert.equal(list.length, 4);
  const m = list[0];
  assert.equal(typeof m.id, 'string');
  assert.equal(m.competition, 'eng.1');
  assert.equal(m.state, 'pre');
  assert.equal(m.home.score, null);
  assert.equal(m.away.score, null);
  assert.equal(m.clock, '');
  assert.ok(!isNaN(Date.parse(m.start)));
  assert.equal(typeof m.home.id, 'string');
  assert.ok(m.home.name.length > 0);
  const post = list.filter((x) => x.state === 'post');
  assert.ok(post.length >= 1);
  assert.equal(typeof post[0].home.score, 'number');
});
test('scoreboard: live match keeps score and clock; postponed is dropped', async () => {
  const body = JSON.stringify({
    events: [
      event('1', ARS, HUL, 'in', 1, 0, '2026-11-16T12:00Z'),
      event('2', NEW, HUL, 'post', 0, 0, '2026-11-15T12:00Z', {}),
      event('3', NEW, ARS, 'post', 0, 0, '2026-11-15T12:00Z', {})
    ]
  });
  const parsed = JSON.parse(body);
  parsed.events[2].competitions[0].status.type.completed = false; // postponed
  const ctx = context(memory(), {
      [BASE + 'eng.1/scoreboard']: JSON.stringify(parsed)
    }),
    list = await ctx.FootballEspn.scoreboard('eng.1');
  assert.deepEqual(
    list.map((m) => m.id),
    ['1', '2']
  );
  assert.equal(list[0].state, 'in');
  assert.equal(list[0].clock, "34'");
  assert.equal(list[0].home.score, 1);
  assert.equal(list[0].away.score, 0);
});
test('teams(fixture): id and name list, sorted by name', async () => {
  const ctx = context(memory(), { [BASE + 'eng.1/teams']: fx('teams') }),
    list = await ctx.FootballEspn.teams('eng.1');
  assert.deepEqual(ctx.requests, [BASE + 'eng.1/teams']);
  assert.equal(list.length, 6);
  assert.deepEqual(Object.keys(list[0]).sort(), ['id', 'name']);
  const names = list.map((t) => t.name);
  assert.deepEqual(names, names.slice().sort());
  assert.ok(list.some((t) => t.id === '349' && t.name === 'AFC Bournemouth'));
});
test('teamMatches: schedule + fixtures merged, deduped, sorted, scores from {value}', async () => {
  const ctx = context(memory(), {
      [BASE + 'eng.1/teams/359/schedule']: fx('schedule'),
      [BASE + 'eng.1/teams/359/schedule?fixture=true']: fx('fixtures')
    }),
    list = await ctx.FootballEspn.teamMatches('eng.1', '359');
  assert.equal(list.length, 6);
  const starts = list.map((m) => m.start);
  assert.deepEqual(starts, starts.slice().sort());
  assert.ok(list.every((m) => m.competition === 'eng.1'));
  const post = list.filter((m) => m.state === 'post')[0];
  assert.equal(typeof post.home.score, 'number');
  assert.equal(list.filter((m) => m.state === 'pre').length, 3);
});
test('teamMatches: one list failing still answers, both failing rejects', async () => {
  let ctx = context(memory(), {
    [BASE + 'eng.1/teams/359/schedule']: fx('schedule')
  });
  assert.equal((await ctx.FootballEspn.teamMatches('eng.1', '359')).length, 3);
  ctx = context(memory(), {});
  await assert.rejects(ctx.FootballEspn.teamMatches('eng.1', '359'));
  assert.deepEqual(
    ctx.requests.map((u) => u.replace(BASE, '')),
    ['eng.1/teams/359/schedule', 'eng.1/teams/359/schedule?fixture=true']
  );
});
test('defensive: other shapes give [] and never throw', async () => {
  const bad = [
    '{}',
    'null',
    '[]',
    '"x"',
    '42',
    'not json',
    '{"events":"x"}',
    '{"events":[null,1,"a",{}]}',
    '{"events":[{"id":"1","date":"nope","competitions":[{"competitors":[]}]}]}',
    '{"events":[{"id":"1","date":"2026-11-16T12:00Z","competitions":[{"status":{"type":{"state":"pre"}},"competitors":[{"homeAway":"home"}]}]}]}',
    '{"events":[{"id":"1","date":"2026-11-16T12:00Z","competitions":[{"status":{"type":{"state":"weird"}},"competitors":[{"homeAway":"home","team":{"id":"1","displayName":"A"}},{"homeAway":"away","team":{"id":"2","displayName":"B"}}]}]}]}'
  ];
  for (const body of bad) {
    const ctx = context(memory(), {
      [BASE + 'eng.1/scoreboard']: body,
      [BASE + 'eng.1/teams']: body,
      [BASE + 'eng.1/teams/1/schedule']: body,
      [BASE + 'eng.1/teams/1/schedule?fixture=true']: body
    });
    assert.deepEqual(await ctx.FootballEspn.scoreboard('eng.1'), [], body);
    assert.deepEqual(await ctx.FootballEspn.teams('eng.1'), [], body);
    assert.deepEqual(
      await ctx.FootballEspn.teamMatches('eng.1', '1'),
      [],
      body
    );
  }
  const ctx = context(memory(), { [BASE + 'eng.1/scoreboard']: 'net' });
  await assert.rejects(ctx.FootballEspn.scoreboard('eng.1'));
  assert.deepEqual(
    await ctx.FootballEspn.scoreboard('nope.1').catch(() => 'rejected'),
    'rejected'
  );
});
function m(id, home, away, state, start) {
  return {
    id,
    competition: 'eng.1',
    home: { id: home, name: 'H' + home, score: state === 'pre' ? null : 1 },
    away: { id: away, name: 'A' + away, score: state === 'pre' ? null : 0 },
    start,
    state,
    clock: state === 'in' ? "10'" : ''
  };
}
test('teamStatus: next, last and live by state and start', () => {
  const F = context(memory(), {}).HomeFootball,
    now = '2026-11-16T12:00:00Z',
    list = [
      m('a', '1', '2', 'post', '2026-11-01T15:00Z'),
      m('b', '3', '1', 'post', '2026-11-09T15:00Z'),
      m('c', '1', '4', 'pre', '2026-11-30T15:00Z'),
      m('d', '1', '5', 'pre', '2026-11-21T15:00Z'),
      m('e', '6', '7', 'pre', '2026-11-17T15:00Z')
    ];
  let s = F.teamStatus(list, '1', now);
  assert.equal(s.next.id, 'd');
  assert.equal(s.last.id, 'b');
  assert.equal(s.live, null);
  s = F.teamStatus(
    list.concat([m('f', '8', '1', 'in', '2026-11-16T11:30Z')]),
    '1',
    now
  );
  assert.equal(s.live.id, 'f');
  assert.equal(s.next.id, 'd');
  s = F.teamStatus(list, '9', now);
  assert.deepEqual(s, { next: null, last: null, live: null });
  assert.deepEqual(F.teamStatus(null, '1', now), {
    next: null,
    last: null,
    live: null
  });
  assert.deepEqual(F.teamStatus([null, 3, {}], '1', now), {
    next: null,
    last: null,
    live: null
  });
  // A match that should have started a few minutes ago but still says "pre" stays the next one.
  s = F.teamStatus([m('g', '1', '2', 'pre', '2026-11-16T11:55Z')], '1', now);
  assert.equal(s.next.id, 'g');
  // Long past "pre" (stale data) is not a next match.
  s = F.teamStatus([m('h', '1', '2', 'pre', '2026-11-10T11:55Z')], '1', now);
  assert.equal(s.next, null);
});
test('store: defaults, 6 teams -> 5, unknown competition dropped, malformed dropped', () => {
  const mem = memory(),
    I = context(mem, {}).HomeInfo;
  assert.deepEqual(I.football.get(), { competitions: [], teams: [] });
  I.football.set({ competitions: ['eng.1', 'nope.9', 'eng.1', 7, 'rou.1'] });
  assert.deepEqual(I.football.get().competitions, ['eng.1', 'rou.1']);
  const t = (i) => ({ competition: 'eng.1', id: String(i), name: 'T' + i });
  I.football.set({ teams: [1, 2, 3, 4, 5, 6].map(t) });
  assert.equal(I.football.get().teams.length, 5);
  assert.equal(I.football.get().teams[4].id, '5');
  I.football.set({
    teams: [
      t(1),
      t(1),
      { competition: 'nope.9', id: '2', name: 'X' },
      { competition: 'eng.1', id: '', name: 'X' },
      { competition: 'eng.1', id: '3' },
      { competition: 'eng.1', id: 3, name: 'N' },
      null,
      'x'
    ]
  });
  assert.deepEqual(I.football.get().teams, [t(1)]);
  I.football.set({ teams: [] });
  assert.deepEqual(I.football.get().teams, [], 'empty is allowed');
  I.football.set({ teams: 'x', competitions: 'y' });
  assert.deepEqual(I.football.get().teams, []);
  assert.ok(mem.data['tvhome.football.v1']);
  mem.data['tvhome.football.v1'] = '{"competitions":["xx"],"teams":{"a":1}}';
  assert.deepEqual(I.football.get(), { competitions: [], teams: [] });
});
const NOW = '2026-11-16T12:00:00Z';
function followArsenal(ctx) {
  ctx.HomeFootball.setClock(() => new Date(NOW));
  ctx.HomeInfo.football.set({
    competitions: ['eng.1'],
    teams: [{ competition: 'eng.1', id: '359', name: 'Arsenal' }]
  });
}
const routes = (sb) => ({
  [BASE + 'eng.1/scoreboard']: sb || fx('scoreboard'),
  [BASE + 'eng.1/teams/359/schedule']: fx('schedule'),
  [BASE + 'eng.1/teams/359/schedule?fixture=true']: fx('fixtures')
});
test('refresh: nothing configured -> empty, no request', async () => {
  const ctx = context(memory(), routes());
  ctx.HomeFootball.setClock(() => new Date(NOW));
  const r = await ctx.HomeFootball.refresh();
  assert.equal(r.state, 'empty');
  assert.equal(ctx.requests.length, 0);
  assert.deepEqual(ctx.HomeFootball.idleLines(), []);
});
test('refresh: loads scoreboard + team matches, idleLines from cache only', async () => {
  const mem = memory(),
    ctx = context(mem, routes());
  followArsenal(ctx);
  assert.deepEqual(ctx.HomeFootball.idleLines(), [], 'no data yet');
  const r = await ctx.HomeFootball.refresh();
  assert.equal(r.state, 'ok');
  assert.equal(r.live, false);
  assert.equal(ctx.requests.length, 3);
  const lines = ctx.HomeFootball.idleLines();
  assert.equal(lines.length, 1);
  assert.match(lines[0], /Arsenal/);
  assert.match(lines[0], /Newcastle United/);
  assert.match(lines[0], /21\.11/);
  // A fresh context (reload) reads the same lines without any request.
  const again = context(mem, {});
  again.HomeFootball.setClock(() => new Date(NOW));
  assert.deepEqual(again.HomeFootball.idleLines(), lines);
  assert.equal(again.requests.length, 0);
  // Within the cache lifetime a second refresh does not hit the network.
  await ctx.HomeFootball.refresh();
  assert.equal(ctx.requests.length, 3);
});
test('refresh: live match from the scoreboard wins, live=true, idle line has score and clock', async () => {
  const sb = JSON.stringify({
      events: [event('9', ARS, HUL, 'in', 2, 1, '2026-11-16T11:30Z')]
    }),
    ctx = context(memory(), routes(sb));
  followArsenal(ctx);
  const r = await ctx.HomeFootball.refresh();
  assert.equal(r.live, true);
  const lines = ctx.HomeFootball.idleLines();
  assert.equal(lines.length, 1);
  assert.match(lines[0], /Arsenal 2-1 Hull City/);
  assert.match(lines[0], /34'/);
});
test('refresh: live data is cached only briefly (about a minute)', async () => {
  const sb = JSON.stringify({
      events: [event('9', ARS, HUL, 'in', 0, 0, '2026-11-16T11:30Z')]
    }),
    mem = memory(),
    ctx = context(mem, routes(sb));
  followArsenal(ctx);
  await ctx.HomeFootball.refresh();
  assert.equal(ctx.requests.length, 3);
  await ctx.HomeFootball.refresh(); // just fetched: cached (the previous round saw a live match -> 50 s lifetime)
  assert.equal(ctx.requests.length, 3);
  for (const k of Object.keys(mem.data))
    if (k.indexOf('tvhome.cache.v1.') === 0) {
      const e = JSON.parse(mem.data[k]);
      e.fetchedAt -= 55000;
      mem.data[k] = JSON.stringify(e);
    }
  await ctx.HomeFootball.refresh();
  assert.equal(ctx.requests.length, 6, 'refetched after 55 s while live');
});
test('refresh: offline keeps cached values, state offline with fetchedAt', async () => {
  const mem = memory();
  let ctx = context(mem, routes());
  followArsenal(ctx);
  await ctx.HomeFootball.refresh();
  for (const k of Object.keys(mem.data))
    if (k.indexOf('tvhome.cache.v1.fb.') === 0) {
      const e = JSON.parse(mem.data[k]);
      e.fetchedAt -= 2 * 3600000;
      mem.data[k] = JSON.stringify(e);
    }
  ctx = context(mem, {
    [BASE + 'eng.1/scoreboard']: 'net',
    [BASE + 'eng.1/teams/359/schedule']: 'net',
    [BASE + 'eng.1/teams/359/schedule?fixture=true']: 'net'
  });
  ctx.HomeFootball.setClock(() => new Date(NOW));
  const r = await ctx.HomeFootball.refresh();
  assert.equal(r.state, 'offline');
  assert.ok(r.fetchedAt > 0);
  assert.equal(ctx.HomeFootball.idleLines().length, 1);
  // No cache at all and offline: offline without time, never throws.
  ctx = context(memory(), {});
  followArsenal(ctx);
  const r2 = await ctx.HomeFootball.refresh();
  assert.equal(r2.state, 'offline');
  assert.equal(r2.fetchedAt, null);
});
test('refresh: cached team matches are trimmed to a window around now', async () => {
  const many = [];
  for (let i = 1; i <= 30; i++)
    many.push(
      event(
        'p' + i,
        ARS,
        HUL,
        'post',
        1,
        0,
        '2026-0' + (i < 10 ? '8-0' + i : '8-' + i) + 'T15:00Z'
      )
    );
  for (let i = 1; i <= 20; i++)
    many.push(
      event(
        'f' + i,
        ARS,
        HUL,
        'pre',
        0,
        0,
        '2026-12-' + (i < 10 ? '0' + i : i) + 'T15:00Z'
      )
    );
  const mem = memory(),
    ctx = context(mem, {
      [BASE + 'eng.1/scoreboard']: '{}',
      [BASE + 'eng.1/teams/359/schedule']: JSON.stringify({
        events: many.slice(0, 30)
      }),
      [BASE + 'eng.1/teams/359/schedule?fixture=true']: JSON.stringify({
        events: many.slice(30)
      })
    });
  followArsenal(ctx);
  await ctx.HomeFootball.refresh();
  const entry = JSON.parse(mem.data['tvhome.cache.v1.fb.tm.eng.1.359']);
  assert.ok(entry.value.length <= 8, 'trimmed: ' + entry.value.length);
  assert.match(ctx.HomeFootball.idleLines()[0], /01\.12|02\.12|\d\d\.12/);
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
