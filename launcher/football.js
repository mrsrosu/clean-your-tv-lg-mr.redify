/* Home info: football page (info panel) and the "Football" Settings tab, mr.redify only.
 *
 * Data comes from launcher/football-espn.js (HomeInfoFetch.cached, so the last values survive being offline).
 * Store HomeInfo.football (tvhome.football.v1): ticked competitions plus 1 to 5 followed teams (empty is the initial
 * state). The page shows, for every followed team, the live score / next match / last result, and today's matches of
 * the ticked competitions. No standings.
 *
 * refresh() is exported (the idle screen calls it too). While the page is shown it re-runs every hour, every 60 s
 * while a followed team is live; no timer while the page is hidden or the scope is off. A small snapshot of the last
 * answers (tvhome.football.snapshot.v1) feeds idleLines() synchronously, with no request.
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
    TTL_LIVE = 50000, // a little under the 60 s timer
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
      before = readSnap(),
      wasLive;
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
    wasLive = statuses(before, clock().toISOString()).some(function (x) {
      return !!x.status.live;
    });
    var ttl = wasLive ? TTL_LIVE : TTL_HOURLY,
      jobs = [];
    comps.forEach(function (c) {
      jobs.push({
        kind: 'boards',
        key: c,
        cache: ck('fb.sb.', c),
        load: function () {
          return provider(c).scoreboard(c);
        }
      });
    });
    s.teams.forEach(function (x) {
      jobs.push({
        kind: 'teams',
        key: teamKey(x),
        cache: ck('fb.tm.', x.competition) + '.' + x.id,
        load: function () {
          return provider(x.competition)
            .teamMatches(x.competition, x.id)
            .then(function (list) {
              return windowed(list, nowMs);
            });
        }
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
    timer = null,
    generation = 0,
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
  function schedule(live, mine) {
    if (timer) root.clearTimeout(timer);
    timer = null;
    if (!visible || mine !== generation) return;
    timer = root.setTimeout(
      function () {
        timer = null;
        update(mine);
      },
      live ? 60000 : HOUR
    );
  }
  function update(mine) {
    return refresh().then(function (result) {
      if (mine !== generation) return;
      last = result;
      if (visible) {
        render();
        schedule(result.live, mine);
      }
    });
  }
  function onShow() {
    visible = true;
    last = null;
    generation++;
    render();
    update(generation);
  }
  function onHide() {
    visible = false;
    generation++;
    if (timer) root.clearTimeout(timer);
    timer = null;
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
    label: label,
    logoNode: function (url, size) {
      return logoNode(url, size, false);
    },
    clockText: clockText,
    setClock: function (fn) {
      clock = fn;
    }
  };
  if (info && store) {
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
