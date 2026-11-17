/* Home info: BNR exchange rates page (info panel) and the "Rates & holidays" Settings tab, mr.redify only.
 *
 * Rates come from the Home Helper service method bnrRates (luna://com.gathin.tvhome.renewal), which returns the
 * BNR XML; the page never contacts the network itself. When the service has no bnrRates (Root edition, or a TV whose
 * Home Helper was not reinstalled) the page shows "service update required".
 *
 * Schedule (refreshIfDue): BNR publishes the day's rates shortly after 13:00 Romanian time on banking days (measured:
 * 13:01 on 16.11.2026). A request is made only at the slots 13:05 and 14:05 Romanian time of a banking day (Monday to
 * Friday, not a Romanian legal holiday): the first brings the new date; the second is sent only when the first did not
 * (BNR late). A TV switched on later makes one catch-up request as soon as Home is in front. Romanian time comes from
 * the device UTC clock with the EU summer-time rule, not from the TV's timezone setting. A request that gets no answer
 * does not use up its slot: it is retried after 10 minutes, at most 3 tries per slot. Nothing is requested at any other
 * time, so no periodic refresh exists; callers use refreshIfDue(), which costs nothing when nothing is due.
 *
 * Store HomeInfo.finance (tvhome.finance.v1): chosen currencies (1 to 8) plus the latest two published days
 * (current / previous), kept so the page can show an up/down arrow. The page has no keys of its own: Left/Right
 * fall through to the info panel. While the page is shown a cheap 60 s check asks the schedule; no timer otherwise.
 */
(function (root) {
  'use strict';
  var doc = root.document,
    SCHED_KEY = 'tvhome.bnr.sched.v1', // { answeredAt, slot, tries, tryAt } (ms); corrupt = never asked
    SLOT_1 = [13, 5],
    SLOT_2 = [14, 5],
    RETRY_MS = 10 * 60000,
    MAX_TRIES = 3,
    clock = function () {
      return Date.now();
    },
    MAX_CURRENCIES = 8,
    DEFAULTS = ['EUR', 'USD', 'GBP', 'CHF'],
    info = root.HomeInfo,
    sequence = 0,
    lastIssue = null; // 'service' when the service lacks bnrRates, set by the loader

  function t(text) {
    return root.HomeI18n ? root.HomeI18n.t(text) : text;
  }

  // ---- parsing (fixed BNR format; no DOM parser needed on the old engine) ----
  function parse(xml) {
    if (typeof xml !== 'string' || xml.indexOf('<DataSet') < 0)
      throw new Error('BNR XML invalid');
    var date =
        /<PublishingDate>\s*(\d{4}-\d{2}-\d{2})\s*<\/PublishingDate>/.exec(xml),
      rates = {},
      count = 0,
      re = /<Rate\s([^>]*)>\s*([^<]*?)\s*<\/Rate>/g,
      m;
    if (!date) throw new Error('BNR XML without date');
    while ((m = re.exec(xml))) {
      var code = /(?:^|\s)currency="([A-Z]{3})"/.exec(m[1]),
        mult = /(?:^|\s)multiplier="(\d{1,6})"/.exec(m[1]),
        value = /^\d+(\.\d+)?$/.test(m[2]) ? Number(m[2]) : NaN,
        multiplier = mult ? Number(mult[1]) : 1;
      if (!code || !(value > 0) || !isFinite(value) || !(multiplier >= 1))
        continue;
      rates[code[1]] = { value: value, multiplier: multiplier };
      count++;
    }
    if (!count) throw new Error('BNR XML without rates');
    return { date: date[1], rates: rates };
  }

  // ---- store ----
  function sanitizeCurrencies(list) {
    var out = [];
    if (!Array.isArray(list)) return null;
    for (var i = 0; i < list.length && out.length < MAX_CURRENCIES; i++)
      if (
        typeof list[i] === 'string' &&
        /^[A-Z]{3}$/.test(list[i]) &&
        out.indexOf(list[i]) < 0
      )
        out.push(list[i]);
    return out.length ? out : null;
  }
  function sanitizeDay(day) {
    if (!day || typeof day !== 'object' || Array.isArray(day)) return null;
    if (typeof day.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day.date))
      return null;
    if (!day.rates || typeof day.rates !== 'object') return null;
    var rates = {},
      count = 0,
      code;
    for (code in day.rates) {
      var r = day.rates[code];
      if (
        Object.prototype.hasOwnProperty.call(day.rates, code) &&
        /^[A-Z]{3}$/.test(code) &&
        r &&
        typeof r.value === 'number' &&
        isFinite(r.value) &&
        r.value > 0 &&
        typeof r.multiplier === 'number' &&
        r.multiplier >= 1 &&
        r.multiplier % 1 === 0
      ) {
        rates[code] = { value: r.value, multiplier: r.multiplier };
        count++;
      }
    }
    return count ? { date: day.date, rates: rates } : null;
  }
  var store = null;
  if (info && info.createStore) {
    store = info.createStore(
      'tvhome.finance.v1',
      {
        currencies: DEFAULTS.slice(),
        current: null,
        previous: null,
        landing: false
      },
      function (raw) {
        var out = {},
          list;
        if ('currencies' in raw && (list = sanitizeCurrencies(raw.currencies)))
          out.currencies = list;
        if ('landing' in raw) out.landing = raw.landing === true;
        ['current', 'previous'].forEach(function (key) {
          if (!(key in raw)) return;
          if (raw[key] === null) out[key] = null;
          else {
            var day = sanitizeDay(raw[key]);
            if (day) out[key] = day;
          }
        });
        return out;
      }
    );
    info.finance = store;
  }

  // A newer date moves current to previous; the same date refreshes current only; an older one is ignored.
  function ingest(parsed) {
    var day = sanitizeDay(parsed);
    if (!day || !store) return;
    var state = store.get(),
      patch = { current: day };
    if (state.current) {
      if (day.date < state.current.date) return;
      if (day.date > state.current.date) patch.previous = state.current;
    }
    store.set(patch);
  }

  function perUnit(r) {
    return r.value / r.multiplier;
  }
  // 1 = up against previous, -1 = down, 0 = same or no comparison.
  function trend(code) {
    var s = store && store.get();
    if (!s || !s.current || !s.previous) return 0;
    var a = s.current.rates[code],
      b = s.previous.rates[code];
    if (!a || !b) return 0;
    var x = perUnit(a),
      y = perUnit(b);
    return x > y ? 1 : x < y ? -1 : 0;
  }
  function format(code, r) {
    return (
      (r.multiplier > 1 ? r.multiplier + ' ' : '') +
      code +
      ' ' +
      r.value.toFixed(4)
    );
  }
  function idleLines() {
    var s = store && store.get(),
      out = [];
    if (!s || !s.current) return out;
    s.currencies.forEach(function (code) {
      var r = s.current.rates[code];
      if (r) out.push(format(code, r));
    });
    return out;
  }

  // Main-page card (landing-widgets.js): the chosen currencies in two lines of two (at most 4) and the BNR publication
  // date, from the stored data only. null without data.
  function landingCard() {
    var s = store && store.get(),
      all = idleLines().slice(0, 4),
      lines = [],
      m,
      i;
    if (!s || !s.current || !all.length) return null;
    for (i = 0; i < all.length; i += 2)
      lines.push(all.slice(i, i + 2).join('  '));
    m = /^\d{4}-(\d{2})-(\d{2})$/.exec(s.current.date);
    return {
      title: t('Exchange rates'),
      meta: m ? m[2] + '.' + m[1] : '',
      lines: lines
    };
  }

  // ---- service transport ----
  // Resolves with the XML string. Rejects with Error('service') when bnrRates is unavailable, any other
  // Error otherwise (network, timeout, bad reply).
  function transport() {
    return new root.Promise(function (resolve, reject) {
      var bridge,
        timer,
        settled = false;
      function finish(error, xml) {
        if (settled) return;
        settled = true;
        if (timer) root.clearTimeout(timer);
        if (bridge) bridge.onservicecallback = function () {};
        error ? reject(error) : resolve(xml);
      }
      try {
        if (root.ROOT_VERSION || !root.PalmServiceBridge)
          throw new Error('service');
        bridge = new root.PalmServiceBridge();
        bridge.onservicecallback = function (raw) {
          try {
            var reply = JSON.parse(raw);
            if (reply && reply.returnValue === true) {
              if (typeof reply.xml !== 'string') throw new Error('response');
              finish(null, reply.xml);
            } else if (
              reply &&
              typeof reply.errorCode === 'string' &&
              /^bnr-/.test(reply.errorCode)
            )
              // Transient (bnr-busy, timeout, network, ...): offline, not "service update required".
              finish(new Error(reply.errorCode));
            else finish(new Error('service')); // unknown method, not authorized, invalid request
          } catch (_) {
            finish(new Error('service'));
          }
        };
        // The service has a 12-second deadline; allow its answer to arrive first.
        timer = root.setTimeout(function () {
          finish(new Error('bnr-timeout'));
        }, 15000);
        bridge.call(
          'luna://com.gathin.tvhome.renewal/bnrRates',
          JSON.stringify({
            id:
              'bnr-' + Date.now().toString(36) + '-' + (++sequence).toString(36)
          })
        );
      } catch (e) {
        finish(e && e.message === 'service' ? e : new Error('service'));
      }
    });
  }
  function load() {
    return transport().catch(function (error) {
      lastIssue = error && error.message === 'service' ? 'service' : 'network';
      throw error;
    });
  }
  // ---- schedule: Romanian time from the UTC clock, banking days, slots ----
  // UTC day of the last Sunday of a month (month 1-12).
  function lastSunday(year, month) {
    var last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return last - new Date(Date.UTC(year, month - 1, last)).getUTCDay();
  }
  // EEST (UTC+3) from the last Sunday of March 01:00 UTC to the last Sunday of October 01:00 UTC; else EET (UTC+2).
  function isSummerTime(utcMs) {
    var y = new Date(utcMs).getUTCFullYear();
    return (
      utcMs >= Date.UTC(y, 2, lastSunday(y, 3), 1) &&
      utcMs < Date.UTC(y, 9, lastSunday(y, 10), 1)
    );
  }
  function roOffsetMin(utcMs) {
    return isSummerTime(utcMs) ? 180 : 120;
  }
  // Romanian calendar date and time of an instant.
  function roLocal(utcMs) {
    var d = new Date(utcMs + roOffsetMin(utcMs) * 60000);
    return {
      y: d.getUTCFullYear(),
      m: d.getUTCMonth() + 1,
      d: d.getUTCDate(),
      h: d.getUTCHours(),
      min: d.getUTCMinutes()
    };
  }
  // The UTC instant of h:min Romanian time on a Romanian date.
  function slotUtc(day, hm) {
    var local = Date.UTC(day.y, day.m - 1, day.d, hm[0], hm[1]),
      guess = local - 120 * 60000;
    return isSummerTime(guess) ? local - 180 * 60000 : guess;
  }
  function prevDay(day) {
    var d = new Date(Date.UTC(day.y, day.m - 1, day.d - 1));
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
  }
  function isBankingDay(day) {
    var dow = new Date(Date.UTC(day.y, day.m - 1, day.d)).getUTCDay(),
      names = [];
    if (dow < 1 || dow > 5) return false;
    try {
      names = root.HomeRoCalendar
        ? root.HomeRoCalendar.holidayNames(day.y, day.m, day.d)
        : [];
    } catch (_) {}
    return !names.length;
  }
  function iso(day) {
    return day.y + '-' + two(day.m) + '-' + two(day.d);
  }
  // The rate date that must exist at this instant (the latest banking day whose first slot has passed) and the instant
  // of the latest slot that has passed for it: { date, slot1, slot2, latest }. null when none is found.
  function neededRate(now) {
    var day = roLocal(now),
      i;
    day = { y: day.y, m: day.m, d: day.d };
    if (now < slotUtc(day, SLOT_1)) day = prevDay(day);
    for (i = 0; i < 20; i++) {
      if (isBankingDay(day) && now >= slotUtc(day, SLOT_1)) {
        var s1 = slotUtc(day, SLOT_1),
          s2 = slotUtc(day, SLOT_2);
        return { date: iso(day), slot1: s1, slot2: s2, latest: now >= s2 ? s2 : s1 };
      }
      day = prevDay(day);
    }
    return null;
  }
  function readSched() {
    var out = { answeredAt: 0, slot: 0, tries: 0, tryAt: 0 },
      raw;
    try {
      raw = JSON.parse(root.localStorage.getItem(SCHED_KEY));
    } catch (_) {}
    if (raw && typeof raw === 'object')
      Object.keys(out).forEach(function (k) {
        if (typeof raw[k] === 'number' && isFinite(raw[k]) && raw[k] >= 0)
          out[k] = raw[k];
      });
    return out;
  }
  function writeSched(v) {
    try {
      root.localStorage.setItem(SCHED_KEY, JSON.stringify(v));
    } catch (_) {}
  }
  // Is a request due at this instant, given the stored rates and the schedule record?
  function isDue(now, current, sched) {
    var need = neededRate(now),
      tries;
    if (!need) return false;
    if (current && current.date >= need.date) return false;
    // Something in the future (TV clock was wrong when it was written) never blocks a request.
    if (current && sched.answeredAt >= need.latest && sched.answeredAt <= now)
      return false;
    tries = sched.slot === need.latest ? sched.tries : 0;
    if (tries >= MAX_TRIES) return false;
    if (tries > 0 && now - sched.tryAt < RETRY_MS && now >= sched.tryAt)
      return false;
    return true;
  }
  // Records the outcome of a request: an answer ends the slot; no answer counts a try (never more than 3 per slot).
  function record(now, ok) {
    var sched = readSched(),
      need = neededRate(now),
      slot = need ? need.latest : 0;
    if (ok) writeSched({ answeredAt: now, slot: slot, tries: 0, tryAt: 0 });
    else
      writeSched({
        answeredAt: sched.answeredAt,
        slot: slot,
        tries: (sched.slot === slot ? sched.tries : 0) + 1,
        tryAt: now
      });
  }

  // Never rejects. state: ok | offline | update-required; fetchedAt = when the shown data was fetched (null: none).
  function request() {
    lastIssue = null;
    var cache = root.HomeInfoFetch;
    if (!cache)
      return root.Promise.resolve({ state: 'offline', fetchedAt: null });
    // TTL 0: every call asks (the schedule decides when to call); the stored copy only serves as the stale fallback.
    return cache.cached('bnr', 0, load).then(
      function (result) {
        var shown = result.fetchedAt;
        try {
          ingest(parse(result.value));
        } catch (_) {
          return { state: 'offline', fetchedAt: null };
        }
        if (result.stale)
          return {
            state: lastIssue === 'service' ? 'update-required' : 'offline',
            fetchedAt: shown
          };
        return { state: 'ok', fetchedAt: shown };
      },
      function () {
        return {
          state: lastIssue === 'service' ? 'update-required' : 'offline',
          fetchedAt: null
        };
      }
    );
  }

  var pending = null;
  // Forced request (test seam; the schedule is not consulted). Counts as a try or an answer for the schedule.
  function refresh() {
    if (pending) return pending;
    pending = request().then(function (result) {
      pending = null;
      record(clock(), result.state === 'ok');
      return result;
    });
    return pending;
  }
  var IDLE = { state: 'idle', fetchedAt: null, skipped: true };
  // The only entry point of consumers (page, widgets, idle screen): asks BNR only when the schedule says so. Never
  // rejects; costs nothing (no request, no timer) otherwise or with the scope off.
  function refreshIfDue() {
    if (!store || (info && info.isMrRedify && !info.isMrRedify()))
      return root.Promise.resolve(IDLE);
    if (pending) return pending;
    if (!isDue(clock(), store.get().current, readSched()))
      return root.Promise.resolve(IDLE);
    return refresh();
  }

  // ---- page ----
  function el(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function two(n) {
    return (n < 10 ? '0' : '') + n;
  }
  function stamp(ms) {
    var d = new Date(ms);
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
  function statusText(result) {
    if (!result) return '';
    if (result.state === 'update-required')
      return t('Service update required: reinstall Home Helper');
    if (result.state === 'offline')
      return result.fetchedAt
        ? t('Offline') +
            '. ' +
            t('Last updated') +
            ' ' +
            stamp(result.fetchedAt)
        : t('Rates unavailable');
    return '';
  }
  var host = null,
    visible = false,
    timer = null,
    last = null;

  function render() {
    if (!host) return;
    var s = store.get(),
      head = el('div', 'fin-head'),
      list = el('div', 'fin-list'),
      status = statusText(last);
    host.innerHTML = '';
    head.appendChild(el('div', 'fin-title', t('Exchange rates')));
    head.appendChild(
      el(
        'div',
        'fin-date',
        s.current ? 'BNR · ' + s.current.date : t('Nothing to show yet')
      )
    );
    host.appendChild(head);
    if (s.current)
      s.currencies.forEach(function (code) {
        var r = s.current.rates[code],
          row = el('div', 'fin-row'),
          arrow = r ? trend(code) : 0;
        row.appendChild(el('span', 'fin-code', code));
        row.appendChild(
          el(
            'span',
            'fin-value',
            r
              ? (r.multiplier > 1 ? r.multiplier + ' = ' : '') +
                  r.value.toFixed(4) +
                  ' RON'
              : '–'
          )
        );
        row.appendChild(
          el(
            'span',
            'fin-arrow' + (arrow > 0 ? ' up' : arrow < 0 ? ' down' : ''),
            arrow > 0 ? '▲' : arrow < 0 ? '▼' : ''
          )
        );
        list.appendChild(row);
      });
    host.appendChild(list);
    if (status) host.appendChild(el('div', 'fin-status', status));
  }
  function update() {
    return refreshIfDue().then(function (result) {
      if (result.skipped) return; // nothing was due: keep what the page shows
      last = result;
      if (visible) render();
    });
  }
  function onShow() {
    visible = true;
    last = null;
    render();
    update();
    // A cheap check every minute while the page is shown (a slot can come up while it is open); no request unless due.
    if (!timer) timer = root.setInterval(update, 60000);
  }
  function onHide() {
    visible = false;
    if (timer) root.clearInterval(timer);
    timer = null;
  }

  // ---- settings tab: Rates & holidays ----
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
    var daily = info.daily,
      chips = el('div', 'fin-chips'),
      status = el('div', 'fin-status'),
      hint = el('div', 'fin-hint');
    pane.classList.add('fin-tab');
    function section(title) {
      var s = el('div', 'fin-section');
      s.appendChild(el('h3', 'fin-section-title', title));
      pane.appendChild(s);
      return s;
    }
    function toggleRow(parent, label, key) {
      var row = el('div', 'fin-field'),
        b = button('fin-toggle fin-toggle-' + key);
      function sync() {
        var on = daily.get()[key] !== false;
        b.textContent = on ? t('On') : t('Off');
        pressed(b, on);
      }
      b.onclick = function () {
        var patch = {};
        patch[key] = !daily.get()[key];
        daily.set(patch);
        sync();
      };
      row.appendChild(el('span', 'fin-field-label', label));
      row.appendChild(b);
      parent.appendChild(row);
      sync();
    }
    // First control: show the rates card on the main page.
    var sl = section(t('Show on main page')),
      rowL = el('div', 'fin-field'),
      landing = button('fin-toggle fin-toggle-landing');
    function syncLanding() {
      var on = store.get().landing === true;
      landing.textContent = on ? t('On') : t('Off');
      pressed(landing, on);
    }
    landing.onclick = function () {
      store.set({ landing: !store.get().landing });
      syncLanding();
    };
    rowL.appendChild(el('span', 'fin-field-label', t('Rates')));
    rowL.appendChild(landing);
    sl.appendChild(rowL);
    syncLanding();
    // Second toggle: the Name day card (stored with the calendar marks in tvhome.daily.v1).
    if (info.daily) {
      var rowN = el('div', 'fin-field'),
        nameday = button('fin-toggle fin-toggle-nameday');
      nameday.onclick = function () {
        info.daily.set({ landing: !info.daily.get().landing });
        syncNameday();
      };
      rowN.appendChild(
        el('span', 'fin-field-label', t('Show name day on main page'))
      );
      rowN.appendChild(nameday);
      sl.appendChild(rowN);
      syncNameday();
    }
    function syncNameday() {
      var on = info.daily.get().landing === true;
      nameday.textContent = on ? t('On') : t('Off');
      pressed(nameday, on);
    }
    if (daily) {
      var s1 = section(t('Calendar marks'));
      toggleRow(s1, t('Holidays'), 'showHolidays');
      toggleRow(s1, t('Name days'), 'showNameDays');
    }
    var s2 = section(t('Exchange rates')),
      focusCode = null;
    function codes() {
      var s = store.get(),
        list = s.current
          ? Object.keys(s.current.rates).sort()
          : DEFAULTS.slice();
      s.currencies.forEach(function (code) {
        if (list.indexOf(code) < 0) list.push(code);
      });
      return list;
    }
    var shown = '';
    function refreshChips() {
      var chosen = store.get().currencies;
      shown = codes().join();
      chips.innerHTML = '';
      codes().forEach(function (code) {
        var b = button('fin-chip', code),
          on = chosen.indexOf(code) >= 0;
        pressed(b, on);
        b.onclick = function () {
          var now = store.get().currencies,
            at = now.indexOf(code),
            next;
          if (at >= 0) {
            if (now.length <= 1) {
              status.textContent = t('Keep at least one currency');
              return;
            }
            next = now.filter(function (c) {
              return c !== code;
            });
          } else {
            if (now.length >= MAX_CURRENCIES) {
              status.textContent = t('At most 8 currencies');
              return;
            }
            next = now.concat([code]);
          }
          status.textContent = '';
          store.set({ currencies: next });
          focusCode = code;
          refreshChips();
        };
        chips.appendChild(b);
        if (focusCode === code) {
          focusCode = null;
          b.focus();
        }
      });
    }
    function refreshHint() {
      hint.textContent =
        last && last.state === 'update-required'
          ? t('Service update required: reinstall Home Helper')
          : '';
    }
    s2.appendChild(chips);
    s2.appendChild(status);
    s2.appendChild(hint);
    refreshChips();
    refreshHint();
    // Tabs are built at load, so nothing is fetched then. When focus first enters the pane (scope on only),
    // learn the available codes and the service state; only when the BNR schedule says a request is due.
    var busy = false;
    pane.addEventListener('focusin', function () {
      if (busy || !info.isMrRedify()) return;
      busy = true;
      refreshIfDue().then(function (result) {
        busy = false;
        if (!result.skipped) last = result;
        if (codes().join() !== shown) refreshChips(); // keep the focused chip while nothing changed
        refreshHint();
      });
    });
  }

  root.HomeInfoFinance = {
    parse: parse,
    ingest: ingest,
    trend: trend,
    idleLines: idleLines,
    landingCard: landingCard,
    refresh: refresh,
    refreshIfDue: refreshIfDue,
    // Schedule (pure, exported for tests).
    roLocal: roLocal,
    isSummerTime: isSummerTime,
    neededRate: neededRate,
    isDue: isDue,
    setClock: function (fn) {
      clock = typeof fn === 'function' ? fn : Date.now.bind(Date);
    }
  };
  if (info && store) {
    if (info.registerTab)
      info.registerTab({
        id: 'daily',
        order: 20,
        label: 'Rates & holidays',
        build: buildTab
      });
    if (root.InfoPanel)
      root.InfoPanel.registerPage({
        id: 'finance',
        label: 'Exchange rates',
        render: function (container) {
          host = container;
          host.classList.add('fin-page');
        },
        onShow: onShow,
        onHide: onHide
      });
  }
})(window);
