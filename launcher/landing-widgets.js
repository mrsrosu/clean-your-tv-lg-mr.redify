/* Home info: main-page widgets (mr.redify only).
 *
 * The top area of Home is three columns on one row under the clock and date: the weather block (left, unchanged),
 * a month calendar grid of the current month (middle, no markings: today only) and a stack of small glass cards
 * (right, right edge 1808): Name day, Exchange rates, Football. Each shows only when its "Show on main page" toggle
 * (Settings) is ON and it has data; the grid belongs to the Calendar tab toggle, Name day to the second toggle of the
 * Rates & holidays tab, Exchange to its first one, Football to the Football tab. Nothing without data is shown (no error
 * text). Data is read from storage (HomeCalendar.landingMonth / landingNameDay, HomeInfoFinance.landingCard,
 * HomeFootball.landingItems). Nothing is focusable: remote focus, Back and OK on the main page are unchanged.
 *
 * Layout: the columns start at the weather block's top (the clock row's bottom + 26) and, where a column is under the
 * header buttons, just below them; they end above the focused-app name (#hero) / the dock. Whole parts that do not fit
 * are dropped (cards from the end, then the cards column, then the grid when it would touch the weather block); text
 * is never clipped. CSS hides everything while the grid is scrolled or edited, the idle screen or the info panel is
 * open; render() also leaves it hidden under Settings and the app picker.
 *
 * Nothing runs with the scope off or with every toggle OFF: no timer, no request. While on: one timer per minute
 * (date change, layout) and the data refreshes the pages use (rates, football) at most once an hour while Home is in
 * front. Store changes made in Settings re-render at once (HomeInfo.onChange).
 */
(function (root) {
  'use strict';
  var doc = root.document,
    info = root.HomeInfo;
  if (!doc || !info || !info.onChange || !info.isMrRedify) return;
  var HOUR = 3600000,
    MINUTE = 60000,
    RIGHT = 1808, // right edge of the header buttons and of the cards
    CARDS_W = 316,
    GRID_W = 330,
    COL_GAP = 24, // between columns (and between a column and the weather block)
    BUTTONS_GAP = 20, // under the header buttons
    BOTTOM_GAP = 20, // above the app name / dock
    SCREEN_GAP = 40, // above the bottom edge when nothing else limits
    ICONS = {
      calendar:
        'M17,12h-5v5h5V12zM16,1v2H8V1H6v2H5C3.89,3 3.01,3.9 3.01,5L3,19c0,1.1 0.89,2 2,2h14c1.1,0 2,-0.9 2,-2V5c0,-1.1 -0.9,-2 -2,-2h-1V1H16zM19,19H5V8h14V19z',
      rates:
        'M11.8,10.9c-2.27,-0.59 -3,-1.2 -3,-2.15 0,-1.09 1.01,-1.85 2.7,-1.85 1.78,0 2.44,0.85 2.5,2.1h2.21c-0.07,-1.72 -1.12,-3.3 -3.21,-3.81V3h-3v2.16c-1.94,0.42 -3.5,1.68 -3.5,3.61 0,2.31 1.91,3.46 4.7,4.13 2.5,0.6 3,1.48 3,2.41 0,0.69 -0.49,1.79 -2.7,1.79 -2.06,0 -2.87,-0.92 -2.98,-2.1h-2.2c0.12,2.19 1.76,3.42 3.68,3.83V21h3v-2.15c1.95,-0.37 3.5,-1.5 3.5,-3.55 0,-2.84 -2.43,-3.81 -4.7,-4.4z',
      nameday:
        'M17,12h-5v5h5V12zM16,1v2H8V1H6v2H5C3.89,3 3.01,3.9 3.01,5L3,19c0,1.1 0.89,2 2,2h14c1.1,0 2,-0.9 2,-2V5c0,-1.1 -0.9,-2 -2,-2h-1V1H16zM19,19H5V8h14V19z',
      football:
        'M12,2C6.48,2 2,6.48 2,12s4.48,10 10,10 10,-4.48 10,-10S17.52,2 12,2zm-1,17.93c-3.95,-0.49 -7,-3.85 -7,-7.93 0,-0.62 0.08,-1.21 0.21,-1.79L9,15v1c0,1.1 0.9,2 2,2v1.93zm6.9,-2.54c-0.26,-0.81 -1,-1.39 -1.9,-1.39h-1v-3c0,-0.55 -0.45,-1 -1,-1H8v-2h2c0.55,0 1,-0.45 1,-1V7h2c1.1,0 2,-0.9 2,-2v-0.41c2.93,1.19 5,4.06 5,7.41 0,2.08 -0.8,3.97 -2.1,5.39z'
    },
    KEYS = [
      'tvhome.calendar.v1',
      'tvhome.daily.v1',
      'tvhome.finance.v1',
      'tvhome.football.v1'
    ],
    host = null,
    timer = null,
    generation = 0,
    refreshedAt = { rates: 0, football: 0 },
    clock = function () {
      return new Date().getTime();
    };

  function t(text) {
    return root.HomeI18n ? root.HomeI18n.t(text) : text;
  }
  function el(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function safe(fn, fallback) {
    try {
      var v = fn();
      return v === undefined ? fallback : v;
    } catch (_) {
      return fallback;
    }
  }
  function flag(store) {
    return !!(store && safe(store.get, {}).landing === true);
  }
  function wanted() {
    return {
      calendar: flag(info.calendar),
      nameday: flag(info.daily),
      rates: flag(info.finance),
      football: flag(info.football)
    };
  }
  function active() {
    var w = wanted();
    return info.isMrRedify() && (w.calendar || w.nameday || w.rates || w.football);
  }

  // ---- parts ----
  function icon(id) {
    var ns = 'http://www.w3.org/2000/svg',
      svg = doc.createElementNS(ns, 'svg'),
      path = doc.createElementNS(ns, 'path');
    svg.setAttribute('class', 'lw-icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    path.setAttribute('d', ICONS[id]);
    svg.appendChild(path);
    return svg;
  }
  function card(id, title, meta) {
    var c = el('div', 'lw-card lw-' + id),
      head = el('div', 'lw-head');
    c.setAttribute('data-lw', id);
    head.appendChild(icon(id));
    head.appendChild(el('span', 'lw-label', title));
    if (meta) head.appendChild(el('span', 'lw-meta', meta));
    c.appendChild(head);
    return c;
  }
  function textCard(id, data) {
    var c = card(id, data.title, data.meta);
    (data.lines || []).forEach(function (line) {
      c.appendChild(el('div', 'lw-line', line));
    });
    return c;
  }
  // Month grid: title, weekday names, the days of the month (cells outside it stay empty), today filled.
  function monthGrid(data) {
    var g = el('div', 'lw-card lw-grid lw-calendar'),
      table = el('div', 'lw-table'),
      row = el('div', 'lw-row lw-weekdays');
    g.setAttribute('data-lw', 'calendar');
    g.appendChild(el('div', 'lw-month', data.title));
    data.weekdays.forEach(function (name) {
      row.appendChild(el('span', 'lw-cell lw-weekday', name));
    });
    table.appendChild(row);
    data.rows.forEach(function (cells) {
      row = el('div', 'lw-row');
      cells.forEach(function (day) {
        row.appendChild(
          el(
            'span',
            'lw-cell' + (day === data.today ? ' lw-today' : ''),
            day ? String(day) : ''
          )
        );
      });
      table.appendChild(row);
    });
    g.appendChild(table);
    return g;
  }
  function team(side) {
    var box = el('span', 'lw-team'),
      logo =
        side.logo && root.HomeFootball && root.HomeFootball.logoNode
          ? root.HomeFootball.logoNode(side.logo, 22)
          : null;
    if (logo) box.appendChild(logo);
    box.appendChild(
      el(
        'span',
        'lw-name',
        root.HomeFootball && root.HomeFootball.label
          ? root.HomeFootball.label(side.name)
          : side.name
      )
    );
    return box;
  }
  function footballCard(items) {
    var c = card('football', t('Football'));
    items.forEach(function (item) {
      var row = el('div', 'lw-match lw-' + item.kind),
        teams = el('div', 'lw-teams');
      teams.appendChild(team(item.match.home));
      teams.appendChild(el('span', 'lw-dash', '–'));
      teams.appendChild(team(item.match.away));
      row.appendChild(teams);
      row.appendChild(el('div', 'lw-sub', item.text));
      c.appendChild(row);
    });
    return c;
  }
  // { grid: node | null, cards: [node] } for the toggles that are ON and have data.
  function build() {
    var w = wanted(),
      out = { grid: null, cards: [] },
      data;
    if (w.calendar && root.HomeCalendar && root.HomeCalendar.landingMonth) {
      data = safe(root.HomeCalendar.landingMonth, null);
      if (data) out.grid = monthGrid(data);
    }
    if (w.nameday && root.HomeCalendar && root.HomeCalendar.landingNameDay) {
      data = safe(root.HomeCalendar.landingNameDay, null);
      if (data) out.cards.push(textCard('nameday', data));
    }
    if (w.rates && root.HomeInfoFinance && root.HomeInfoFinance.landingCard) {
      data = safe(root.HomeInfoFinance.landingCard, null);
      if (data) out.cards.push(textCard('rates', data));
    }
    if (w.football && root.HomeFootball && root.HomeFootball.landingItems) {
      data = safe(root.HomeFootball.landingItems, []);
      if (data.length) out.cards.push(footballCard(data.slice(0, 1)));
    }
    return out;
  }

  // ---- layout ----
  // Position of an element inside #homeSurface from the offset chain, so any screen scale cancels out.
  function at(node, surface) {
    var x = 0,
      y = 0;
    while (node && node !== surface) {
      x += node.offsetLeft;
      y += node.offsetTop;
      node = node.offsetParent;
    }
    return { left: x, top: y };
  }
  function scaleOf(node) {
    var m = /scale\(([\d.]+)\)/.exec(node.style.transform || '');
    return m ? parseFloat(m[1]) : 1;
  }
  // The room: columns start at the weather block's top (clock row bottom + 26); the weather block's right edge limits
  // the grid; the header buttons and the app name / dock limit from above and below.
  function bounds() {
    var surface = doc.getElementById('homeSurface'),
      buttons = doc.getElementById('topButtons'),
      timeRow = doc.getElementById('timeRow'),
      weather = doc.getElementById('homeWeather'),
      hero = doc.getElementById('hero'),
      dock = doc.getElementById('dockBand'),
      top = 200,
      bottom = (surface ? surface.offsetHeight : 1080) - SCREEN_GAP,
      b = { buttons: null, weatherRight: 0 },
      p,
      v;
    if (timeRow) {
      p = at(timeRow, surface);
      top = p.top + timeRow.offsetHeight + 26;
    }
    if (weather && !weather.hidden && weather.style.top) {
      v = parseFloat(weather.style.top);
      if (v === v) top = v;
      p = at(weather, surface);
      b.weatherRight = p.left + weather.offsetWidth * scaleOf(weather);
    }
    if (buttons) {
      p = at(buttons, surface);
      b.buttons = {
        left: p.left,
        bottom: p.top + buttons.offsetHeight + BUTTONS_GAP
      };
    }
    // The app name keeps its row even while faded out; only a name with text and a position limits the stack.
    if (hero && hero.textContent) {
      v = parseFloat(hero.style.top);
      if (v === v) bottom = Math.min(bottom, v - BOTTOM_GAP);
    }
    if (dock) {
      v = parseFloat(dock.style.top);
      if (v === v) bottom = Math.min(bottom, v - BOTTOM_GAP);
    }
    b.top = top;
    b.bottom = bottom;
    return b;
  }
  function place(node, left, width, b) {
    // Under the header buttons where the column would touch them.
    var top = b.top;
    if (b.buttons && left + width > b.buttons.left && top < b.buttons.bottom)
      top = b.buttons.bottom;
    node.style.left = left + 'px';
    node.style.top = top + 'px';
    node.style.width = width + 'px';
    return top;
  }
  function layout(parts) {
    var b = bounds(),
      grid = parts.grid,
      stack = parts.stack,
      room,
      top;
    function fits(node, t) {
      return node.offsetHeight <= b.bottom - t;
    }
    if (stack) {
      top = place(stack, RIGHT - CARDS_W, CARDS_W, b);
      // Cards from the end until the stack ends above the limit; nothing left: no stack.
      while (stack.children.length && !fits(stack, top))
        stack.removeChild(stack.lastChild);
      if (!stack.children.length) {
        host.removeChild(stack);
        stack = null;
      }
    }
    if (grid) {
      var right = stack ? RIGHT - CARDS_W - COL_GAP : RIGHT,
        left = right - GRID_W;
      // Never over the weather block: first give up the cards column (the grid moves right), then the grid.
      if (b.weatherRight && left < b.weatherRight + COL_GAP && stack) {
        host.removeChild(stack);
        stack = null;
        left = RIGHT - GRID_W;
      }
      top = place(grid, left, GRID_W, b);
      if (
        (b.weatherRight && left < b.weatherRight + COL_GAP) ||
        !fits(grid, top)
      )
        host.removeChild(grid);
    }
    host.hidden = host.children.length === 0;
  }

  function suppressed() {
    var body = doc.body,
      picker = doc.getElementById('appPicker');
    return !!(
      (root.InfoPanel && root.InfoPanel.isOpen()) ||
      (root.RenewalPanel && root.RenewalPanel.isOpen()) ||
      (picker && !picker.hidden) ||
      body.classList.contains('idle-active') ||
      body.classList.contains('scrolled') ||
      body.classList.contains('editing') ||
      body.classList.contains('weather-scrolled')
    );
  }
  function render() {
    if (!host) return;
    host.innerHTML = '';
    host.hidden = true;
    if (!active()) return;
    var parts = build(),
      stack = null;
    if (parts.cards.length) {
      stack = el('div', 'lw-stack');
      parts.cards.forEach(function (c) {
        stack.appendChild(c);
      });
    }
    if (parts.grid) host.appendChild(parts.grid);
    if (stack) host.appendChild(stack);
    host.hidden = false;
    layout({ grid: parts.grid, stack: stack });
  }

  // ---- data and timers ----
  function refreshDue() {
    var w = wanted(),
      now = clock(),
      mine = generation;
    if (doc.hidden) return;
    function run(key, on, mod) {
      if (!on || !mod || !mod.refresh || now - refreshedAt[key] < HOUR) return;
      refreshedAt[key] = now;
      var p = safe(mod.refresh, null);
      if (p && p.then)
        p.then(
          function () {
            if (mine === generation && active()) render();
          },
          function () {}
        );
    }
    run('rates', w.rates, root.HomeInfoFinance);
    run('football', w.football, root.HomeFootball);
  }
  function tick() {
    timer = null;
    if (!active()) return;
    render();
    refreshDue();
    arm();
  }
  function arm() {
    if (timer !== null) return;
    var now = clock();
    timer = root.setTimeout(tick, MINUTE - (now % MINUTE) + 50);
  }
  function stop() {
    generation++;
    if (timer !== null) root.clearTimeout(timer);
    timer = null;
  }
  // The single entry: scope change, Settings change, visibility, resize and startup all land here.
  function reconcile() {
    if (!active()) {
      stop();
      render();
      return;
    }
    render();
    arm();
    refreshDue();
  }

  function init() {
    host = doc.getElementById('landingWidgets');
    if (!host) return;
    host.hidden = true;
    KEYS.forEach(function (key) {
      info.onChange(key, reconcile);
    });
    info.onScopeChange(reconcile);
    doc.addEventListener('visibilitychange', function () {
      if (!doc.hidden) reconcile();
    });
    root.addEventListener('resize', function () {
      if (active()) render();
    });
    reconcile();
  }

  root.HomeLanding = {
    reconcile: reconcile,
    render: render,
    suppressed: suppressed,
    // Test seam: the device clock (ms) used for the hourly refresh and the minute timer.
    setClock: function (fn) {
      clock = fn;
    },
    state: function () {
      return {
        active: active(),
        timer: timer !== null,
        cards: host
          ? Array.prototype.map.call(
              host.querySelectorAll('[data-lw]'),
              function (c) {
                return c.getAttribute('data-lw');
              }
            )
          : []
      };
    },
    // On screen right now: scope on, at least one card, nothing covering or hiding the stack.
    visible: function () {
      return !!(
        host &&
        !host.hidden &&
        host.children.length &&
        !suppressed() &&
        root.getComputedStyle(host).visibility !== 'hidden'
      );
    }
  };
  if (doc.readyState === 'loading')
    doc.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
