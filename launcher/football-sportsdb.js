/* Home info: TheSportsDB football provider (Romanian Liga 1 only). The only file that knows TheSportsDB URLs.
 * Free public key 123, CORS open. The free key is rate limited hard (measured 16.11.2026: about 15 requests in a
 * burst, then HTTP 429 / error 1015 with retry-after ~110 s), so this provider asks for as little as possible:
 *   anchor   eventsnextleague + eventspastleague (1 event each: they only tell the season and the current rounds)
 *   rounds   eventsround.php?id=4691&r=<n>&s=<season>: a full matchday (8 matches, all 16 teams)
 * Same API as FootballEspn: scoreboard / teams / teamMatches, answers normalised to
 * Match { id, competition, home:{id,name,score}, away:{id,name,score}, start (ISO), state 'pre'|'in'|'post', clock }.
 * A payload of another shape yields [] (no exception); network errors reject. Team ids are SportsDB ids
 * (not ESPN's). lookup_all_teams answers the wrong league for id 4691, so the team list comes from a matchday.
 */
(function (root) {
  'use strict';
  var BASE = 'https://www.thesportsdb.com/api/v1/json/123/',
    LEAGUE = '4691',
    COMPETITIONS = [{ id: 'rou.1', name: 'Liga 1 România' }],
    TTL_ANCHOR = 20 * 60000, // which round is "now" changes rarely
    TTL_HOT = 115000, // the rounds around now: a little under the 120 s live poll, so a live poll really asks again
    TTL_COLD = 30 * 60000, // earlier / later rounds change little
    NEAR = 2; // rounds kept before the last played round and after the next one

  function handles(id) {
    for (var i = 0; i < COMPETITIONS.length; i++)
      if (COMPETITIONS[i].id === id) return true;
    return false;
  }
  function str(v) {
    return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
  }
  function obj(v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  }
  function score(v) {
    var n = typeof v === 'string' && v !== '' ? Number(v) : v;
    return typeof n === 'number' && isFinite(n) && n >= 0 ? n : null;
  }
  // strStatus: NS not started; FT/AET/PEN finished; 1H/2H/HT/ET/BT/P/LIVE in play; the rest (postponed, cancelled,
  // abandoned, unknown) is dropped.
  function stateOf(status) {
    var s = str(status).toUpperCase();
    if (s === 'NS' || s === 'NOT STARTED' || s === 'TBD') return 'pre';
    if (s === 'FT' || s === 'AET' || s === 'PEN' || s === 'MATCH FINISHED')
      return 'post';
    if (/^(1H|2H|HT|ET|BT|P|LIVE|INT)$/.test(s)) return 'in';
    return null;
  }
  // dateEvent + strTime are UTC.
  function startOf(e) {
    var d = str(e.dateEvent),
      tm = str(e.strTime) || '00:00:00',
      iso;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{2}:\d{2}(:\d{2})?$/.test(tm))
      return '';
    iso = d + 'T' + (tm.length === 5 ? tm + ':00' : tm) + 'Z';
    return isNaN(Date.parse(iso)) ? '' : iso;
  }
  // strHomeTeamBadge / strAwayTeamBadge come with the round payload (no extra request); '' unless an allowed host.
  function badge(v) {
    return root.HomeInfoFetch && root.HomeInfoFetch.logoUrl
      ? root.HomeInfoFetch.logoUrl(v)
      : '';
  }
  function withLogo(target, logo) {
    if (logo) target.logo = logo;
    return target;
  }
  function parseEvent(e, competition) {
    e = obj(e);
    if (!e) return null;
    var id = str(e.idEvent),
      state = stateOf(e.strStatus),
      start = startOf(e),
      hid = str(e.idHomeTeam),
      aid = str(e.idAwayTeam),
      hn = str(e.strHomeTeam),
      an = str(e.strAwayTeam);
    if (!id || !state || !start || !hid || !aid || !hn || !an) return null;
    var match = {
      id: id,
      competition: competition,
      home: withLogo(
        {
          id: hid,
          name: hn,
          score: state === 'pre' ? null : score(e.intHomeScore)
        },
        badge(e.strHomeTeamBadge)
      ),
      away: withLogo(
        {
          id: aid,
          name: an,
          score: state === 'pre' ? null : score(e.intAwayScore)
        },
        badge(e.strAwayTeamBadge)
      ),
      start: start,
      state: state,
      clock: state === 'in' ? str(e.strProgress) || str(e.strStatus) : ''
    };
    // The round and season the match belongs to (additive): the live refresh asks that one round only.
    var rnd = parseInt(str(e.intRound), 10),
      season = str(e.strSeason);
    if (rnd > 0 && /^\d{4}-\d{4}$/.test(season)) {
      match.round = rnd;
      match.season = season;
    }
    return match;
  }
  function parseMatches(payload, competition) {
    var list =
        obj(payload) && Array.isArray(payload.events) ? payload.events : [],
      out = [];
    for (var i = 0; i < list.length; i++) {
      var match = parseEvent(list[i], competition);
      if (match) out.push(match);
    }
    return out;
  }
  // [{season, round}] of the first raw event (the anchor answers hold one event).
  function anchorOf(payload) {
    var list =
        obj(payload) && Array.isArray(payload.events) ? payload.events : [],
      e = list.length ? obj(list[0]) : null,
      round = e ? parseInt(str(e.intRound), 10) : NaN,
      season = e ? str(e.strSeason) : '';
    return e && round > 0 && /^\d{4}-\d{4}$/.test(season)
      ? { season: season, round: round }
      : null;
  }

  function getJson(path) {
    return root.HomeInfoFetch.http(BASE + path).then(function (text) {
      try {
        return JSON.parse(text);
      } catch (_) {
        return null;
      }
    });
  }
  // Raw payload through the shared cache (also deduplicates parallel calls from several followed teams).
  // {value, stale}: stale = the request failed and an older cached payload answered.
  function memo(key, ttl, path) {
    return root.HomeInfoFetch.cached(key, ttl, function () {
      return getJson(path).then(function (p) {
        if (p === null) throw new Error('football-sportsdb-json'); // not JSON: not cached, the old value stays
        return p;
      });
    });
  }
  // {season, past, next, stale}: the rounds of the last played and the next match; either may be missing (season
  // start/end). Neither answering at all rejects.
  function anchor() {
    function one(which) {
      return memo(
        'fb.sdb.' + which,
        TTL_ANCHOR,
        'events' + which + 'league.php?id=' + LEAGUE
      ).then(
        function (r) {
          return { a: anchorOf(r.value), stale: r.stale };
        },
        function () {
          return null;
        }
      );
    }
    return root.Promise.all([one('next'), one('past')]).then(function (r) {
      if (!r[0] && !r[1]) throw new Error('football-sportsdb-anchor');
      var next = r[0] && r[0].a,
        past = r[1] && r[1].a;
      if (!next && !past) return null;
      return {
        season: (next || past).season,
        next: next ? next.round : null,
        past: past ? past.round : null,
        stale: !r[0] || !r[1] || r[0].stale || r[1].stale
      };
    });
  }
  function round(season, n, ttl, competition) {
    return memo(
      'fb.sdb.r.' + season + '.' + n,
      ttl,
      'eventsround.php?id=' + LEAGUE + '&r=' + n + '&s=' + season
    ).then(function (r) {
      return { list: parseMatches(r.value, competition), stale: r.stale };
    });
  }
  // Rounds to read: the two "hot" ones (last played, next) and NEAR more on each side.
  function plan(a) {
    var lo = a.past || a.next,
      hi = a.next || a.past,
      out = [],
      n;
    for (n = Math.max(1, lo - NEAR); n <= hi + NEAR; n++)
      out.push({ n: n, hot: n === a.past || n === a.next });
    return out;
  }
  // Rejects when the anchor or a hot round could not be fetched fresh (stale payload or error): the caller then keeps
  // its own cached answer and shows "offline". Failing cold rounds (earlier / later) are tolerated.
  function load(competition, hotOnly) {
    return anchor().then(function (a) {
      if (!a) return [];
      if (a.stale) throw new Error('football-sportsdb-stale');
      var rounds = plan(a).filter(function (x) {
        return !hotOnly || x.hot;
      });
      return root.Promise.all(
        rounds.map(function (x) {
          return round(
            a.season,
            x.n,
            x.hot ? TTL_HOT : TTL_COLD,
            competition
          ).then(
            function (r) {
              return { list: r.list, hot: x.hot, stale: r.stale };
            },
            function (e) {
              return { error: e, hot: x.hot };
            }
          );
        })
      ).then(function (parts) {
        var seen = {},
          out = [];
        parts.forEach(function (p) {
          if (p.hot && (p.error || p.stale))
            throw p.error || new Error('football-sportsdb-stale');
          (p.list || []).forEach(function (m) {
            if (!seen[m.id]) {
              seen[m.id] = true;
              out.push(m);
            }
          });
        });
        return out.sort(function (x, y) {
          return x.start < y.start ? -1 : x.start > y.start ? 1 : 0;
        });
      });
    });
  }
  function checked(competition) {
    return handles(competition)
      ? null
      : root.Promise.reject(new Error('football-unknown-competition'));
  }
  // Live refresh: only the round that holds the live match (one request; no anchor, no other round). A stale answer
  // (the request failed) rejects so that the caller can back off.
  function liveRound(competition, n, season) {
    var bad =
      checked(competition) ||
      (n > 0 && /^\d{4}-\d{4}$/.test(String(season))
        ? null
        : root.Promise.reject(new Error('football-round')));
    if (bad) return bad;
    return round(String(season), n, TTL_HOT, competition).then(function (r) {
      if (r.stale) throw new Error('football-sportsdb-stale');
      return r.list;
    });
  }
  // The matchday(s) around now: the last played round and the next one.
  function scoreboard(competition) {
    return checked(competition) || load(competition, true);
  }
  function teams(competition) {
    return (
      checked(competition) ||
      load(competition, true).then(function (list) {
        var seen = {},
          out = [];
        list.forEach(function (m) {
          [m.home, m.away].forEach(function (s) {
            if (!seen[s.id]) {
              seen[s.id] = true;
              out.push(withLogo({ id: s.id, name: s.name }, s.logo));
            }
          });
        });
        return out.sort(function (a, b) {
          return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
        });
      })
    );
  }
  // Played and upcoming matches of one team, read from the rounds around now (no per-team endpoint is used).
  function teamMatches(competition, teamId) {
    var bad =
      checked(competition) ||
      (str(teamId) ? null : root.Promise.reject(new Error('football-team')));
    if (bad) return bad;
    return load(competition, false).then(function (list) {
      return list.filter(function (m) {
        return m.home.id === teamId || m.away.id === teamId;
      });
    });
  }

  root.FootballSportsDb = {
    competitions: COMPETITIONS,
    handles: handles,
    keyTag: 'sdb.',
    scoreboard: scoreboard,
    liveRound: liveRound,
    teams: teams,
    teamMatches: teamMatches
  };
})(window);
