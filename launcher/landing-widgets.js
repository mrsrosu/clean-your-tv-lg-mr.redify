/* Home info: main-page widgets (mr.redify only).
 *
 * The top area of Home is three columns on one row under the clock and date: the weather block (left, unchanged),
 * a month calendar grid of the current month (middle, no markings: today only) and a stack of small glass cards
 * (right, right edge 1808): Exchange rates, Events, Football; the Name day is in the top row, right of the date block. Each shows only when its "Show on main page" toggle
 * (Settings) is ON and it has data; the grid belongs to the Calendar tab toggle, Name day to the second toggle of the
 * Rates & holidays tab, Exchange to its first one, Football to the Football tab; the Events card has its own Calendar tab
 * toggle (landingEvents), independent of the grid's. Nothing without data is shown (no error
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
 * (date change, layout), the rates schedule check (a request only at the BNR slots) and the football refresh at most once an hour while Home is in
 * front. Store changes made in Settings re-render at once (HomeInfo.onChange).
 */
(function (root) {
  'use strict';
  var doc = root.document,
    info = root.HomeInfo;
  if (!doc || !info || !info.onChange || !info.isMrRedify) return;
  var HOUR = 3600000,
    MINUTE = 60000,
    RIGHT = 1808, // right edge of the header buttons and of the third column
    LEFT = 112, // left edge of the weather block (the first column)
    GAP = 24, // between the three equal columns (the exact gap is spread so the right edge is RIGHT)
    BUTTONS_GAP = 20, // under the header buttons
    DOCK_GAP = 24, // above the dock
    SCREEN_GAP = 40, // above the bottom edge when nothing else limits
    SIZES = [34, 32, 30, 28, 26, 24, 22], // body text sizes tried from the weather's own 34 px downwards
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
  function flag(store, key) {
    return !!(store && safe(store.get, {})[key || 'landing'] === true);
  }
  function wanted() {
    return {
      calendar: flag(info.calendar),
      events: flag(info.calendar, 'landingEvents'),
      nameday: flag(info.daily),
      rates: flag(info.finance),
      football: flag(info.football)
    };
  }
  function active() {
    var w = wanted();
    return info.isMrRedify() && (w.calendar || w.events || w.nameday || w.rates || w.football);
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
  function card(id, title, meta, iconId) {
    var c = el('div', 'lw-card lw-' + id),
      head = el('div', 'lw-head');
    c.setAttribute('data-lw', id);
    head.appendChild(icon(iconId || id));
    head.appendChild(el('span', 'lw-label', title));
    if (meta) head.appendChild(el('span', 'lw-meta', meta));
    c.appendChild(head);
    return c;
  }
  // level 1 = compact: one line per card (the titles stay), used when level 0 does not fit.
  function textCard(id, data, level, iconId) {
    var c = card(id, data.title, data.meta, iconId);
    (level ? (data.lines || []).slice(0, 1) : data.lines || []).forEach(function (line) {
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
            'lw-cell' +
              (day === data.today ? ' lw-today' : '') +
              (day && data.marked && data.marked.indexOf(day) >= 0 ? ' lw-mark' : ''),
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
          ? root.HomeFootball.logoNode(side.logo, 30)
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
  // Name day of the top row (left of the header buttons, on the clock's line): plain text, a small label and its lines.
  function topNameDay(data) {
    var n = el('div', 'lw-top');
    n.setAttribute('data-lw', 'nameday');
    n.appendChild(el('div', 'lw-toplabel', data.title));
    (data.lines || []).forEach(function (line) {
      n.appendChild(el('div', 'lw-topline', line));
    });
    return n;
  }
  // { top: node | null, grid: node | null, cards: [node] }: the top-row Name day, the month grid (dots only) and the
  // stack Exchange, Events, Football. Name day, Exchange and Football only with data; Events is never empty.
  function build(level) {
    var w = wanted(),
      out = { top: null, grid: null, cards: [] },
      cal = root.HomeCalendar,
      data;
    if (w.calendar && cal && cal.landingMonth) {
      data = safe(cal.landingMonth, null);
      if (data) out.grid = monthGrid(data);
    }
    if (w.nameday && cal && cal.landingNameDay) {
      data = safe(cal.landingNameDay, null);
      if (data) out.top = topNameDay(data);
    }
    if (w.rates && root.HomeInfoFinance && root.HomeInfoFinance.landingCard) {
      data = safe(root.HomeInfoFinance.landingCard, null);
      if (data) out.cards.push(textCard('rates', data, level));
    }
    if (w.events && cal && cal.landingEventsCard) {
      data = safe(cal.landingEventsCard, null);
      if (data) out.cards.push(textCard('events', data, level, 'calendar'));
    }
    if (w.football && root.HomeFootball && root.HomeFootball.landingItems) {
      data = safe(root.HomeFootball.landingItems, []);
      if (data.length) out.cards.push(footballCard(data.slice(0, 2), level));
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
  // The room: the three columns start at the weather block's top, end above the dock; the header buttons limit the
  // third column from above; the weather block's right edge limits the grid column. The app name is hidden with
  // mr.redify, so it limits nothing.
  function bounds() {
    var surface = doc.getElementById('homeSurface'),
      buttons = doc.getElementById('topButtons'),
      timeRow = doc.getElementById('timeRow'),
      weather = doc.getElementById('homeWeather'),
      dock = doc.getElementById('dockBand'),
      top = 200,
      bottom = (surface ? surface.offsetHeight : 1080) - SCREEN_GAP,
      b = { buttons: null, weatherRight: 0, weather: null },
      p,
      v;
    if (timeRow) {
      p = at(timeRow, surface);
      top = p.top + timeRow.offsetHeight + 20;
    }
    if (weather && !weather.hidden && weather.style.top) {
      v = parseFloat(weather.style.top);
      if (v === v) top = v;
      p = at(weather, surface);
      b.weatherRight = p.left + weather.offsetWidth * scaleOf(weather);
      b.weather = weather;
    }
    if (buttons) {
      p = at(buttons, surface);
      b.buttons = {
        left: p.left,
        bottom: p.top + buttons.offsetHeight + BUTTONS_GAP
      };
    }
    if (dock) {
      v = parseFloat(dock.style.top);
      if (v === v) bottom = Math.min(bottom, v - DOCK_GAP);
    }
    b.top = top;
    b.bottom = bottom;
    return b;
  }
  // Column width and the left edges of the three equal columns.
  function columns() {
    var w = Math.floor((RIGHT - LEFT - 2 * GAP) / 3),
      gap = (RIGHT - LEFT - 3 * w) / 2;
    return { width: w, left: [LEFT, LEFT + w + gap, RIGHT - w] };
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
  // Removes the least important thing left in the cards stack.
  function dropOne(stack) {
    var node = stack.querySelector('[data-lw="football"]'),
      items = node ? node.querySelectorAll('.lw-match') : [],
      order = ['events', 'rates'],
      i;
    // From the end: Football's second event, Football, then Events, then Exchange.
    if (items.length > 1) return node.removeChild(items[items.length - 1]);
    if (node) return stack.removeChild(node);
    for (i = 0; i < order.length; i++) {
      node = stack.querySelector('[data-lw="' + order[i] + '"]');
      if (node) return stack.removeChild(node);
    }
    return stack.removeChild(stack.lastChild);
  }
  function overflows(node) {
    return node.scrollHeight > node.clientHeight + 1;
  }
  // The largest text size at which the stack's equal sections (and the grid) hold their content without clipping; 0
  // when even the smallest does not fit.
  function fitStack(stack, height) {
    var cards = stack.children,
      each = Math.floor(height / cards.length),
      i,
      k,
      bad;
    if (!(each >= 60)) return 0; // not even a title and one line
    stack.style.height = each * cards.length + 'px';
    for (i = 0; i < cards.length; i++) cards[i].style.height = each + 'px';
    for (k = 0; k < SIZES.length; k++) {
      stack.style.fontSize = SIZES[k] + 'px';
      bad = false;
      for (i = 0; i < cards.length && !bad; i++) bad = overflows(cards[i]);
      if (!bad) return SIZES[k];
    }
    return 0;
  }
  function fitGrid(grid, height, max) {
    var k;
    if (!(height >= 120)) return 0;
    grid.style.height = height + 'px';
    for (k = 0; k < SIZES.length; k++) {
      if (SIZES[k] > max) continue;
      grid.style.fontSize = SIZES[k] + 'px';
      if (!overflows(grid)) return SIZES[k];
    }
    return 0;
  }
  // Top of the first text line of an element (not of its box).
  function firstTextTop(node) {
    var walker = doc.createTreeWalker(node, 4, null, false),
      t,
      r;
    while ((t = walker.nextNode())) {
      if (!/\S/.test(t.nodeValue)) continue;
      r = doc.createRange();
      r.selectNodeContents(t);
      r = r.getBoundingClientRect();
      if (r.height) return r.top;
    }
    return null;
  }
  // Moves a placed column so that its first text line starts at y (page coordinates, same scale as Home).
  function alignFirstText(node, y) {
    var now = firstTextTop(node);
    if (y === null || now === null) return;
    node.style.top = parseFloat(node.style.top) + (y - now) + 'px';
  }
  function weatherHeight(b, bottom) {
    var w = b.weather;
    if (!w) return;
    // The weather block is as tall as the other columns (its content stays at the top); weather.js re-applies this
    // after each of its own renders, without counting it in its reserved region.
    var h = Math.max(0, bottom - parseFloat(w.style.top)) / scaleOf(w);
    w.setAttribute('data-lw-height', String(Math.round(h)));
    w.style.minHeight = Math.round(h) + 'px';
  }
  function clearWeatherHeight() {
    var w = doc.getElementById('homeWeather');
    if (!w || !w.hasAttribute('data-lw-height')) return;
    w.removeAttribute('data-lw-height');
    w.style.minHeight = '';
  }
  // The Name day of the top row: right of the date block (+48 px) up to the first header button (-40 px), centred on
  // the clock row; sizes from the list until its lines fit the row's height. False when there is no room at all.
  var TOP_SIZES = [26, 24, 22, 20];
  function placeTop(node) {
    var surface = doc.getElementById('homeSurface'),
      timeRow = doc.getElementById('timeRow'),
      date = doc.getElementById('date'),
      buttons = doc.getElementById('topButtons'),
      p,
      left,
      right,
      k;
    if (!surface || !timeRow || !date) return false;
    p = at(date, surface);
    left = p.left + date.offsetWidth + 48;
    right = buttons ? at(buttons, surface).left - 40 : RIGHT - 416 - 40;
    if (right - left < 160) return false;
    node.style.left = left + 'px';
    node.style.width = right - left + 'px';
    p = at(timeRow, surface);
    for (k = 0; k < TOP_SIZES.length; k++) {
      node.style.fontSize = TOP_SIZES[k] + 'px';
      if (node.offsetHeight <= timeRow.offsetHeight) break;
    }
    node.style.top = p.top + Math.max(0, (timeRow.offsetHeight - node.offsetHeight) / 2) + 'px';
    return true;
  }
  function layout(parts) {
    var b = bounds(),
      c = columns(),
      grid = parts.grid,
      stack = parts.stack,
      dropped = false,
      top,
      size = 34,
      bottom = b.bottom;
    // The three columns start on one line: the weather block's first visible text is the reference.
    var lineY = b.weather ? firstTextTop(b.weather) : null;
    // The third column cannot start above the header buttons: then every column starts below them.
    if (lineY !== null && b.buttons) lineY = Math.max(lineY, b.buttons.bottom);
    if (stack) {
      top = place(stack, c.left[2], c.width, b);
      alignFirstText(stack, lineY);
      top = parseFloat(stack.style.top);
      // Equal sections that fill the column; until they fit: Exchange goes first, then Name day, then Football's second
      // event, then Football (Football has priority over the others, as far as the geometry allows).
      while (stack.children.length) {
        size = fitStack(stack, bottom - top);
        if (size) break;
        dropOne(stack);
        dropped = true;
      }
      if (!stack.children.length) {
        host.removeChild(stack);
        stack = null;
      }
    }
    if (grid) {
      var left = c.left[1];
      // Never over the weather block: first give up the cards column (the grid moves right), then the grid.
      if (b.weatherRight && left < b.weatherRight + GAP && stack) {
        host.removeChild(stack);
        stack = null;
        dropped = true;
        left = c.left[2];
      }
      top = place(grid, left, c.width, b);
      alignFirstText(grid, lineY);
      top = parseFloat(grid.style.top);
      if (
        (b.weatherRight && left < b.weatherRight + GAP) ||
        !fitGrid(grid, bottom - top, 34)
      ) {
        host.removeChild(grid);
        dropped = true;
      }
    }
    if (parts.top && !placeTop(parts.top)) {
      host.removeChild(parts.top);
      dropped = true;
    }
    host.hidden = host.children.length === 0;
    if (host.hidden) clearWeatherHeight();
    else weatherHeight(b, bottom);
    return dropped;
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
    if (!active()) {
      clearWeatherHeight();
      return;
    }
    // Full cards first; if something has to go, the compact cards (one line each); then whole cards are dropped.
    for (var level = 0; level <= 1; level++) {
      host.innerHTML = '';
      var parts = build(level),
        stack = null;
      if (parts.cards.length) {
        stack = el('div', 'lw-stack');
        parts.cards.forEach(function (c) {
          stack.appendChild(c);
        });
      }
      if (parts.top) host.appendChild(parts.top);
      if (parts.grid) host.appendChild(parts.grid);
      if (stack) host.appendChild(stack);
      host.hidden = false;
      if (!layout({ top: parts.top, grid: parts.grid, stack: stack })) break;
    }
  }

  // ---- data and timers ----
  function refreshDue() {
    var w = wanted(),
      now = clock(),
      mine = generation;
    if (doc.hidden) return;
    // method: rates use the schedule (refreshIfDue, which costs nothing unless a BNR slot is due, so it is asked on every
    // check); football keeps its own hourly pace.
    function run(key, on, mod, method, every) {
      if (!on || !mod || !mod[method]) return;
      // A clock that went back (wrong TV time corrected) never blocks the next refresh.
      if (every && now >= refreshedAt[key] && now - refreshedAt[key] < every) return;
      refreshedAt[key] = now;
      var p = safe(mod[method], null);
      if (p && p.then)
        p.then(
          function () {
            if (mine === generation && active()) render();
          },
          function () {}
        );
    }
    run('rates', w.rates, root.HomeInfoFinance, 'refreshIfDue', 0);
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
  // The football scheduler (football.js) keeps the card's data fresh while it is attached: only while the card is wanted.
  var attached = false;
  function footballFeed(on) {
    if (!root.HomeFootball || !root.HomeFootball.attach) return;
    if (on && !attached) {
      attached = true;
      root.HomeFootball.attach('card', function () {
        if (active()) render();
      });
    } else if (!on && attached) {
      attached = false;
      root.HomeFootball.detach('card');
    }
  }
  // The single entry: scope change, Settings change, visibility, resize and startup all land here.
  function reconcile() {
    footballFeed(active() && wanted().football);
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
    // Test seam: the device clock (ms) used for the football pace and the minute timer.
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
