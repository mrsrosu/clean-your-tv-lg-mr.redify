/* Home info: ESPN football provider. The only file that knows ESPN URLs (public site API, CORS open, no key).
 *
 * scoreboard(competition)             today's / current matchday matches
 * teams(competition)                  teams of the competition (for the Settings picker)
 * teamMatches(competition, teamId)    played matches (schedule) plus upcoming ones (schedule?fixture=true)
 * Every answer is normalised to Match { id, competition, home:{id,name,score,logo?}, away:{id,name,score,logo?}, start (ISO),
 * state 'pre'|'in'|'post', clock }. A payload of another shape yields [] (no exception); network errors reject.
 * The competition 'nat' (National teams) is a group whose only team is Romania (473); its matches come from several
 * ESPN leagues (see nationalMatches). No standings anywhere.
 */
(function (root) {
  'use strict';
  var BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/',
    COMPETITIONS = [
      { id: 'eng.1', name: 'Premier League' },
      { id: 'esp.1', name: 'La Liga' },
      { id: 'ita.1', name: 'Serie A' },
      { id: 'ger.1', name: 'Bundesliga' },
      { id: 'fra.1', name: 'Ligue 1' },
      { id: 'rou.1', name: 'Liga 1 România' },
      { id: 'uefa.champions', name: 'Champions League' },
      { id: 'uefa.europa', name: 'Europa League' },
      // A group, not a league: its only team is Romania (ESPN id 473), whose matches are read from the leagues below.
      { id: 'nat', name: 'National teams' }
    ],
    NATIONAL = 'nat',
    NATIONAL_TEAMS = [{ id: '473', name: 'Romania' }],
    // ESPN leagues that carry Romania's matches (friendlies, World Cup and Nations League qualifying, Euro). A league
    // slug for the Euro 2028 qualifiers is not known to exist and is not guessed.
    NATIONAL_LEAGUES = [
      'fifa.friendly',
      'fifa.worldq.uefa',
      'uefa.nations',
      'uefa.euro'
    ];

  function known(id) {
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
  // Scoreboard gives a string ("2"), team schedules give {value, displayValue}.
  function score(v) {
    var n = obj(v)
      ? typeof v.value === 'number'
        ? v.value
        : v.displayValue
      : v;
    n = typeof n === 'string' && n !== '' ? Number(n) : n;
    return typeof n === 'number' && isFinite(n) && n >= 0 ? n : null;
  }
  // team.logo (scoreboard) or team.logos[0].href (team lists, schedules); '' when absent or not an allowed host.
  function logoOf(team) {
    var check = root.HomeInfoFetch && root.HomeInfoFetch.logoUrl;
    if (!check) return '';
    var url = check(team.logo);
    if (!url && Array.isArray(team.logos) && obj(team.logos[0]))
      url = check(team.logos[0].href);
    return url;
  }
  function side(list, which) {
    for (var i = 0; i < list.length; i++) {
      var c = obj(list[i]),
        team = c && obj(c.team);
      if (c && c.homeAway === which && team) {
        var id = str(team.id),
          name =
            str(team.displayName) ||
            str(team.shortDisplayName) ||
            str(team.name);
        if (id && name)
          return { id: id, name: name, score: c.score, logo: logoOf(team) };
      }
    }
    return null;
  }
  // The logo key exists only when there is one (an answer without logos keeps its old shape).
  function withLogo(target, logo) {
    if (logo) target.logo = logo;
    return target;
  }
  function parseEvent(e, competition) {
    e = obj(e);
    var comp =
      e && Array.isArray(e.competitions) ? obj(e.competitions[0]) : null;
    if (!comp) return null;
    var status = obj(comp.status) || obj(e.status),
      type = status && obj(status.type),
      state = type && type.state,
      id = str(e.id),
      start = typeof e.date === 'string' ? e.date : '',
      home,
      away;
    if (!id || isNaN(Date.parse(start))) return null;
    if (state !== 'pre' && state !== 'in' && state !== 'post') return null;
    if (state === 'post' && type.completed === false) return null; // postponed / cancelled
    if (!Array.isArray(comp.competitors)) return null;
    home = side(comp.competitors, 'home');
    away = side(comp.competitors, 'away');
    if (!home || !away) return null;
    return {
      id: id,
      competition: competition,
      home: withLogo(
        {
          id: home.id,
          name: home.name,
          score: state === 'pre' ? null : score(home.score)
        },
        home.logo
      ),
      away: withLogo(
        {
          id: away.id,
          name: away.name,
          score: state === 'pre' ? null : score(away.score)
        },
        away.logo
      ),
      start: start,
      state: state,
      clock:
        state === 'in' && status && typeof status.displayClock === 'string'
          ? status.displayClock
          : ''
    };
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
  function parseTeams(payload) {
    var sports =
        obj(payload) && Array.isArray(payload.sports)
          ? obj(payload.sports[0])
          : null,
      leagues =
        sports && Array.isArray(sports.leagues) ? obj(sports.leagues[0]) : null,
      list = leagues && Array.isArray(leagues.teams) ? leagues.teams : [],
      out = [],
      seen = {};
    for (var i = 0; i < list.length; i++) {
      var team = obj(list[i]) && obj(list[i].team),
        id = team ? str(team.id) : '',
        name = team ? str(team.displayName) || str(team.name) : '';
      if (id && name && !seen[id]) {
        seen[id] = true;
        out.push(withLogo({ id: id, name: name }, logoOf(team)));
      }
    }
    return out.sort(function (a, b) {
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
  }

  function get(path) {
    return root.HomeInfoFetch.http(BASE + path).then(function (text) {
      try {
        return JSON.parse(text);
      } catch (_) {
        return null;
      }
    });
  }
  function checked(competition) {
    return known(competition)
      ? null
      : root.Promise.reject(new Error('football-unknown-competition'));
  }
  function scoreboard(competition) {
    // The national-teams group has no matchday board (nothing is requested).
    if (competition === NATIONAL) return root.Promise.resolve([]);
    return (
      checked(competition) ||
      get(competition + '/scoreboard').then(function (p) {
        return parseMatches(p, competition);
      })
    );
  }
  function teams(competition) {
    if (competition === NATIONAL)
      return root.Promise.resolve(
        NATIONAL_TEAMS.map(function (x) {
          return { id: x.id, name: x.name };
        })
      );
    return checked(competition) || get(competition + '/teams').then(parseTeams);
  }
  // A national team: the played matches (schedule) of each league in NATIONAL_LEAGUES (one request each), plus the
  // upcoming ones (?fixture=true) from the single league whose newest match is the most recent, i.e. the current
  // season. 5 requests at most per call; a failing league is skipped (all failing rejects); dedupe by event id.
  function nationalMatches(teamId) {
    var tid = encodeURIComponent(teamId);
    return root.Promise.all(
      NATIONAL_LEAGUES.map(function (slug) {
        return get(slug + '/teams/' + tid + '/schedule').then(
          function (p) {
            return { slug: slug, list: parseMatches(p, NATIONAL) };
          },
          function (e) {
            return { slug: slug, error: e };
          }
        );
      })
    ).then(function (parts) {
      var ok = parts.filter(function (x) {
          return !x.error;
        }),
        newest = '',
        current = '',
        seen = {},
        out = [];
      if (!ok.length) throw parts[0].error;
      ok.forEach(function (x) {
        x.list.forEach(function (m) {
          if (m.start > newest) {
            newest = m.start;
            current = x.slug;
          }
        });
      });
      return (current
        ? get(current + '/teams/' + tid + '/schedule?fixture=true').then(
            function (p) {
              return parseMatches(p, NATIONAL);
            },
            function () {
              return [];
            }
          )
        : root.Promise.resolve([])
      ).then(function (upcoming) {
        ok.forEach(function (x) {
          x.list.forEach(add);
        });
        upcoming.forEach(add);
        function add(m) {
          if (!seen[m.id]) {
            seen[m.id] = true;
            out.push(m);
          }
        }
        return out.sort(function (a, b) {
          return a.start < b.start ? -1 : a.start > b.start ? 1 : 0;
        });
      });
    });
  }
  // Two lists: the schedule holds the played matches, ?fixture=true the upcoming ones. One failing still answers.
  function teamMatches(competition, teamId) {
    var bad =
      checked(competition) ||
      (str(teamId) ? null : root.Promise.reject(new Error('football-team')));
    if (bad) return bad;
    if (competition === NATIONAL) return nationalMatches(teamId);
    var base =
      competition + '/teams/' + encodeURIComponent(teamId) + '/schedule';
    function load(path) {
      return get(path).then(
        function (p) {
          return { list: parseMatches(p, competition) };
        },
        function (e) {
          return { error: e };
        }
      );
    }
    return root.Promise.all([load(base), load(base + '?fixture=true')]).then(
      function (r) {
        if (r[0].error && r[1].error) throw r[0].error;
        var seen = {},
          out = [];
        (r[0].list || []).concat(r[1].list || []).forEach(function (m) {
          if (!seen[m.id]) {
            seen[m.id] = true;
            out.push(m);
          }
        });
        return out.sort(function (a, b) {
          return a.start < b.start ? -1 : a.start > b.start ? 1 : 0;
        });
      }
    );
  }

  root.FootballEspn = {
    competitions: COMPETITIONS,
    scoreboard: scoreboard,
    teams: teams,
    teamMatches: teamMatches
  };
})(window);
