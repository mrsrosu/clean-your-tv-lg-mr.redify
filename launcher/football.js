/* Home info: football page (info panel) and the "Football" Settings tab, mr.redify only.
 *
 * Data comes from launcher/football-espn.js (HomeInfoFetch.cached, so the last values survive being offline).
 * Store HomeInfo.football (tvhome.football.v1): ticked competitions plus 1 to 5 followed teams (empty is the initial
 * state). The page shows, for every followed team, the live score / next match / last result, and today's matches of
 * the ticked competitions. No standings.
 *
 * One scheduler (attach/detach of consumers: this page while shown, the main-page card, the idle info panel) keeps the
 * data fresh: a full refresh at most hourly, a wake-up at the kickoff of a followed match, and from kickoff to
 * kickoff + 130 minutes a narrow live refresh of that match's competition only (see "the scheduler" below). No timer
 * without a consumer, with the scope off or a hidden document. A small snapshot of the last answers
 * (tvhome.football.snapshot.v1) feeds idleLines() synchronously, with no request.
 * The page has no keys of its own: Left/Right fall through to the info panel.
 */
(function (root) {
  'use strict';
  var doc = root.document,
    info = root.HomeInfo,
    espn = root.FootballEspn, // also the single list of competitions (ids and names)
    sportsdb = root.FootballSportsDb, // Liga 1 (rou.1): ESPN data for it is stale
    MAX_TEAMS = 5,
    HOUR = 3600000,
    TTL_HOURLY = 55 * 60000, // a little under the hourly timer, so the timer always finds the cache expired
    LIVE_WINDOW = 130 * 60000, // a followed match is "possibly live" from kickoff to kickoff + 130 minutes
    KICKOFF_WAKE = 60000, // the scheduler wakes this long after a followed kickoff inside the coming hour
    LIVE_EVERY = { espn: 60000, sdb: 120000 }, // live cadence per provider
    LIVE_TTL_ESPN = 55000, // a little under the 60 s poll
    CAPS = { espn: 10, sdb: 3 }, // most requests per minute the live polls may bring a provider to
    BACKOFF_MS = 3 * 60000, // a provider that answered with an error is left alone this long
    TTL_TEAMS = 7 * 86400000,
    GRACE = 2 * HOUR, // a "pre" match this long after its start still counts as the next one
    SNAP_KEY = 'tvhome.football.snapshot.v1',
    clock = function () {
      return new Date();
    };

  // Provider of a competition: SportsDB for rou.1, ESPN for every other id.
  function provider(id) {
    return sportsdb && sportsdb.handles(id) ? sportsdb : espn;
  }
  // Cache keys of a provider's data: ESPN's stay as they were; SportsDB's are separate (other team ids).
  function ck(prefix, id) {
    return prefix + (provider(id).keyTag || '') + id;
  }

  function t(text) {
    return root.HomeI18n ? root.HomeI18n.t(text) : text;
  }
  // Provider clocks are minutes ("34'") or, from TheSportsDB, status codes; codes are translated, minutes pass through.
  function clockText(c) {
    switch (c) {
      case 'HT':
        return t('Half time');
      case 'ET':
        return t('Extra time');
      case 'P':
        return t('Penalties');
      case 'BT':
        return t('Break');
      case '1H':
      case '2H':
      case 'LIVE':
        return t('Live');
      case 'FT':
        return t('FT');
    }
    return c || '';
  }
  function competitionName(id) {
    var list = espn ? espn.competitions : [];
    for (var i = 0; i < list.length; i++)
      if (list[i].id === id) return list[i].name;
    return id;
  }
  // Romania's national team is stored and fetched under ESPN's name; the Romanian UI shows its own spelling.
  function label(name) {
    return name === 'Romania' ? t('Romania') : name;
  }
  function known(id) {
    var list = espn ? espn.competitions : [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return true;
    return false;
  }

  // ---- store ----
  function sanitizeCompetitions(list) {
    if (!Array.isArray(list)) return null;
    var out = [];
    for (var i = 0; i < list.length; i++)
      if (
        typeof list[i] === 'string' &&
        known(list[i]) &&
        out.indexOf(list[i]) < 0
      )
        out.push(list[i]);
    return out;
  }
  function sanitizeTeams(list) {
    if (!Array.isArray(list)) return null;
    var out = [],
      seen = {};
    for (var i = 0; i < list.length && out.length < MAX_TEAMS; i++) {
      var x = list[i];
      if (
        x &&
        typeof x === 'object' &&
        typeof x.competition === 'string' &&
        known(x.competition) &&
        typeof x.id === 'string' &&
        x.id !== '' &&
        typeof x.name === 'string' &&
        x.name !== '' &&
        !seen[x.competition + ':' + x.id]
      ) {
        seen[x.competition + ':' + x.id] = true;
        out.push({ competition: x.competition, id: x.id, name: x.name });
      }
    }
    return out;
  }
  var store = null;
  if (info && info.createStore && espn) {
    store = info.createStore(
      'tvhome.football.v1',
      { competitions: [], teams: [], landing: false },
      function (raw) {
        var out = {},
          list;
        if (
          'competitions' in raw &&
          (list = sanitizeCompetitions(raw.competitions))
        )
          out.competitions = list;
        else if ('competitions' in raw && Array.isArray(raw.competitions))
          out.competitions = [];
        if ('landing' in raw) out.landing = raw.landing === true;
        if ('teams' in raw && (list = sanitizeTeams(raw.teams)))
          out.teams = list;
        return out;
      }
    );
    info.football = store;
  }

  // ---- status ----
  function ms(iso) {
    return Date.parse(iso);
  }
  // next: the earliest "pre" match (a few hours of grace after its start); last: the latest finished one; live: in play.
  function teamStatus(matches, teamId, nowIso) {
    var now = ms(nowIso),
      out = { next: null, last: null, live: null };
    if (!Array.isArray(matches)) return out;
    for (var i = 0; i < matches.length; i++) {
      var m = matches[i];
      if (
        !m ||
        typeof m !== 'object' ||
        !m.home ||
        !m.away ||
        (m.home.id !== teamId && m.away.id !== teamId) ||
        isNaN(ms(m.start))
      )
        continue;
      var at = ms(m.start);
      if (m.state === 'in') {
        if (!out.live || at < ms(out.live.start)) out.live = m;
      } else if (m.state === 'pre') {
        if (at >= now - GRACE && (!out.next || at < ms(out.next.start)))
          out.next = m;
      } else if (m.state === 'post') {
        if (!out.last || at > ms(out.last.start)) out.last = m;
      }
    }
    return out;
  }

  // ---- snapshot of the last answers ----
  function emptySnap() {
    return { boards: {}, teams: {} };
  }
  function readSnap() {
    try {
      var raw = JSON.parse(root.localStorage.getItem(SNAP_KEY));
      if (
        raw &&
        typeof raw === 'object' &&
        raw.boards &&
        typeof raw.boards === 'object' &&
        raw.teams &&
        typeof raw.teams === 'object'
      )
        return raw;
    } catch (_) {}
    return emptySnap();
  }
  function writeSnap(snap) {
    try {
      root.localStorage.setItem(SNAP_KEY, JSON.stringify(snap));
    } catch (_) {}
  }
  function teamKey(team) {
    return team.competition + ':' + team.id;
  }
  // Matches of one followed team: its own list plus the competition's scoreboard (fresher, carries live scores).
  function matchesOf(snap, team) {
    var byId = {},
      out = [];
    function add(m) {
      if (
        m &&
        m.home &&
        m.away &&
        (m.home.id === team.id || m.away.id === team.id)
      )
        byId[m.id] = m;
    }
    (Array.isArray(snap.teams[teamKey(team)])
      ? snap.teams[teamKey(team)]
      : []
    ).forEach(add);
    (Array.isArray(snap.boards[team.competition])
      ? snap.boards[team.competition]
      : []
    ).forEach(add);
    for (var id in byId)
      if (Object.prototype.hasOwnProperty.call(byId, id)) out.push(byId[id]);
    return out;
  }
  function statuses(snap, nowIso) {
    return store.get().teams.map(function (team) {
      return {
        team: team,
        status: teamStatus(matchesOf(snap, team), team.id, nowIso)
      };
    });
  }

  // ---- refresh ----
  // Keeps the played matches near now and the next few: the cache and the snapshot stay small.
  function windowed(list, nowMs) {
    var post = [],
      pre = [],
      live = [];
    list.forEach(function (m) {
      if (m.state === 'in') live.push(m);
      else if (m.state === 'post') post.push(m);
      else if (ms(m.start) >= nowMs - 12 * HOUR) pre.push(m);
    });
    return post.slice(-3).concat(live, pre.slice(0, 3));
  }
  // Team ids differ between providers. A followed team of a competition that moved to SportsDB (rou.1, stored with an
  // ESPN id) is looked up by name in the provider's team list and re-saved with the new id; no match: it stays as it
  // is (shows no data until the user picks it again in Settings). Never rejects; no request unless such a team exists.
  function plain(name) {
    return String(name)
      .toLowerCase()
      .replace(/[ăâ]/g, 'a')
      .replace(/î/g, 'i')
      .replace(/[șş]/g, 's')
      .replace(/[țţ]/g, 't')
      .replace(/[^a-z0-9]/g, '');
  }
  function migrate() {
    var teams = store ? store.get().teams : [],
      comps = [];
    teams.forEach(function (x) {
      if (provider(x.competition) !== espn && comps.indexOf(x.competition) < 0)
        comps.push(x.competition);
    });
    if (!comps.length || !root.HomeInfoFetch) return root.Promise.resolve();
    return root.Promise.all(
      comps.map(function (c) {
        return root.HomeInfoFetch.cached(
          ck('fb.teams.', c),
          TTL_TEAMS,
          function () {
            return provider(c).teams(c);
          }
        ).then(
          function (r) {
            return { c: c, list: Array.isArray(r.value) ? r.value : [] };
          },
          function () {
            return { c: c, list: [] };
          }
        );
      })
    ).then(function (lists) {
      var changed = false,
        next = store.get().teams.map(function (x) {
          var entry = lists.filter(function (l) {
            return l.c === x.competition;
          })[0];
          if (!entry || !entry.list.length) return x;
          var hit = null,
            i;
          for (i = 0; i < entry.list.length; i++)
            if (entry.list[i].id === x.id) return x;
          for (i = 0; i < entry.list.length && !hit; i++)
            if (plain(entry.list[i].name) === plain(x.name))
              hit = entry.list[i];
          if (!hit) return x;
          changed = true;
          return { competition: x.competition, id: hit.id, name: hit.name };
        });
      if (changed) store.set({ teams: next });
    });
  }
  function refresh() {
    return migrate().then(refreshNow);
  }
  // Never rejects. state: ok | offline | empty (nothing configured: no request); live: a followed team is in play.
  function refreshNow() {
    var s = store ? store.get() : { competitions: [], teams: [] },
      comps = [],
      cache = root.HomeInfoFetch,
      nowMs = clock().getTime(),
      before = readSnap();
    function add(c) {
      if (comps.indexOf(c) < 0) comps.push(c);
    }
    s.competitions.forEach(add);
    s.teams.forEach(function (x) {
      add(x.competition);
    });
    if (!comps.length)
      return root.Promise.resolve({
        state: 'empty',
        fetchedAt: null,
        live: false
      });
    if (!cache)
      return root.Promise.resolve({
        state: 'offline',
        fetchedAt: null,
        live: false
      });
    var ttl = TTL_HOURLY,
      jobs = [];
    comps.forEach(function (c) {
      jobs.push({
        kind: 'boards',
        key: c,
        cache: ck('fb.sb.', c),
        load: guarded(providerKind(c), function () {
          return provider(c).scoreboard(c);
        })
      });
    });
    s.teams.forEach(function (x) {
      jobs.push({
        kind: 'teams',
        key: teamKey(x),
        cache: ck('fb.tm.', x.competition) + '.' + x.id,
        load: guarded(providerKind(x.competition), function () {
          return provider(x.competition)
            .teamMatches(x.competition, x.id)
            .then(function (list) {
              return windowed(list, nowMs);
            });
        })
      });
    });
    return root.Promise.all(
      jobs.map(function (job) {
        return cache.cached(job.cache, ttl, job.load).then(
          function (r) {
            return {
              job: job,
              value: r.value,
              fetchedAt: r.fetchedAt,
              stale: r.stale
            };
          },
          function () {
            return { job: job, failed: true };
          }
        );
      })
    ).then(function (results) {
      var snap = emptySnap(),
        oldest = null,
        offline = false;
      // Entries that failed keep their previous snapshot value.
      comps.forEach(function (c) {
        if (before.boards[c]) snap.boards[c] = before.boards[c];
      });
      s.teams.forEach(function (x) {
        if (before.teams[teamKey(x)])
          snap.teams[teamKey(x)] = before.teams[teamKey(x)];
      });
      results.forEach(function (r) {
        if (r.failed) {
          offline = true;
          return;
        }
        if (r.stale) offline = true;
        if (!Array.isArray(r.value)) return;
        snap[r.job.kind][r.job.key] = r.value;
        if (oldest === null || r.fetchedAt < oldest) oldest = r.fetchedAt;
      });
      writeSnap(snap);
      return {
        state: offline ? 'offline' : 'ok',
        fetchedAt: oldest,
        live: statuses(snap, clock().toISOString()).some(function (x) {
          return !!x.status.live;
        })
      };
    });
  }

  // ---- the scheduler: one for every consumer (page, main-page card, idle panel) ----
  // Base: a full refresh at most hourly. A followed match's kickoff inside the coming hour wakes it at kickoff + 60 s.
  // From kickoff to kickoff + 130 minutes (while the state is pre or in) only the competition of that match is asked:
  // ESPN's scoreboard every 60 s (a national team: the scoreboard of the league of the match), Liga 1's one round every
  // 120 s. Per provider at most 10 (ESPN) / 3 (TheSportsDB) requests a minute for live polls (the rest waits for the next
  // tick), and 3 minutes of silence after an error. Nothing runs without a consumer, with the scope off, a hidden
  // document, or nothing followed.
  var consumers = {},
    schedTimer = null,
    busy = false,
    lastFull = 0,
    lastNeedFull = 0,
    lastPoll = {},
    backoffUntil = { espn: 0, sdb: 0 },
    reqLog = { espn: [], sdb: [] };
  function providerKind(id) {
    return sportsdb && sportsdb.handles(id) ? 'sdb' : 'espn';
  }
  // A provider call that waits out the backoff instead of asking.
  function guarded(kind, fn) {
    return function () {
      if (backoffUntil[kind] > clock().getTime())
        return root.Promise.reject(new Error('football-backoff'));
      return fn();
    };
  }
  if (root.HomeInfoFetch && root.HomeInfoFetch.onRequest)
    root.HomeInfoFetch.onRequest(function (url) {
      var kind = /espn\.com/.test(url) ? 'espn' : /thesportsdb\.com/.test(url) ? 'sdb' : '';
      if (kind) reqLog[kind].push(clock().getTime());
    });
  function recent(kind, now) {
    var log = reqLog[kind];
    while (log.length && log[0] <= now - 60000) log.shift();
    return log.length;
  }
  function hasConsumers() {
    for (var k in consumers)
      if (Object.prototype.hasOwnProperty.call(consumers, k)) return true;
    return false;
  }
  function schedActive() {
    var s = store && store.get();
    return !!(
      s &&
      (s.teams.length || s.competitions.length) &&
      hasConsumers() &&
      info.isMrRedify() &&
      !(doc && doc.hidden)
    );
  }
  // What a possibly-live followed match needs: { key, kind, every, end, load } or { needFull } when the stored match
  // predates the fields the live refresh needs (one full refresh brings them).
  function liveTargets(now) {
    var snap = readSnap(),
      out = {};
    (store ? store.get().teams : []).forEach(function (team) {
      matchesOf(snap, team).forEach(function (m) {
        var start = ms(m.start),
          c = team.competition,
          t;
        if (m.state !== 'pre' && m.state !== 'in') return;
        if (isNaN(start) || now < start || now >= start + LIVE_WINDOW) return;
        if (c === 'nat')
          t = m.league
            ? { key: 'nat:' + m.league, kind: 'espn', slug: m.league }
            : { key: 'nat?', needFull: true };
        else if (providerKind(c) === 'sdb')
          t =
            m.round && m.season
              ? { key: c + ':' + m.round + ':' + m.season, kind: 'sdb', comp: c, round: m.round, season: m.season }
              : { key: c + '?', needFull: true };
        else t = { key: c, kind: 'espn', comp: c };
        t.every = LIVE_EVERY[t.kind || 'espn'];
        t.end = start + LIVE_WINDOW;
        if (!out[t.key]) out[t.key] = t;
      });
    });
    return Object.keys(out).map(function (k) {
      return out[k];
    });
  }
  // The earliest instant a live poll of this target may go out (cadence, backoff, per-minute cap).
  function nextPollAt(t, now) {
    var at = (lastPoll[t.key] || 0) + t.every,
      log;
    at = Math.max(at, backoffUntil[t.kind]);
    if (recent(t.kind, now) >= CAPS[t.kind]) {
      log = reqLog[t.kind];
      at = Math.max(at, log[log.length - CAPS[t.kind]] + 60000 + 1);
    }
    return at;
  }
  function liveLoad(t) {
    var cache = root.HomeInfoFetch;
    if (t.slug)
      return cache.cached('fb.lg.' + t.slug, LIVE_TTL_ESPN, function () {
        return espn.leagueBoard(t.slug);
      });
    if (t.kind === 'sdb')
      return sportsdb.liveRound(t.comp, t.round, t.season).then(function (list) {
        return { value: list, stale: false };
      });
    return cache.cached(ck('fb.sb.', t.comp), LIVE_TTL_ESPN, function () {
      return provider(t.comp).scoreboard(t.comp);
    });
  }
  // One live poll: merge the answer into the snapshot's board of that competition (Liga 1: only the round's matches);
  // an error silences the provider for 3 minutes. Never rejects.
  function pollOne(t) {
    lastPoll[t.key] = clock().getTime();
    var started;
    try {
      started = root.Promise.resolve(liveLoad(t));
    } catch (e) {
      started = root.Promise.reject(e);
    }
    return started
      .then(function (r) {
        if (r.stale || !Array.isArray(r.value)) throw new Error('football-stale');
        var snap = readSnap(),
          comp = t.slug ? 'nat' : t.comp,
          list = r.value;
        if (t.kind === 'sdb' && Array.isArray(snap.boards[comp])) {
          var fresh = {};
          list.forEach(function (m) {
            fresh[m.id] = m;
          });
          list = snap.boards[comp]
            .filter(function (m) {
              return !fresh[m.id];
            })
            .concat(list);
        }
        snap.boards[comp] = list;
        writeSnap(snap);
        return true;
      })
      .then(null, function () {
      // Also a stale answer (the request failed and an old copy answered) counts as an error.
      backoffUntil[t.kind] = clock().getTime() + BACKOFF_MS;
      return false;
    });
  }
  function notify(result) {
    for (var k in consumers)
      if (Object.prototype.hasOwnProperty.call(consumers, k))
        try {
          consumers[k](result);
        } catch (_) {}
  }
  function fullRefresh() {
    busy = true;
    var run = (root.HomeFootball && root.HomeFootball.refresh) || refresh;
    return run().then(
      function (result) {
        lastFull = clock().getTime();
        busy = false;
        notify(result);
        plan();
      },
      function () {
        lastFull = clock().getTime();
        busy = false;
        plan();
      }
    );
  }
  function tick() {
    schedTimer = null;
    if (!schedActive() || busy) return;
    var now = clock().getTime(),
      targets,
      due = [],
      planned = { espn: 0, sdb: 0 };
    if (!lastFull || now - lastFull >= HOUR) return fullRefresh();
    targets = liveTargets(now);
    if (
      targets.some(function (t) {
        return t.needFull;
      })
    ) {
      // A stored match without what the live refresh needs: one full refresh (at most every 5 minutes).
      if (now - lastNeedFull >= 5 * 60000) {
        lastNeedFull = now;
        return fullRefresh();
      }
    }
    targets.forEach(function (t) {
      if (t.needFull) return;
      if (nextPollAt(t, now) <= now && recent(t.kind, now) + planned[t.kind] < CAPS[t.kind]) {
        planned[t.kind]++;
        due.push(t);
      }
    });
    if (!due.length) return plan();
    busy = true;
    root.Promise.all(due.map(pollOne)).then(function () {
      var at = clock().getTime();
      busy = false;
      notify({
        state: backoffUntil.espn > at || backoffUntil.sdb > at ? 'offline' : 'ok',
        fetchedAt: at,
        live: liveTargets(at).length > 0
      });
      plan();
    });
  }
  // Sets the single timer to the earliest of: the next hourly refresh, kickoff + 60 s of a followed match in the coming
  // hour, the next allowed live poll of every possibly-live match.
  function plan() {
    if (schedTimer) root.clearTimeout(schedTimer);
    schedTimer = null;
    if (!schedActive() || busy) return;
    var now = clock().getTime(),
      next = lastFull ? lastFull + HOUR : now,
      snap = readSnap();
    (store ? store.get().teams : []).forEach(function (team) {
      matchesOf(snap, team).forEach(function (m) {
        var start = ms(m.start);
        if (m.state === 'pre' && start > now && start <= now + HOUR)
          next = Math.min(next, start + KICKOFF_WAKE);
      });
    });
    liveTargets(now).forEach(function (t) {
      next = Math.min(next, t.needFull ? now + 5 * 60000 : nextPollAt(t, now));
    });
    schedTimer = root.setTimeout(tick, Math.max(1000, next - now));
  }
  // Re-evaluates at once (a consumer came, the scope or the visibility changed).
  function wake() {
    if (schedTimer) root.clearTimeout(schedTimer);
    schedTimer = null;
    tick();
  }
  // A consumer (name free) asks to be kept up to date; cb(result) runs after every refresh or live poll.
  function attach(name, cb) {
    consumers[name] = typeof cb === 'function' ? cb : function () {};
    // A new consumer starts with a full refresh; it costs requests only for what the 55 minute cache no longer holds.
    lastFull = 0;
    wake();
  }
  function detach(name) {
    delete consumers[name];
    if (!hasConsumers()) {
      if (schedTimer) root.clearTimeout(schedTimer);
      schedTimer = null;
    }
  }

  // ---- text ----
  function two(n) {
    return (n < 10 ? '0' : '') + n;
  }
  function dayOf(iso) {
    var d = new Date(ms(iso));
    return two(d.getDate()) + '.' + two(d.getMonth() + 1);
  }
  function timeOf(iso) {
    var d = new Date(ms(iso));
    return two(d.getHours()) + ':' + two(d.getMinutes());
  }
  function stamp(at) {
    var d = new Date(at);
    return (
      two(d.getDate()) +
      '.' +
      two(d.getMonth() + 1) +
      ' ' +
      two(d.getHours()) +
      ':' +
      two(d.getMinutes())
    );
  }
  function scoreText(m) {
    function n(v) {
      return v === null || v === undefined ? '?' : String(v);
    }
    return (
      label(m.home.name) +
      ' ' +
      n(m.home.score) +
      '-' +
      n(m.away.score) +
      ' ' +
      label(m.away.name)
    );
  }
  function versus(m) {
    return label(m.home.name) + ' – ' + label(m.away.name);
  }
  function idleLines() {
    var out = [],
      snap = readSnap();
    if (!store) return out;
    statuses(snap, clock().toISOString()).forEach(function (x) {
      var line = '';
      if (x.status.live)
        line =
          scoreText(x.status.live) +
          (x.status.live.clock ? ' ' + clockText(x.status.live.clock) : '');
      else if (x.status.next)
        line =
          versus(x.status.next) +
          ' ' +
          dayOf(x.status.next.start) +
          ' ' +
          timeOf(x.status.next.start);
      if (line && out.indexOf(line) < 0) out.push(line);
    });
    return out;
  }

  // Main-page card (landing-widgets.js), stored data only, no request. Up to 2 different matches from the followed
  // teams, by priority: live matches first, then the next matches by start time, then the last results (newest first);
  // a match two followed teams play against each other counts once. Items { kind: 'live'|'next'|'last', match, text }
  // where text is the second line (live minute and score, kick-off, final score and day).
  function landingItems() {
    var live = [],
      next = [],
      last = [],
      seen = {},
      snap = readSnap();
    if (!store) return [];
    statuses(snap, clock().toISOString()).forEach(function (x) {
      [
        ['live', x.status.live, live],
        ['next', x.status.next, next],
        ['last', x.status.last, last]
      ].forEach(function (c) {
        if (c[1]) c[2].push({ kind: c[0], match: c[1] });
      });
    });
    next.sort(function (a, b) {
      return ms(a.match.start) - ms(b.match.start);
    });
    last.sort(function (a, b) {
      return ms(b.match.start) - ms(a.match.start);
    });
    live.sort(function (a, b) {
      return ms(a.match.start) - ms(b.match.start);
    });
    return live
      .concat(next, last)
      .filter(function (p) {
        if (seen[p.match.id]) return false;
        seen[p.match.id] = true;
        return true;
      })
      .slice(0, 2)
      .map(function (p) {
        var m = p.match,
          score =
            (m.home.score === null ? '?' : m.home.score) +
            ' - ' +
            (m.away.score === null ? '?' : m.away.score);
        return {
          kind: p.kind,
          match: m,
          text:
            p.kind === 'live'
              ? t('Live') +
                (m.clock ? ' ' + clockText(m.clock) : '') +
                ' · ' +
                score
              : p.kind === 'next'
                ? dayOf(m.start) + ' ' + timeOf(m.start)
                : t('FT') + ' ' + score + ' · ' + dayOf(m.start)
        };
      });
  }

  // ---- team logos ----
  // At most this many <img> per render of the page / tab (the old engine decodes them all on the main thread).
  var MAX_LOGOS = 40,
    logosLeft = MAX_LOGOS;
  function resetLogos() {
    logosLeft = MAX_LOGOS;
  }
  // TheSportsDB serves smaller renditions with a size suffix; if that URL fails the plain one is tried once.
  function sized(url) {
    return /^https:\/\/(www|r2)\.thesportsdb\.com\//.test(url) &&
      !/\/(tiny|small|medium|large)$/.test(url)
      ? url + '/tiny'
      : url;
  }
  // <img> for a logo URL, or null (invalid / not an allowed host / budget used up). Explicit size, no alt text; a
  // broken image removes itself (no broken-image icon). The URL is re-validated here: cached data is not trusted.
  function logoNode(url, size, counted) {
    var check = root.HomeInfoFetch && root.HomeInfoFetch.logoUrl,
      safeUrl = check ? check(url) : '';
    if (!safeUrl || !doc || !doc.createElement) return null;
    if (counted) {
      if (logosLeft <= 0) return null;
      logosLeft--;
    }
    var img = doc.createElement('img'),
      first = sized(safeUrl),
      retried = false;
    img.className = 'fb-logo';
    img.alt = '';
    img.width = size;
    img.height = size;
    img.onerror = function () {
      if (!retried && first !== safeUrl) {
        retried = true;
        img.src = safeUrl;
        return;
      }
      img.onerror = null;
      if (img.parentNode) img.parentNode.removeChild(img);
    };
    img.src = first;
    return img;
  }
  // Logo of a team id seen in a match (home or away side), '' when none.
  function logoIn(match, teamId) {
    if (!match) return '';
    if (match.home && match.home.id === teamId) return match.home.logo || '';
    if (match.away && match.away.id === teamId) return match.away.logo || '';
    return '';
  }
  function logoOfStatus(st, teamId) {
    return (
      logoIn(st.live, teamId) || logoIn(st.next, teamId) || logoIn(st.last, teamId)
    );
  }

  // ---- page ----
  function el(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function statusText(result) {
    if (!result || result.state !== 'offline') return '';
    return result.fetchedAt
      ? t('Offline') + '. ' + t('Last updated') + ' ' + stamp(result.fetchedAt)
      : t('Football data unavailable');
  }
  function sameDay(iso, now) {
    var a = new Date(ms(iso));
    return (
      a.getFullYear() === now.getFullYear() &&
      a.getMonth() === now.getMonth() &&
      a.getDate() === now.getDate()
    );
  }
  var host = null,
    visible = false,
    last = null;

  function line(parent, cls, label, text) {
    var row = el('div', 'fb-line ' + cls);
    row.appendChild(el('span', 'fb-label', label));
    row.appendChild(el('span', 'fb-text', text));
    parent.appendChild(row);
  }
  function render() {
    if (!host || !store) return;
    var s = store.get(),
      snap = readSnap(),
      now = clock(),
      status = statusText(last);
    host.innerHTML = '';
    resetLogos();
    host.appendChild(el('div', 'fb-title', t('Football')));
    if (!s.competitions.length && !s.teams.length) {
      host.appendChild(el('div', 'fb-empty', t('Choose teams in Settings')));
      return;
    }
    if (s.teams.length) {
      var teamsBox = el('div', 'fb-section');
      teamsBox.appendChild(el('div', 'fb-heading', t('Followed teams')));
      statuses(snap, now.toISOString()).forEach(function (x) {
        var box = el('div', 'fb-team'),
          st = x.status;
        var head = el('div', 'fb-team-name'),
          headLogo = logoNode(logoOfStatus(st, x.team.id), 28, true);
        if (headLogo) head.appendChild(headLogo);
        head.appendChild(doc.createTextNode(label(x.team.name)));
        box.appendChild(head);
        if (st.live)
          line(
            box,
            'fb-live',
            t('Live') + (st.live.clock ? ' ' + clockText(st.live.clock) : ''),
            scoreText(st.live)
          );
        if (st.next) {
          line(
            box,
            'fb-next',
            t('Next'),
            versus(st.next) +
              ' · ' +
              dayOf(st.next.start) +
              ' ' +
              timeOf(st.next.start)
          );
          // The next match gets the big logos (about 40 px) around its text.
          var nextText = box.lastChild.lastChild,
            lh = logoNode(st.next.home.logo, 40, true),
            la = logoNode(st.next.away.logo, 40, true);
          if (lh) nextText.insertBefore(lh, nextText.firstChild);
          if (la) nextText.appendChild(la);
        }
        if (st.last)
          line(
            box,
            'fb-last',
            t('Last'),
            scoreText(st.last) + ' · ' + dayOf(st.last.start)
          );
        if (!st.live && !st.next && !st.last)
          box.appendChild(el('div', 'fb-none', t('No matches found')));
        teamsBox.appendChild(box);
      });
      host.appendChild(teamsBox);
    } else
      host.appendChild(el('div', 'fb-empty', t('Choose teams in Settings')));
    if (s.competitions.length) {
      var today = el('div', 'fb-section'),
        any = false;
      today.appendChild(el('div', 'fb-heading', t("Today's matches")));
      s.competitions.forEach(function (c) {
        var list = (Array.isArray(snap.boards[c]) ? snap.boards[c] : []).filter(
          function (m) {
            return m.state === 'in' || sameDay(m.start, now);
          }
        );
        if (!list.length) return;
        any = true;
        var group = el('div', 'fb-group');
        group.appendChild(el('div', 'fb-comp', competitionName(c)));
        list.forEach(function (m) {
          var row = el(
            'div',
            'fb-match' + (m.state === 'in' ? ' fb-live' : '')
          );
          row.appendChild(
            el(
              'span',
              'fb-when',
              m.state === 'pre'
                ? timeOf(m.start)
                : m.state === 'in'
                  ? clockText(m.clock) || t('Live')
                  : t('FT')
            )
          );
          var homeCell = el('span', 'fb-home', label(m.home.name)),
            awayCell = el('span', 'fb-away', label(m.away.name)),
            hl = logoNode(m.home.logo, 28, true),
            al = logoNode(m.away.logo, 28, true);
          if (hl) homeCell.appendChild(hl);
          if (al) awayCell.insertBefore(al, awayCell.firstChild);
          row.appendChild(homeCell);
          row.appendChild(
            el(
              'span',
              'fb-score',
              m.state === 'pre'
                ? t('vs')
                : (m.home.score === null ? '?' : m.home.score) +
                    ' - ' +
                    (m.away.score === null ? '?' : m.away.score)
            )
          );
          row.appendChild(awayCell);
          group.appendChild(row);
        });
        today.appendChild(group);
      });
      if (!any) today.appendChild(el('div', 'fb-none', t('No matches today')));
      host.appendChild(today);
    }
    if (status) host.appendChild(el('div', 'fb-status', status));
  }
  function onShow() {
    visible = true;
    last = null;
    render();
    attach('page', function (result) {
      last = result;
      if (visible) render();
    });
  }
  function onHide() {
    visible = false;
    detach('page');
  }

  // ---- settings tab: Football ----
  function button(cls, text) {
    var b = el('button', cls, text);
    b.type = 'button';
    return b;
  }
  function pressed(b, on) {
    b.className =
      b.className.replace(/ ?selected/g, '') + (on ? ' selected' : '');
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  function buildTab(pane) {
    var loaded = {}, // competition -> [{id,name}]
      failedAt = {}, // competition -> when the last load failed (retry after 30 s, not in a loop)
      loading = {},
      message = '';
    pane.classList.add('fb-tab');
    function loadTeams(c) {
      if (
        loaded[c] ||
        loading[c] ||
        !root.HomeInfoFetch ||
        Date.now() - (failedAt[c] || 0) < 30000
      )
        return;
      loading[c] = true;
      failedAt[c] = 0;
      root.HomeInfoFetch.cached(ck('fb.teams.', c), TTL_TEAMS, function () {
        return provider(c).teams(c);
      }).then(
        function (r) {
          loading[c] = false;
          loaded[c] = Array.isArray(r.value) ? r.value : [];
          draw();
        },
        function () {
          loading[c] = false;
          failedAt[c] = Date.now();
          draw();
        }
      );
    }
    function loadAll() {
      store.get().competitions.forEach(loadTeams);
    }
    function section(title) {
      var box = el('div', 'fb-section');
      box.appendChild(el('h3', 'fb-section-title', title));
      pane.appendChild(box);
      return box;
    }
    // A followed team's logo: from the loaded team list, else from its matches in the snapshot.
    function followedLogo(team) {
      var list = loaded[team.competition] || [],
        i,
        url = '';
      for (i = 0; i < list.length; i++)
        if (list[i].id === team.id) url = list[i].logo || '';
      if (url) return url;
      var ms_ = matchesOf(readSnap(), team);
      for (i = 0; i < ms_.length && !url; i++) url = logoIn(ms_[i], team.id);
      return url;
    }
    function setTeams(next, focusKey) {
      store.set({ teams: next });
      draw(focusKey);
    }
    function draw(focusKey) {
      var s = store.get(),
        active = doc.activeElement,
        keep =
          focusKey ||
          (active && pane.contains(active)
            ? active.getAttribute('data-fb')
            : null),
        first = null,
        target = null;
      function mark(b, key) {
        b.setAttribute('data-fb', key);
        if (!first) first = b;
        if (key === keep) target = b;
        return b;
      }
      pane.innerHTML = '';
      resetLogos();
      var lp = section(t('Show on main page')),
        lb = mark(
          button('fb-chip fb-landing', s.landing ? t('On') : t('Off')),
          'landing'
        );
      pressed(lb, s.landing);
      lb.onclick = function () {
        store.set({ landing: !store.get().landing });
        draw('landing');
      };
      lp.appendChild(lb);
      var comps = section(t('Competitions')),
        chips = el('div', 'fb-chips');
      espn.competitions.forEach(function (c) {
        var on = s.competitions.indexOf(c.id) >= 0,
          b = mark(button('fb-chip fb-comp-chip', t(c.name)), 'c:' + c.id);
        pressed(b, on);
        b.onclick = function () {
          var now = store.get().competitions,
            next = on
              ? now.filter(function (x) {
                  return x !== c.id;
                })
              : now.concat([c.id]);
          message = '';
          store.set({ competitions: next });
          if (!on && info.isMrRedify()) loadTeams(c.id);
          draw('c:' + c.id);
        };
        chips.appendChild(b);
      });
      comps.appendChild(chips);
      var followed = section(t('Followed teams')),
        list = el('div', 'fb-chips');
      if (!s.teams.length)
        followed.appendChild(el('div', 'fb-hint', t('No teams followed')));
      s.teams.forEach(function (x) {
        var b = mark(
          button('fb-chip fb-followed selected', label(x.name) + ' ✕'),
          'f:' + teamKey(x)
        );
        var fl = logoNode(followedLogo(x), 24, true);
        if (fl) b.insertBefore(fl, b.firstChild);
        b.setAttribute('aria-label', t('Remove') + ' ' + label(x.name));
        b.setAttribute('aria-pressed', 'true');
        b.onclick = function () {
          message = '';
          var rest = store.get().teams.filter(function (y) {
            return teamKey(y) !== teamKey(x);
          });
          setTeams(rest, 'f:' + (rest[0] ? teamKey(rest[0]) : ''));
        };
        list.appendChild(b);
      });
      followed.appendChild(list);
      var status = el('div', 'fb-status', message);
      followed.appendChild(status);
      s.competitions.forEach(function (c) {
        var box = section(t(competitionName(c))),
          row = el('div', 'fb-chips');
        if (loaded[c]) {
          loaded[c].forEach(function (team) {
            var mine = { competition: c, id: team.id, name: team.name };
            if (
              s.teams.some(function (y) {
                return teamKey(y) === teamKey(mine);
              })
            )
              return;
            var b = mark(
              button('fb-chip fb-team-chip', label(team.name)),
              't:' + teamKey(mine)
            );
            var tl = logoNode(team.logo, 24, true);
            if (tl) b.insertBefore(tl, b.firstChild);
            pressed(b, false);
            b.onclick = function () {
              var now = store.get().teams;
              if (now.length >= MAX_TEAMS) {
                message = t('At most 5 teams');
                draw('t:' + teamKey(mine));
                return;
              }
              message = '';
              setTeams(now.concat([mine]), 'f:' + teamKey(mine));
            };
            row.appendChild(b);
          });
          if (!loaded[c].length)
            box.appendChild(el('div', 'fb-hint', t('Teams unavailable')));
        } else
          box.appendChild(
            el(
              'div',
              'fb-hint',
              failedAt[c] ? t('Teams unavailable') : t('Loading teams…')
            )
          );
        box.appendChild(row);
      });
      if (!target && keep && /^f:/.test(keep))
        target = pane.querySelector('.fb-followed');
      if (target || (focusKey && first)) (target || first).focus();
    }
    draw();
    // Tabs are built at load, so nothing is fetched then. When focus first enters the pane (scope on only), the
    // team lists of the ticked competitions are loaded (cached for a week); later visits cost nothing.
    pane.addEventListener('focusin', function () {
      if (!info.isMrRedify()) return;
      var s = store.get(),
        before = JSON.stringify(loading);
      loadAll();
      if (JSON.stringify(loading) !== before) draw();
    });
  }

  root.HomeFootball = {
    teamStatus: teamStatus,
    refresh: refresh,
    idleLines: idleLines,
    landingItems: landingItems,
    attach: attach,
    detach: detach,
    wake: wake,
    // Test seam: scheduler state.
    schedulerState: function () {
      return { timer: schedTimer !== null, consumers: Object.keys(consumers), busy: busy, lastFull: lastFull };
    },
    label: label,
    logoNode: function (url, size) {
      return logoNode(url, size, false);
    },
    clockText: clockText,
    setClock: function (fn) {
      clock = fn;
      // The response cache follows the same clock (a test seam: TTLs and the scheduler agree on "now").
      if (root.HomeInfoFetch && root.HomeInfoFetch.setClock)
        root.HomeInfoFetch.setClock(function () {
          return clock().getTime();
        });
    }
  };
  if (info && store) {
    // Scope or visibility changes re-evaluate the scheduler at once (it then runs or stops).
    if (info.onScopeChange) info.onScopeChange(wake);
    // Another team or competition chosen in Settings: its data is fetched now, not at the next hourly refresh.
    if (info.onChange)
      info.onChange('tvhome.football.v1', function () {
        if (!hasConsumers()) return;
        lastFull = 0;
        wake();
      });
    if (doc && doc.addEventListener) doc.addEventListener('visibilitychange', wake);
    if (info.registerTab)
      info.registerTab({
        id: 'football',
        order: 40,
        label: 'Football',
        build: buildTab
      });
    if (root.InfoPanel)
      root.InfoPanel.registerPage({
        id: 'football',
        label: 'Football',
        render: function (container) {
          host = container;
          host.classList.add('fb-page');
        },
        onShow: onShow,
        onHide: onHide
      });
  }
})(window);
