/* Home info: BNR exchange rates page (info panel) and the "Rates & holidays" Settings tab, mr.redify only.
 *
 * Rates come from the Home Helper service method bnrRates (luna://com.gathin.tvhome.renewal), which returns the
 * BNR XML; the page never contacts the network itself. Cached 3 hours (HomeInfoFetch). When the service has no
 * bnrRates (Root edition, or a TV whose Home Helper was not reinstalled) the page shows "service update required".
 *
 * Store HomeInfo.finance (tvhome.finance.v1): chosen currencies (1 to 8) plus the latest two published days
 * (current / previous), kept so the page can show an up/down arrow. The page has no keys of its own: Left/Right
 * fall through to the info panel. While the page is shown it refreshes every 3 hours; no timer otherwise.
 */
(function (root) {
  'use strict';
  var doc = root.document,
    TTL = 3 * 3600000,
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
      { currencies: DEFAULTS.slice(), current: null, previous: null },
      function (raw) {
        var out = {},
          list;
        if ('currencies' in raw && (list = sanitizeCurrencies(raw.currencies)))
          out.currencies = list;
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
  // Never rejects. state: ok | offline | update-required; fetchedAt = when the shown data was fetched (null: none).
  function refresh() {
    lastIssue = null;
    var cache = root.HomeInfoFetch;
    if (!cache)
      return root.Promise.resolve({ state: 'offline', fetchedAt: null });
    return cache.cached('bnr', TTL, load).then(
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
    return refresh().then(function (result) {
      last = result;
      if (visible) render();
    });
  }
  function onShow() {
    visible = true;
    last = null;
    render();
    update();
    if (!timer) timer = root.setInterval(update, TTL);
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
    // learn the available codes and the service state; cached for 3 hours, so cheap on later visits.
    var busy = false;
    pane.addEventListener('focusin', function () {
      if (busy || !info.isMrRedify()) return;
      busy = true;
      refresh().then(function (result) {
        busy = false;
        last = result;
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
    refresh: refresh
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
