/* Home info: widget cards on the main page (mr.redify only).
 *
 * A vertical stack of small glass cards on the right, under the header buttons: Calendar, Rates, Football, in that
 * order. A card shows only when its "Show on main page" toggle (Settings) is ON and it has data; a card without data
 * is left out (no error text on the main page). The cards read stored data (HomeCalendar.landingCard,
 * HomeInfoFinance.landingCard, HomeFootball.landingItems) and are not focusable: remote focus, Back and OK on the
 * main page are unchanged.
 *
 * Layout: the stack starts under #topButtons and ends above the focused-app name (#hero) or the dock; the cards that do
 * not fit are dropped from the end (text is never clipped). CSS hides the stack while the grid is scrolled or edited,
 * the idle screen or the info panel is open; render() also leaves it hidden under Settings and the app picker.
 *
 * Nothing runs with the scope off or with every toggle OFF: no timer, no request. While on: one timer per minute
 * (date change, layout), and the data refreshes the pages use (rates, football) at most once an hour while Home is in
 * front. Store changes made in Settings re-render at once (HomeInfo.onChange).
 */
(function (root) {
  'use strict';
  var doc = root.document,
    info = root.HomeInfo;
  if (!doc || !info || !info.onChange || !info.isMrRedify) return;
  var HOUR = 3600000,
    MINUTE = 60000,
    TOP_GAP = 20, // under the header buttons
    BOTTOM_GAP = 20, // above the app name / dock
    SCREEN_GAP = 40, // above the bottom edge when nothing else limits
    ICONS = {
      calendar:
        'M17,12h-5v5h5V12zM16,1v2H8V1H6v2H5C3.89,3 3.01,3.9 3.01,5L3,19c0,1.1 0.89,2 2,2h14c1.1,0 2,-0.9 2,-2V5c0,-1.1 -0.9,-2 -2,-2h-1V1H16zM19,19H5V8h14V19z',
      rates:
        'M11.8,10.9c-2.27,-0.59 -3,-1.2 -3,-2.15 0,-1.09 1.01,-1.85 2.7,-1.85 1.78,0 2.44,0.85 2.5,2.1h2.21c-0.07,-1.72 -1.12,-3.3 -3.21,-3.81V3h-3v2.16c-1.94,0.42 -3.5,1.68 -3.5,3.61 0,2.31 1.91,3.46 4.7,4.13 2.5,0.6 3,1.48 3,2.41 0,0.69 -0.49,1.79 -2.7,1.79 -2.06,0 -2.87,-0.92 -2.98,-2.1h-2.2c0.12,2.19 1.76,3.42 3.68,3.83V21h3v-2.15c1.95,-0.37 3.5,-1.5 3.5,-3.55 0,-2.84 -2.43,-3.81 -4.7,-4.4z',
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
      rates: flag(info.finance),
      football: flag(info.football)
    };
  }
  function active() {
    var w = wanted();
    return info.isMrRedify() && (w.calendar || w.rates || w.football);
  }

  // ---- cards ----
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
  function team(side) {
    var box = el('span', 'lw-team'),
      logo =
        side.logo && root.HomeFootball && root.HomeFootball.logoNode
          ? root.HomeFootball.logoNode(side.logo, 24)
          : null;
    if (logo) box.appendChild(logo);
    box.appendChild(el('span', 'lw-name', side.name));
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
  function build() {
    var w = wanted(),
      out = [],
      data;
    if (w.calendar && root.HomeCalendar && root.HomeCalendar.landingCard) {
      data = safe(root.HomeCalendar.landingCard, null);
      if (data) out.push(textCard('calendar', data));
    }
    if (w.rates && root.HomeInfoFinance && root.HomeInfoFinance.landingCard) {
      data = safe(root.HomeInfoFinance.landingCard, null);
      if (data) out.push(textCard('rates', data));
    }
    if (w.football && root.HomeFootball && root.HomeFootball.landingItems) {
      data = safe(root.HomeFootball.landingItems, []);
      if (data.length) out.push(footballCard(data));
    }
    return out;
  }

  // ---- layout ----
  // Space between the header buttons and the app name (or dock): offsets inside #homeSurface, so any screen scale
  // cancels out.
  function bounds() {
    var surface = doc.getElementById('homeSurface'),
      header = doc.querySelector('header'),
      buttons = doc.getElementById('topButtons'),
      hero = doc.getElementById('hero'),
      dock = doc.getElementById('dockBand'),
      top = 150,
      bottom = (surface ? surface.offsetHeight : 1080) - SCREEN_GAP,
      v;
    if (header && buttons)
      top = header.offsetTop + buttons.offsetTop + buttons.offsetHeight;
    // The app name keeps its row even while faded out; only a name with text and a position limits the stack.
    if (hero && hero.textContent) {
      v = parseFloat(hero.style.top);
      if (v === v) bottom = Math.min(bottom, v - BOTTOM_GAP);
    }
    if (dock) {
      v = parseFloat(dock.style.top);
      if (v === v) bottom = Math.min(bottom, v - BOTTOM_GAP);
    }
    return { top: top + TOP_GAP, bottom: bottom };
  }
  function layout() {
    var b = bounds(),
      kids,
      i;
    host.style.top = b.top + 'px';
    // Drop whole cards from the end until the stack ends above the limit.
    kids = host.children;
    while (kids.length > 1 && host.offsetHeight > b.bottom - b.top)
      host.removeChild(kids[kids.length - 1]);
    if (kids.length === 1 && host.offsetHeight > b.bottom - b.top)
      host.removeChild(kids[0]);
    i = kids.length;
    host.hidden = i === 0;
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
    build().forEach(function (c) {
      host.appendChild(c);
    });
    host.hidden = false;
    layout();
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
          ? Array.prototype.map.call(host.children, function (c) {
              return c.className.replace(/^lw-card lw-/, '');
            })
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
