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
// info-store.js + info-fetch.js + football-espn.js + football-sportsdb.js + football.js in a bare context; XHR served from `routes`
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
  for (const f of [
    'info-store',
    'info-fetch',
    'football-espn',
    'football-sportsdb',
    'football'
  ])
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

test('competitions: the eight leagues plus the national-teams group, ids and names', () => {
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
      'uefa.europa',
      'nat'
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
  assert.deepEqual(I.football.get(), { competitions: [], teams: [], landing: false });
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
  assert.deepEqual(I.football.get(), { competitions: [], teams: [], landing: false });
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
test('clockText: status codes go through HomeI18n.t, minutes pass through (M8)', () => {
  const ctx = context(memory(), {}, { HomeI18n: { t: (k) => 'RO:' + k } }),
    F = ctx.HomeFootball;
  assert.equal(F.clockText("34'"), "34'");
  assert.equal(F.clockText(''), '');
  assert.equal(F.clockText('HT'), 'RO:Half time');
  assert.equal(F.clockText('1H'), 'RO:Live');
  assert.equal(F.clockText('2H'), 'RO:Live');
  assert.equal(F.clockText('ET'), 'RO:Extra time');
  assert.equal(F.clockText('P'), 'RO:Penalties');
  assert.equal(F.clockText('FT'), 'RO:FT');
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
test('refresh: the full refresh is cached for 55 minutes also while a match is live (live polls are the scheduler\'s narrow ones)', async () => {
  const sb = JSON.stringify({
      events: [event('9', ARS, HUL, 'in', 0, 0, '2026-11-16T11:30Z')]
    }),
    mem = memory(),
    ctx = context(mem, routes(sb));
  followArsenal(ctx);
  await ctx.HomeFootball.refresh();
  assert.equal(ctx.requests.length, 3);
  for (const k of Object.keys(mem.data))
    if (k.indexOf('tvhome.cache.v1.') === 0) {
      const e = JSON.parse(mem.data[k]);
      e.fetchedAt -= 55000;
      mem.data[k] = JSON.stringify(e);
    }
  await ctx.HomeFootball.refresh();
  assert.equal(ctx.requests.length, 3, 'a live match no longer shortens the full refresh (55 s old data is still cached)');
  for (const k of Object.keys(mem.data))
    if (k.indexOf('tvhome.cache.v1.') === 0) {
      const e = JSON.parse(mem.data[k]);
      e.fetchedAt -= 56 * 60000;
      mem.data[k] = JSON.stringify(e);
    }
  await ctx.HomeFootball.refresh();
  assert.equal(ctx.requests.length, 6, 'refetched after the 55 minute lifetime');
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
// ---- Liga 1 (rou.1) from TheSportsDB; every other competition stays on ESPN ----
const sdb = (n) =>
  fs.readFileSync('tests/info/fixtures/sportsdb-' + n + '.json', 'utf8');
const SB = 'https://www.thesportsdb.com/api/v1/json/123/',
  NEXT = SB + 'eventsnextleague.php?id=4691',
  PAST = SB + 'eventspastleague.php?id=4691',
  ROUND = (n) => SB + 'eventsround.php?id=4691&r=' + n + '&s=2026-2027',
  FCSB = '134005';
const sdbRoutes = () => ({
  [NEXT]: sdb('next'),
  [PAST]: sdb('past'),
  [ROUND(15)]: sdb('round15'),
  [ROUND(16)]: sdb('round16')
});
function followFcsb(ctx, id) {
  ctx.HomeFootball.setClock(() => new Date(NOW));
  ctx.HomeInfo.football.set({
    competitions: ['rou.1'],
    teams: [{ competition: 'rou.1', id: id || FCSB, name: 'FCSB' }]
  });
}
test('sportsdb: competitions list rou.1 once (ESPN list keeps the ids and names)', () => {
  const ctx = context(memory(), {});
  assert.deepEqual(
    ctx.FootballSportsDb.competitions.map((c) => c.id),
    ['rou.1']
  );
  assert.equal(
    ctx.FootballEspn.competitions.filter((c) => c.id === 'rou.1').length,
    1
  );
  assert.equal(ctx.FootballSportsDb.handles('eng.1'), false);
});
test('sportsdb scoreboard: the two matchdays around now, Match shape, UTC start', async () => {
  const ctx = context(memory(), sdbRoutes()),
    list = await ctx.FootballSportsDb.scoreboard('rou.1');
  assert.deepEqual(
    ctx.requests.slice().sort(),
    [NEXT, PAST, ROUND(15), ROUND(16)].sort()
  );
  assert.equal(list.length, 16);
  const done = list.find((m) => m.id === '2503054'),
    todo = list.find((m) => m.id === '2503062');
  assert.deepEqual(done, {
    id: '2503054',
    competition: 'rou.1',
    home: {
      id: '138191',
      name: 'Botoșani',
      score: 1,
      logo: 'https://r2.thesportsdb.com/images/media/team/badge/1volx41719994247.png'
    },
    away: {
      id: '135929',
      name: 'Oțelul Galați',
      score: 1,
      logo: 'https://r2.thesportsdb.com/images/media/team/badge/cfkqt61770049560.png'
    },
    start: '2026-11-09T18:00:00Z',
    state: 'post',
    clock: '',
    round: 15, // additive: the live refresh asks this round only
    season: '2026-2027'
  });
  assert.equal(todo.state, 'pre');
  assert.equal(todo.start, '2026-11-20T15:30:00Z');
  assert.equal(todo.home.score, null);
  assert.equal(todo.away.score, null);
  assert.deepEqual(
    list.map((m) => m.start),
    list.map((m) => m.start).sort(),
    'sorted by start'
  );
});
test('sportsdb teams: all 16 teams from a matchday, sorted by name', async () => {
  const ctx = context(memory(), sdbRoutes()),
    list = await ctx.FootballSportsDb.teams('rou.1');
  assert.equal(list.length, 16);
  assert.ok(list.some((x) => x.id === FCSB && x.name === 'FCSB'));
  assert.deepEqual(
    list.map((x) => x.name),
    list.map((x) => x.name).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  );
});
test('sportsdb teamMatches: one team from rounds 13..18 (missing rounds do not break it)', async () => {
  const ctx = context(memory(), sdbRoutes()),
    list = await ctx.FootballSportsDb.teamMatches('rou.1', FCSB);
  assert.deepEqual(
    ctx.requests.filter((u) => u.indexOf('eventsround') >= 0).length,
    6
  );
  assert.deepEqual(
    list.map((m) => [m.state, m.home.name, m.away.name]),
    [
      ['post', 'FCSB', 'Corvinul Hunedoara'],
      ['pre', 'Argeș Pitești', 'FCSB']
    ]
  );
  await assert.rejects(ctx.FootballSportsDb.teamMatches('eng.1', FCSB));
  await assert.rejects(ctx.FootballSportsDb.teamMatches('rou.1', ''));
});
test('sportsdb: statuses (live / postponed / unknown) and odd events', async () => {
  const ev = (o) =>
    Object.assign(
      {
        idEvent: '1',
        idHomeTeam: '10',
        idAwayTeam: '20',
        strHomeTeam: 'A',
        strAwayTeam: 'B',
        intHomeScore: '2',
        intAwayScore: '1',
        dateEvent: '2026-11-16',
        strTime: '11:00:00',
        strStatus: '2H',
        strProgress: "67'"
      },
      o
    );
  const body = JSON.stringify({
    events: [
      ev({ idEvent: '1' }),
      ev({ idEvent: '2', strStatus: 'PST' }),
      ev({ idEvent: '3', strStatus: 'whatever' }),
      ev({ idEvent: '4', strStatus: 'HT', strProgress: undefined }),
      ev({ idEvent: '5', intHomeScore: null, strStatus: 'NS' }),
      ev({ idEvent: '6', dateEvent: 'x' }),
      ev({ idEvent: '', strStatus: 'FT' }),
      ev({ idEvent: '8', strHomeTeam: '' }),
      null,
      'x'
    ]
  });
  const ctx = context(memory(), {
      [NEXT]: JSON.stringify({
        events: [{ intRound: '16', strSeason: '2026-2027' }]
      }),
      [PAST]: '{"events":null}',
      [ROUND(16)]: body,
      [ROUND(15)]: body,
      [ROUND(14)]: body,
      [ROUND(17)]: body,
      [ROUND(18)]: body
    }),
    list = await ctx.FootballSportsDb.scoreboard('rou.1');
  assert.deepEqual(
    list.map((m) => [m.id, m.state, m.clock, m.home.score]),
    [
      ['1', 'in', "67'", 2],
      ['4', 'in', 'HT', 2],
      ['5', 'pre', '', null]
    ]
  );
});
test('sportsdb: odd JSON gives [] and no exception; HTTP failure rejects', async () => {
  for (const body of ['{}', '[]', '{"events":"x"}', '{"events":null}']) {
    const ctx = context(memory(), {
      [NEXT]: body,
      [PAST]: body
    });
    assert.deepEqual(await ctx.FootballSportsDb.scoreboard('rou.1'), [], body);
    assert.deepEqual(await ctx.FootballSportsDb.teams('rou.1'), [], body);
    assert.deepEqual(
      await ctx.FootballSportsDb.teamMatches('rou.1', '1'),
      [],
      body
    );
  }
  // Not JSON (an HTML/proxy page) or 404/429 or network error: rejects, nothing cached.
  for (const body of ['<html>429</html>', undefined, 'net']) {
    const mem = memory(),
      ctx = context(mem, { [NEXT]: body, [PAST]: body });
    await assert.rejects(ctx.FootballSportsDb.scoreboard('rou.1'));
    assert.deepEqual(
      Object.keys(mem.data).filter((k) => k.indexOf('tvhome.cache.v1.') === 0),
      []
    );
  }
});
test('routing: rou.1 asks SportsDB, eng.1 asks ESPN, in one refresh', async () => {
  const ctx = context(memory(), Object.assign(routes(), sdbRoutes()));
  ctx.HomeFootball.setClock(() => new Date(NOW));
  ctx.HomeInfo.football.set({
    competitions: ['eng.1', 'rou.1'],
    teams: [
      { competition: 'eng.1', id: '359', name: 'Arsenal' },
      { competition: 'rou.1', id: FCSB, name: 'FCSB' }
    ]
  });
  const r = await ctx.HomeFootball.refresh();
  assert.equal(r.state, 'ok');
  const espn = ctx.requests.filter((u) => u.indexOf('espn.com') >= 0),
    other = ctx.requests.filter((u) => u.indexOf('thesportsdb.com') >= 0);
  assert.equal(espn.length, 3);
  assert.ok(
    espn.every((u) => /\/eng\.1\//.test(u)),
    'no ESPN request for rou.1'
  );
  assert.ok(
    other.length >= 4 && other.length <= 8,
    'sportsdb: ' + other.length
  );
  assert.equal(ctx.requests.length, espn.length + other.length);
  const lines = ctx.HomeFootball.idleLines();
  assert.equal(lines.length, 2);
  assert.ok(lines.some((l) => /Arsenal/.test(l)));
  assert.ok(
    lines.some((l) => /Argeș Pitești – FCSB 22\.11/.test(l)),
    lines.join('|')
  );
});
test('refresh rou.1: SportsDB budget: at most 8 requests per hour, none while cached', async () => {
  const ctx = context(memory(), sdbRoutes());
  followFcsb(ctx);
  await ctx.HomeFootball.refresh();
  const n = ctx.requests.length;
  assert.ok(n <= 8, 'hourly requests: ' + n);
  assert.ok(ctx.requests.every((u) => u.indexOf('thesportsdb.com') >= 0));
  await ctx.HomeFootball.refresh();
  assert.equal(ctx.requests.length, n, 'cached');
});
test('stale store: a rou.1 team saved with an ESPN id is re-resolved by name, no crash', async () => {
  const mem = memory(),
    ctx = context(mem, sdbRoutes());
  followFcsb(ctx, '3000'); // ESPN-era id
  ctx.HomeInfo.football.set({
    teams: [
      { competition: 'rou.1', id: '3000', name: 'FCSB' },
      { competition: 'rou.1', id: '3001', name: 'Rapid Bucureşti' }, // old spelling with cedilla
      { competition: 'rou.1', id: '3002', name: 'Echipa Disparuta' }
    ]
  });
  const r = await ctx.HomeFootball.refresh();
  assert.equal(r.state, 'ok');
  const teams = ctx.HomeInfo.football.get().teams;
  assert.equal(teams[0].id, FCSB);
  assert.equal(teams[1].name, 'Rapid București');
  assert.notEqual(teams[1].id, '3001');
  assert.equal(teams[2].id, '3002', 'no match: kept as saved');
  assert.match(ctx.HomeFootball.idleLines().join('|'), /FCSB/);
  // The old ESPN cache entries for rou.1 are never read: separate keys.
  assert.ok(
    Object.keys(mem.data).every((k) => !/fb\.(sb|tm|teams)\.rou\.1/.test(k))
  );
});
test('refresh rou.1: SportsDB failing -> cached values, offline; ESPN competitions unaffected', async () => {
  const mem = memory();
  let ctx = context(mem, Object.assign(routes(), sdbRoutes()));
  ctx.HomeFootball.setClock(() => new Date(NOW));
  ctx.HomeInfo.football.set({
    competitions: ['eng.1', 'rou.1'],
    teams: [
      { competition: 'eng.1', id: '359', name: 'Arsenal' },
      { competition: 'rou.1', id: FCSB, name: 'FCSB' }
    ]
  });
  await ctx.HomeFootball.refresh();
  for (const k of Object.keys(mem.data))
    if (k.indexOf('tvhome.cache.v1.') === 0) {
      const e = JSON.parse(mem.data[k]);
      e.fetchedAt -= 2 * 3600000;
      mem.data[k] = JSON.stringify(e);
    }
  ctx = context(
    mem,
    Object.assign(routes(), { [NEXT]: '<html>', [PAST]: 'net' })
  );
  ctx.HomeFootball.setClock(() => new Date(NOW));
  const r = await ctx.HomeFootball.refresh();
  assert.equal(r.state, 'offline');
  assert.equal(ctx.HomeFootball.idleLines().length, 2, 'cached lines kept');
});
test('logos: ESPN team.logo / logos[0].href normalised, only allowed https hosts, key absent otherwise', async () => {
  const p = JSON.parse(fx('scoreboard')),
    comps = p.events.map((e) => e.competitions[0].competitors);
  comps[0][0].team.logo = 'https://a.espncdn.com/i/teamlogos/soccer/500/1.png';
  comps[0][1].team.logos = [{ href: 'https://a1.espncdn.com/i/teamlogos/soccer/500/2.png' }];
  comps[1][0].team.logo = 'http://a.espncdn.com/i/teamlogos/soccer/500/3.png'; // not https
  comps[1][1].team.logo = 'https://evil.example/x.png'; // other host
  comps[2][0].team.logo = 'https://a.espncdn.com.evil.example/x.png'; // look-alike host
  comps[2][1].team.logos = [{ href: 'javascript:alert(1)' }];
  comps[3][0].team.logo = 'https://a.espncdn.com@evil.example/x.png'; // userinfo trick
  comps[3][1].team.logo = 'https://a.espncdn.com/x.png"onerror="1'; // quote
  const ctx = context(memory(), { [BASE + 'eng.1/scoreboard']: JSON.stringify(p) }),
    list = await ctx.FootballEspn.scoreboard('eng.1'),
    sides = [].concat(...list.map((m) => [m.home, m.away]));
  assert.equal(list[0].home.logo, 'https://a.espncdn.com/i/teamlogos/soccer/500/1.png');
  assert.equal(list[0].away.logo, 'https://a1.espncdn.com/i/teamlogos/soccer/500/2.png');
  sides.slice(2).forEach((x) => assert.equal('logo' in x, false, 'dropped: ' + x.name));
  const t = JSON.parse(fx('teams'));
  t.sports[0].leagues[0].teams[0].team.logos = [
    { href: 'https://a.espncdn.com/i/teamlogos/soccer/500/9.png' }
  ];
  const ctx2 = context(memory(), { [BASE + 'eng.1/teams']: JSON.stringify(t) }),
    teams = await ctx2.FootballEspn.teams('eng.1'),
    withLogo = teams.filter((x) => x.logo);
  assert.equal(withLogo.length, 1);
  assert.equal(withLogo[0].logo, 'https://a.espncdn.com/i/teamlogos/soccer/500/9.png');
  teams.filter((x) => !x.logo).forEach((x) => assert.equal('logo' in x, false));
});
test('logos: SportsDB badges come with the round payload (no extra request); bad host dropped', async () => {
  const routes = sdbRoutes(),
    key = Object.keys(routes).find((k) => /eventsround/.test(k) && /r=15/.test(k)),
    p = JSON.parse(routes[key]);
  p.events[0].strHomeTeamBadge = 'https://evil.example/badge.png';
  p.events[0].strAwayTeamBadge = null;
  routes[key] = JSON.stringify(p);
  const ctx = context(memory(), routes),
    list = await ctx.FootballSportsDb.scoreboard('rou.1'),
    base = context(memory(), sdbRoutes());
  await base.FootballSportsDb.scoreboard('rou.1');
  assert.equal(ctx.requests.length, base.requests.length, 'no request for logos');
  const bad = list.find((m) => m.id === String(p.events[0].idEvent));
  assert.equal('logo' in bad.home, false);
  assert.equal('logo' in bad.away, false);
  const ok = list.find((m) => m.id === '2503054');
  assert.match(ok.home.logo, /^https:\/\/r2\.thesportsdb\.com\/images\/media\/team\/badge\//);
  const names = await ctx.FootballSportsDb.teams('rou.1');
  assert.ok(names.some((x) => x.logo), 'team list items carry the logo');
});
test('logos: HomeInfoFetch.logoUrl host list', () => {
  const ctx = context(memory(), {}),
    f = ctx.HomeInfoFetch.logoUrl;
  [
    'https://a.espncdn.com/i/x.png',
    'https://a1.espncdn.com/i/x.png',
    'https://www.thesportsdb.com/images/x.png',
    'https://r2.thesportsdb.com/images/x.png/tiny'
  ].forEach((u) => assert.equal(f(u), u));
  [
    '', null, 5, 'http://a.espncdn.com/x.png', 'https://espncdn.com/x.png', 'https://b.espncdn.com/x.png',
    'https://a.espncdn.com:8443/x.png', '//a.espncdn.com/x.png', 'data:image/png;base64,AA==',
    'https://a.espncdn.com/' + 'x'.repeat(300)
  ].forEach((u) => assert.equal(f(u), '', String(u)));
});
// National teams: Romania (ESPN 473), matches merged from several ESPN leagues. Fixtures are shaped like ESPN schedule
// answers (synthetic: no live request is made).
const natfx = (n) =>
  fs.readFileSync('tests/info/fixtures/espn-nat-' + n + '.json', 'utf8');
const NATIONAL_SLUGS = ['fifa.friendly', 'fifa.worldq.uefa', 'uefa.nations', 'uefa.euro'];
const natRoutes = () => {
  const r = {};
  NATIONAL_SLUGS.forEach((s) => (r[BASE + s + '/teams/473/schedule'] = natfx('empty')));
  r[BASE + 'fifa.friendly/teams/473/schedule'] = natfx('friendly');
  r[BASE + 'uefa.nations/teams/473/schedule'] = natfx('nations');
  r[BASE + 'fifa.friendly/teams/473/schedule?fixture=true'] = natfx('fixtures');
  return r;
};
test('nat: listed once after the leagues; its only team is Romania 473 (no request)', async () => {
  const ctx = context(memory(), {});
  const nat = ctx.FootballEspn.competitions.find((c) => c.id === 'nat');
  assert.equal(nat.name, 'National teams');
  assert.equal(ctx.FootballEspn.competitions.filter((c) => c.id === 'nat').length, 1);
  const teams = await ctx.FootballEspn.teams('nat');
  assert.deepEqual(teams, [{ id: '473', name: 'Romania' }]);
  assert.deepEqual(await ctx.FootballEspn.scoreboard('nat'), []);
  assert.deepEqual(ctx.requests, [], 'no request for the team list or the board');
});
test('nat: matches merged from the leagues, deduped by event id, sorted, logo kept; <= 6 requests', async () => {
  const ctx = context(memory(), natRoutes()),
    list = await ctx.FootballEspn.teamMatches('nat', '473');
  assert.deepEqual(list.map((m) => m.id), ['n3', 'n2', 'n1', 'n4'], 'dedupe n1, sorted by start');
  assert.ok(list.every((m) => m.competition === 'nat'));
  assert.ok(ctx.requests.length <= 6 && ctx.requests.length === 5, 'requests: ' + ctx.requests.length);
  assert.deepEqual(
    ctx.requests.filter((u) => /fixture=true/.test(u)),
    [BASE + 'fifa.friendly/teams/473/schedule?fixture=true'],
    'fixtures only from the league with the newest match'
  );
  assert.equal(list[2].home.logo, 'https://a.espncdn.com/i/teamlogos/countries/500/rou.png');
  assert.equal(list[3].state, 'pre');
  assert.equal(list[3].away.name, 'Romania');
});
test('nat: a failing league is skipped, all failing rejects, nothing at all gives []', async () => {
  const routes = natRoutes();
  routes[BASE + 'uefa.nations/teams/473/schedule'] = 'net';
  delete routes[BASE + 'uefa.euro/teams/473/schedule'];
  const ctx = context(memory(), routes);
  assert.deepEqual((await ctx.FootballEspn.teamMatches('nat', '473')).map((m) => m.id), ['n2', 'n1', 'n4']);
  const none = {};
  NATIONAL_SLUGS.forEach((s) => (none[BASE + s + '/teams/473/schedule'] = 'net'));
  await assert.rejects(context(memory(), none).FootballEspn.teamMatches('nat', '473'));
  const empty = {};
  NATIONAL_SLUGS.forEach((s) => (empty[BASE + s + '/teams/473/schedule'] = natfx('empty')));
  const ctx3 = context(memory(), empty);
  assert.deepEqual(await ctx3.FootballEspn.teamMatches('nat', '473'), []);
  assert.equal(ctx3.requests.length, 4, 'no league has matches: no fixture request');
});
test('nat: store accepts it (competition and team), counts towards the 5; statuses and card use it', async () => {
  const mem = memory(),
    ctx = context(mem, natRoutes());
  ctx.HomeFootball.setClock(() => new Date('2026-11-16T12:00:00Z'));
  ctx.HomeInfo.football.set({
    competitions: ['nat', 'zzz.1'],
    teams: [{ competition: 'nat', id: '473', name: 'Romania' }, { competition: 'zzz.1', id: '1', name: 'X' }]
  });
  assert.deepEqual(ctx.HomeInfo.football.get().competitions, ['nat']);
  assert.deepEqual(ctx.HomeInfo.football.get().teams, [{ competition: 'nat', id: '473', name: 'Romania' }]);
  const t = (i) => ({ competition: 'eng.1', id: String(i), name: 'T' + i });
  ctx.HomeInfo.football.set({ teams: [{ competition: 'nat', id: '473', name: 'Romania' }, t(1), t(2), t(3), t(4), t(5)] });
  assert.equal(ctx.HomeInfo.football.get().teams.length, 5);
  ctx.HomeInfo.football.set({ teams: [{ competition: 'nat', id: '473', name: 'Romania' }] });
  const r = await ctx.HomeFootball.refresh();
  assert.equal(r.state, 'ok');
  const items = ctx.HomeFootball.landingItems();
  assert.equal(items.length, 2, 'next match and last result (two events)');
  assert.equal(items[0].kind, 'next');
  assert.equal(items[1].kind, 'last');
  assert.equal(items[0].match.away.name, 'Romania');
  assert.match(ctx.HomeFootball.idleLines()[0], /Bosnia – Romania 20\.11/);
  const reqs = ctx.requests.length;
  await ctx.HomeFootball.refresh();
  assert.equal(ctx.requests.length, reqs, 'cached (hourly): no new requests');
});
// Main-page Football card items: up to 2 different matches, live first, then the next ones by start, then the last result.
function landingCtx(teams, board, teamLists) {
  const mem = memory(),
    ctx = context(mem, {});
  ctx.HomeFootball.setClock(() => new Date('2026-11-16T12:00:00Z'));
  ctx.HomeInfo.football.set({ competitions: ['eng.1'], teams: teams.map((id) => ({ competition: 'eng.1', id, name: 'T' + id })) });
  mem.data['tvhome.football.snapshot.v1'] = JSON.stringify({ boards: { 'eng.1': board }, teams: teamLists || {} });
  return ctx;
}
const M = (id, h, a, state, start, hs, as) => ({
  id,
  competition: 'eng.1',
  home: { id: h, name: 'H' + h, score: state === 'pre' ? null : hs },
  away: { id: a, name: 'A' + a, score: state === 'pre' ? null : as },
  start,
  state,
  clock: state === 'in' ? "34'" : ''
});
test('landingItems: no event -> none; one -> one; three -> two in priority order', () => {
  assert.deepEqual(landingCtx(['1', '2', '3'], []).HomeFootball.landingItems(), []);
  const one = landingCtx(['1'], [M('a', '1', '9', 'pre', '2026-11-20T15:00:00Z')]).HomeFootball.landingItems();
  assert.deepEqual(one.map((x) => [x.kind, x.match.id]), [['next', 'a']]);
  const three = landingCtx(['1', '2', '3'], [
    M('last', '3', '9', 'post', '2026-11-14T15:00:00Z', 1, 0),
    M('next', '2', '8', 'pre', '2026-11-21T15:00:00Z'),
    M('live', '1', '7', 'in', '2026-11-16T11:00:00Z', 2, 2)
  ]).HomeFootball.landingItems();
  assert.deepEqual(three.map((x) => [x.kind, x.match.id]), [['live', 'live'], ['next', 'next']]);
  assert.match(three[0].text, /^Live 34' · 2 - 2$/);
  assert.match(three[1].text, /^21\.11 \d\d:\d\d$/);
});
test('landingItems: nexts by start time, last result only when nothing else, same match once', () => {
  const nexts = landingCtx(['1', '2', '3'], [
    M('late', '1', '7', 'pre', '2026-11-25T15:00:00Z'),
    M('soon', '2', '8', 'pre', '2026-11-18T15:00:00Z'),
    M('mid', '3', '9', 'pre', '2026-11-20T15:00:00Z')
  ]).HomeFootball.landingItems();
  assert.deepEqual(nexts.map((x) => x.match.id), ['soon', 'mid']);
  const lasts = landingCtx(['1', '2', '3'], [
    M('old', '1', '7', 'post', '2026-11-01T15:00:00Z', 1, 0),
    M('new', '2', '8', 'post', '2026-11-14T15:00:00Z', 0, 0)
  ]).HomeFootball.landingItems();
  assert.deepEqual(lasts.map((x) => [x.kind, x.match.id]), [['last', 'new'], ['last', 'old']]);
  // Two followed teams playing each other: the match is listed once, the next item is another match.
  const dup = landingCtx(['1', '2'], [
    M('derby', '1', '2', 'pre', '2026-11-19T15:00:00Z'),
    M('other', '1', '5', 'post', '2026-11-10T15:00:00Z', 3, 1)
  ]).HomeFootball.landingItems();
  assert.equal(dup.filter((x) => x.match.id === 'derby').length, 1);
  assert.deepEqual(dup.map((x) => x.match.id), ['derby', 'other']);
  // One team with a live match and a next one: both items (priority live, next).
  const both = landingCtx(['1'], [], {
    'eng.1:1': [M('l', '1', '7', 'in', '2026-11-16T11:00:00Z', 0, 1), M('n', '1', '8', 'pre', '2026-11-23T15:00:00Z')]
  }).HomeFootball.landingItems();
  assert.deepEqual(both.map((x) => [x.kind, x.match.id]), [['live', 'l'], ['next', 'n']]);
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
