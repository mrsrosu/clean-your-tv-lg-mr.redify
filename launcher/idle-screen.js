/* Home info: idle screen (mr.redify only) and its "Idle screen" Settings tab.
 *
 * Store HomeInfo.idle (tvhome.idle.v1): style 'clock' | 'panel', timeoutMin 0 (off) | 5 | 10 | 30, dim 0-100,
 * seconds, blocks {date, rates, football}. After the timeout without a key, pointer move/click or wheel the overlay
 * #idleScreen covers Home: the clock style shows a big clock, the date and the weather; the panel style a smaller
 * clock plus blocks (date with holiday / name day, rates, football). A block without data is left out.
 * ANY key or pointer input then closes it and is CONSUMED (nothing underneath is activated).
 * Never starts while Settings is open or Home is not in front (hidden document); an info panel still open at the timeout
 * is closed and idle starts a cycle later. Everything stops when the scope is off.
 * OLED: the content moves a few pixels every minute along a fixed cycle; brightness comes from the shade opacity.
 * Only the idle screen of Home: the LG system screensaver runs outside Home and is not controlled here.
 */
(function (root) {
  'use strict';
  var STYLES = ['clock', 'panel'],
    TIMEOUTS = [0, 5, 10, 30],
    DEFAULTS = {
      style: 'clock',
      timeoutMin: 10,
      dim: 60,
      seconds: false,
      blocks: { date: true, rates: false, football: false }
    },
    BLOCKS = ['date', 'rates', 'football'],
    // Pixel offsets, one per minute of the wall clock (9 positions, at most 3 px).
    SHIFTS = [
      [0, 0],
      [3, 0],
      [3, 3],
      [0, 3],
      [-3, 3],
      [-3, 0],
      [-3, -3],
      [0, -3],
      [3, -3]
    ],
    REFRESH_EVERY = 30 * 60000,
    SWALLOW_MS = 1000;

  // ---- settings sanitizing: returns only the given, valid fields ----
  function sanitize(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object') return out;
    if ('style' in raw)
      out.style = STYLES.indexOf(raw.style) >= 0 ? raw.style : DEFAULTS.style;
    if ('timeoutMin' in raw)
      out.timeoutMin =
        typeof raw.timeoutMin === 'number' &&
        TIMEOUTS.indexOf(raw.timeoutMin) >= 0
          ? raw.timeoutMin
          : DEFAULTS.timeoutMin;
    if ('dim' in raw) {
      var d = raw.dim;
      out.dim =
        typeof d === 'number' && isFinite(d)
          ? Math.max(0, Math.min(100, Math.round(d)))
          : DEFAULTS.dim;
    }
    if ('seconds' in raw)
      out.seconds =
        typeof raw.seconds === 'boolean' ? raw.seconds : DEFAULTS.seconds;
    if ('blocks' in raw) {
      var b = raw.blocks && typeof raw.blocks === 'object' ? raw.blocks : {};
      out.blocks = {};
      BLOCKS.forEach(function (k) {
        out.blocks[k] = typeof b[k] === 'boolean' ? b[k] : DEFAULTS.blocks[k];
      });
    }
    return out;
  }

  // ---- controller: pure timing, everything injected ----
  // opts: timeoutMs, onIdle, onWake, now, schedule(fn, ms) -> id, cancel(id), blocked() (optional, true = not now).
  // activity() only records the time (it is called on every mouse move); the single timer re-arms itself.
  function createIdleController(opts) {
    var timer = null,
      running = false,
      idle = false,
      last = 0;
    function arm(ms) {
      timer = opts.schedule(fire, ms);
    }
    function fire() {
      timer = null;
      if (!running) return;
      var elapsed = opts.now() - last;
      if (elapsed < opts.timeoutMs) return arm(opts.timeoutMs - elapsed);
      if (opts.blocked && opts.blocked()) {
        last = opts.now();
        return arm(opts.timeoutMs);
      }
      idle = true;
      opts.onIdle();
    }
    return {
      start: function () {
        if (running || !(opts.timeoutMs > 0)) return;
        running = true;
        idle = false;
        last = opts.now();
        arm(opts.timeoutMs);
      },
      stop: function () {
        running = false;
        if (timer !== null) opts.cancel(timer);
        timer = null;
        if (idle) {
          idle = false;
          opts.onWake();
        }
      },
      activity: function () {
        if (!running) return;
        last = opts.now();
        if (idle) {
          idle = false;
          opts.onWake();
          arm(opts.timeoutMs);
        }
      },
      isIdle: function () {
        return idle;
      }
    };
  }

  var api = {
    createIdleController: createIdleController,
    sanitize: sanitize,
    DEFAULTS: DEFAULTS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  var doc = root.document,
    info = root.HomeInfo;
  if (!doc || !doc.getElementById || !info || !info.createStore) return;

  var store = info.createStore('tvhome.idle.v1', DEFAULTS, sanitize),
    controller = null,
    overlay = null,
    contentEl = null,
    shadeEl = null,
    tickTimer = null,
    lastRefresh = 0,
    generation = 0,
    swallow = null; // { types: [...], until }

  function t(text) {
    return root.HomeI18n ? root.HomeI18n.t(text) : text;
  }
  function now() {
    return new Date().getTime();
  }
  function el(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  // True = do not start now. Hidden document: another app is in the foreground. Settings open: wait. Info panel open
  // at the timeout: close it (a static page would otherwise stay on an OLED screen forever); idle starts next cycle.
  function blocked() {
    if (doc.hidden) return true;
    if (root.RenewalPanel && root.RenewalPanel.isOpen()) return true;
    if (root.InfoPanel && root.InfoPanel.isOpen()) {
      root.InfoPanel.close();
      return true;
    }
    return false;
  }

  // ---- overlay content ----
  function clockText(at, seconds) {
    if (root.HomeI18n && root.HomeI18n.formatTime)
      return root.HomeI18n.formatTime(at, seconds);
    var d = new Date(at);
    function pad(n) {
      return (n < 10 ? '0' : '') + n;
    }
    return (
      pad(d.getHours()) +
      ':' +
      pad(d.getMinutes()) +
      (seconds ? ':' + pad(d.getSeconds()) : '')
    );
  }
  function dateText(at) {
    return root.HomeI18n && root.HomeI18n.formatDate
      ? root.HomeI18n.formatDate(at)
      : new Date(at).toDateString();
  }
  function weatherText() {
    var s;
    try {
      s =
        root.HomeWeather &&
        root.HomeWeather.snapshot &&
        root.HomeWeather.snapshot();
    } catch (_) {
      s = null;
    }
    if (!s || typeof s.temp !== 'number' || !isFinite(s.temp)) return '';
    return Math.round(s.temp) + (s.unit || '') + (s.label ? ' ' + s.label : '');
  }
  function lines(fn) {
    try {
      var list = fn();
      return Array.isArray(list) ? list.filter(Boolean) : [];
    } catch (_) {
      return [];
    }
  }
  function block(cls, title, rows) {
    var b = el('div', 'idle-block ' + cls);
    if (title) b.appendChild(el('div', 'idle-block-title', title));
    rows.forEach(function (r) {
      b.appendChild(el('div', r.cls || 'idle-line', r.text));
    });
    return b;
  }
  function render() {
    if (!overlay) return;
    var s = store.get(),
      at = now(),
      d = new Date(at),
      marks = (info.daily && info.daily.get && info.daily.get()) || {},
      blocks = [];
    contentEl.innerHTML = '';
    contentEl.className = 'idle-content idle-mode-' + s.style;
    contentEl.appendChild(
      el(
        'div',
        s.style === 'panel' ? 'idle-clock idle-small' : 'idle-clock',
        clockText(at, s.seconds)
      )
    );
    if (s.style === 'clock') {
      contentEl.appendChild(el('div', 'idle-date', dateText(at)));
      var w = weatherText();
      if (w) contentEl.appendChild(el('div', 'idle-weather', w));
      return;
    }
    var rows,
      cal = root.HomeRoCalendar;
    if (s.blocks.date) {
      rows = [{ cls: 'idle-date', text: dateText(at) }];
      if (cal && marks.showHolidays !== false)
        lines(function () {
          return cal.holidayNames(
            d.getFullYear(),
            d.getMonth() + 1,
            d.getDate()
          );
        }).forEach(function (n) {
          rows.push({ cls: 'idle-holiday', text: n });
        });
      if (cal && marks.showNameDays !== false) {
        var names = lines(function () {
          return cal.nameDays(d.getFullYear(), d.getMonth() + 1, d.getDate());
        });
        if (names.length)
          rows.push({
            cls: 'idle-nameday',
            text: t('Name day') + ': ' + names.join(', ')
          });
      }
      blocks.push(block('idle-block-date', '', rows));
    }
    if (s.blocks.rates && root.HomeInfoFinance) {
      rows = lines(root.HomeInfoFinance.idleLines).map(function (x) {
        return { text: x };
      });
      if (rows.length)
        blocks.push(block('idle-block-rates', t('Exchange rates'), rows));
    }
    if (s.blocks.football && root.HomeFootball) {
      rows = lines(root.HomeFootball.idleLines).map(function (x) {
        return { text: x };
      });
      if (rows.length)
        blocks.push(block('idle-block-football', t('Football'), rows));
    }
    var wrap = el('div', 'idle-blocks');
    blocks.forEach(function (b) {
      wrap.appendChild(b);
    });
    contentEl.appendChild(wrap);
  }
  function shift() {
    var p = SHIFTS[Math.floor(now() / 60000) % SHIFTS.length];
    contentEl.style.transform = 'translate(' + p[0] + 'px, ' + p[1] + 'px)';
  }
  function tick() {
    tickTimer = null;
    if (!overlay || overlay.hidden) return;
    var s = store.get(),
      at = now();
    render();
    shift();
    if (at - lastRefresh >= REFRESH_EVERY) refreshData();
    tickTimer = root.setTimeout(
      tick,
      s.seconds ? 1000 : 60000 - (at % 60000) + 50
    );
  }
  // Panel style only, and only for the blocks it shows; never with the scope off. Non-blocking, errors swallowed.
  function refreshData() {
    var s = store.get(),
      mine = ++generation,
      jobs = [];
    lastRefresh = now();
    if (s.style !== 'panel' || !info.isMrRedify()) return;
    function call(mod) {
      try {
        var p = mod && mod.refresh && mod.refresh();
        if (p && p.then) jobs.push(p.then(null, function () {}));
      } catch (_) {}
    }
    if (s.blocks.rates) call(root.HomeInfoFinance);
    if (s.blocks.football) call(root.HomeFootball);
    if (jobs.length && root.Promise)
      root.Promise.all(jobs).then(function () {
        if (mine === generation && overlay && !overlay.hidden) render();
      });
  }

  function show() {
    if (!overlay || !info.isMrRedify()) return;
    var s = store.get();
    shadeEl.style.opacity = String(s.dim / 100);
    overlay.hidden = false;
    doc.body.classList.add('idle-active');
    lastRefresh = 0;
    if (tickTimer !== null) root.clearTimeout(tickTimer);
    tick();
  }
  function hide() {
    generation++;
    if (tickTimer !== null) root.clearTimeout(tickTimer);
    tickTimer = null;
    if (overlay) overlay.hidden = true;
    doc.body.classList.remove('idle-active');
  }

  // ---- input: capture on window, so nothing underneath sees the waking input ----
  var WAKE = {
      keydown: 'key',
      mousedown: 'pointer',
      pointerdown: 'pointer',
      touchstart: 'pointer',
      mousemove: '',
      pointermove: '',
      wheel: '',
      click: ''
    },
    LATE = {
      key: ['keyup', 'keypress'],
      pointer: ['mouseup', 'pointerup', 'touchend', 'click']
    };
  function consume(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
  }
  function code(e) {
    return e.keyCode || e.which || e.key || 0;
  }
  function onInput(e) {
    if (!controller) return;
    var type = e.type;
    if (controller.isIdle()) {
      consume(e);
      if (type in WAKE) {
        if (WAKE[type])
          swallow = {
            types: LATE[WAKE[type]],
            key: code(e),
            until: now() + SWALLOW_MS
          };
        controller.activity();
      }
      return;
    }
    // The rest of the gesture that woke us (key up / press, mouse up / click) must not reach Home either.
    // A key held down: its repeats are consumed (each one extends the window) until the key up; another key ends it.
    if (swallow) {
      if (now() > swallow.until) swallow = null;
      else if (
        type === 'keydown' &&
        e.repeat &&
        swallow.types.indexOf('keyup') >= 0 &&
        code(e) === swallow.key
      ) {
        swallow.until = now() + SWALLOW_MS;
        return consume(e);
      } else if (WAKE[type]) swallow = null;
      else if (
        swallow.types.indexOf(type) >= 0 &&
        (type.indexOf('key') !== 0 || code(e) === swallow.key)
      ) {
        if (type === 'keyup' || type === 'click') swallow = null;
        return consume(e);
      }
    }
    controller.activity();
  }
  var EVENTS = [
    'keydown',
    'keyup',
    'keypress',
    'mousemove',
    'mousedown',
    'mouseup',
    'click',
    'pointerdown',
    'pointermove',
    'pointerup',
    'wheel',
    'touchstart',
    'touchend'
  ];
  // Another app in front (or back in Home): nothing may run while hidden; coming back counts as activity.
  function onVisibility() {
    if (!controller) return;
    controller.activity();
    if (doc.hidden) hide();
  }
  var listening = false;
  function listen(on) {
    if (on === listening) return;
    listening = on;
    doc[on ? 'addEventListener' : 'removeEventListener'](
      'visibilitychange',
      onVisibility
    );
    EVENTS.forEach(function (type) {
      root[on ? 'addEventListener' : 'removeEventListener'](
        type,
        onInput,
        true
      );
    });
  }

  // ---- lifecycle ----
  function stop() {
    if (controller) controller.stop();
    controller = null;
    listen(false);
    hide();
  }
  function reload() {
    stop();
    if (!info.isMrRedify()) return;
    var minutes = store.get().timeoutMin;
    if (!(minutes > 0)) return;
    controller = createIdleController({
      timeoutMs: minutes * 60000,
      onIdle: show,
      onWake: hide,
      now: now,
      blocked: blocked,
      schedule: function (fn, ms) {
        return root.setTimeout(fn, ms);
      },
      cancel: function (id) {
        root.clearTimeout(id);
      }
    });
    swallow = null;
    listen(true);
    controller.start();
  }

  // ---- Settings tab ----
  function buildTab(pane) {
    pane.classList.add('idle-tab');
    function section(title) {
      var s = el('div', 'idle-section');
      s.appendChild(el('h3', 'idle-section-title', title));
      pane.appendChild(s);
      return s;
    }
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
    var syncs = [];
    function sync() {
      syncs.forEach(function (fn) {
        fn();
      });
    }
    function choice(parent, label, items, key) {
      var row = el('div', 'idle-field');
      row.appendChild(el('span', 'idle-field-label', label));
      items.forEach(function (item) {
        var b = button('idle-' + item.cls, item.text);
        b.onclick = function () {
          var patch = {};
          patch[key] = item.value;
          store.set(patch);
          sync();
          reload();
        };
        syncs.push(function () {
          pressed(b, store.get()[key] === item.value);
        });
        row.appendChild(b);
      });
      parent.appendChild(row);
    }
    function toggle(parent, label, cls, get, set) {
      var row = el('div', 'idle-field'),
        b = button(cls);
      row.appendChild(el('span', 'idle-field-label', label));
      b.onclick = function () {
        set(!get());
        sync();
        reload();
      };
      syncs.push(function () {
        var on = get();
        b.textContent = on ? t('On') : t('Off');
        pressed(b, on);
      });
      row.appendChild(b);
      parent.appendChild(row);
    }
    var s1 = section(t('Idle screen'));
    choice(
      s1,
      t('Style'),
      [
        { cls: 'style-clock', text: t('Clock'), value: 'clock' },
        { cls: 'style-panel', text: t('Panel'), value: 'panel' }
      ],
      'style'
    );
    choice(
      s1,
      t('Start after (minutes)'),
      TIMEOUTS.map(function (m) {
        return {
          cls: 'timeout-' + m,
          text: m ? String(m) : t('Off'),
          value: m
        };
      }),
      'timeoutMin'
    );
    var dimRow = el('div', 'idle-field'),
      dimValue = el('span', 'idle-dim-value'),
      down = button('idle-dim-down', '−'),
      up = button('idle-dim-up', '+');
    function dimBy(step) {
      store.set({ dim: store.get().dim + step });
      sync();
      reload();
    }
    down.onclick = function () {
      dimBy(-10);
    };
    up.onclick = function () {
      dimBy(10);
    };
    dimRow.appendChild(el('span', 'idle-field-label', t('Darkness')));
    dimRow.appendChild(down);
    dimRow.appendChild(dimValue);
    dimRow.appendChild(up);
    syncs.push(function () {
      dimValue.textContent = store.get().dim + '%';
    });
    s1.appendChild(dimRow);
    toggle(
      s1,
      t('Seconds'),
      'idle-seconds',
      function () {
        return store.get().seconds;
      },
      function (v) {
        store.set({ seconds: v });
      }
    );
    var s2 = section(t('Panel blocks'));
    [
      ['date', t('Date')],
      ['rates', t('Exchange rates')],
      ['football', t('Football')]
    ].forEach(function (pair) {
      toggle(
        s2,
        pair[1],
        'idle-block-toggle idle-block-toggle-' + pair[0],
        function () {
          return store.get().blocks[pair[0]];
        },
        function (v) {
          var next = {};
          BLOCKS.forEach(function (k) {
            next[k] = store.get().blocks[k];
          });
          next[pair[0]] = v;
          store.set({ blocks: next });
        }
      );
    });
    pane.appendChild(
      el(
        'div',
        'idle-note',
        t(
          'The LG system screensaver is separate and only runs outside Home. Set its timeout longer than this one, or turn it off.'
        )
      )
    );
    sync();
  }

  // ---- wiring ----
  function init() {
    overlay = doc.getElementById('idleScreen');
    if (!overlay) return;
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
    shadeEl = el('div', 'idle-shade');
    contentEl = el('div', 'idle-content');
    overlay.appendChild(shadeEl);
    overlay.appendChild(contentEl);
    reload();
  }
  if (info.onScopeChange)
    info.onScopeChange(function (active) {
      if (active) reload();
      else stop();
    });
  if (info.registerTab)
    info.registerTab({ id: 'idle', label: t('Idle screen'), build: buildTab });
  info.idle = store;
  root.HomeIdle = {
    createController: createIdleController,
    sanitize: sanitize,
    reload: reload,
    isRunning: function () {
      return !!controller;
    }
  };
  if (doc.readyState === 'loading')
    doc.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof window !== 'undefined' ? window : this);
