/* Home info: monthly calendar page (info panel) and Calendar settings tab, mr.redify only.
 *
 * Stores: HomeInfo.daily (tvhome.daily.v1: what to mark; its toggles are built by the Rates & holidays tab)
 * and HomeInfo.calendar (tvhome.calendar.v1: week start, week numbers, own events, max 50).
 * A non-yearly event stores the year it applies to; one saved without a year applies to every year.
 *
 * Keys (the page listens on window in the capture phase, before the info panel):
 *   Left/Right  previous/next day, except Left in the first grid column and Right in the last one,
 *               which are left to the panel (switch to the previous/next page);
 *   Up/Down     one week back/forward;
 *   PageUp/PageDown or CH-/CH+  previous/next month. Moving across a month edge changes the month.
 */
(function (root) {
  'use strict';
  var doc = root.document,
    DAY = 86400000,
    MAX_EVENTS = 50,
    MAX_TITLE = 60,
    TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/,
    DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31],
    MONTHS = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December'
    ],
    WEEKDAYS = [
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday'
    ],
    SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    clock = function () {
      return new Date();
    };

  function t(text) {
    return root.HomeI18n ? root.HomeI18n.t(text) : text;
  }
  // English text through the catalogue; other languages without an entry use the engine's date names.
  function nameOf(english, fallback) {
    var text = t(english);
    if (
      text !== english ||
      !root.HomeI18n ||
      /^en/.test(root.HomeI18n.language())
    )
      return text;
    try {
      return fallback() || english;
    } catch (_) {
      return english;
    }
  }
  function monthName(month) {
    return nameOf(MONTHS[month - 1], function () {
      return root.HomeI18n.formatDate(new Date(2026, month - 1, 15), {
        month: 'long'
      });
    });
  }
  // index 0 = Monday
  function weekdayName(index, short) {
    return nameOf((short ? SHORT : WEEKDAYS)[index], function () {
      return root.HomeI18n.formatDate(new Date(2026, 0, 5 + index), {
        weekday: short ? 'short' : 'long'
      });
    });
  }
  function two(n) {
    return (n < 10 ? '0' : '') + n;
  }
  function daysIn(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }
  // 0 = Monday
  function weekdayOf(year, month, day) {
    return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
  }
  function shift(date, days) {
    var d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate()
    };
  }
  function shiftMonth(date, months) {
    var index = date.year * 12 + date.month - 1 + months,
      year = Math.floor(index / 12),
      month = (index % 12) + 1;
    return {
      year: year,
      month: month,
      day: Math.min(date.day, daysIn(year, month))
    };
  }

  function monthGrid(year, month, weekStart) {
    var start = weekStart === 'sun' ? 6 : 0,
      offset = (weekdayOf(year, month, 1) - start + 7) % 7,
      rows = Math.ceil((offset + daysIn(year, month)) / 7),
      out = [],
      r,
      c;
    for (r = 0; r < rows; r++) {
      var row = [];
      for (c = 0; c < 7; c++) {
        var d = new Date(Date.UTC(year, month - 1, 1 - offset + r * 7 + c));
        row.push({
          year: d.getUTCFullYear(),
          month: d.getUTCMonth() + 1,
          day: d.getUTCDate(),
          inMonth: d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month
        });
      }
      out.push(row);
    }
    return out;
  }
  function isoWeek(year, month, day) {
    var time = Date.UTC(year, month - 1, day),
      thursday = new Date(time + (3 - weekdayOf(year, month, day)) * DAY),
      first = Date.UTC(thursday.getUTCFullYear(), 0, 1);
    return Math.floor((thursday.getTime() - first) / DAY / 7) + 1;
  }

  function sanitizeEvents(list) {
    var out = [];
    if (!Array.isArray(list)) return out;
    for (var i = 0; i < list.length && out.length < MAX_EVENTS; i++) {
      var e = list[i];
      if (!e || typeof e !== 'object') continue;
      var title =
        typeof e.title === 'string'
          ? e.title.trim().slice(0, MAX_TITLE).trim()
          : '';
      if (
        typeof e.id !== 'string' ||
        !e.id ||
        !title ||
        e.month % 1 !== 0 ||
        e.day % 1 !== 0 ||
        typeof e.month !== 'number' ||
        typeof e.day !== 'number' ||
        e.month < 1 ||
        e.month > 12 ||
        e.day < 1 ||
        e.day > DAYS[e.month - 1] ||
        typeof e.yearly !== 'boolean'
      )
        continue;
      var item = {
        id: e.id,
        day: e.day,
        month: e.month,
        title: title,
        yearly: e.yearly
      };
      // Optional time of day, 24 h "HH:MM"; anything else drops the time, not the event (all day).
      if (typeof e.time === 'string' && TIME_RE.test(e.time)) item.time = e.time;
      if (
        !e.yearly &&
        typeof e.year === 'number' &&
        e.year % 1 === 0 &&
        e.year >= 1900 &&
        e.year <= 2099
      )
        item.year = e.year;
      out.push(item);
    }
    return out;
  }

  var info = root.HomeInfo,
    daily = null,
    calendar = null;
  if (info && info.createStore) {
    daily = info.createStore(
      'tvhome.daily.v1',
      { showHolidays: true, showNameDays: true, landing: false },
      function (raw) {
        var out = {};
        if ('landing' in raw) out.landing = raw.landing === true;
        if (typeof raw.showHolidays === 'boolean')
          out.showHolidays = raw.showHolidays;
        if (typeof raw.showNameDays === 'boolean')
          out.showNameDays = raw.showNameDays;
        return out;
      }
    );
    calendar = info.createStore(
      'tvhome.calendar.v1',
      { weekStart: 'mon', weekNumbers: false, events: [], landing: false },
      function (raw) {
        var out = {};
        if (raw.weekStart === 'mon' || raw.weekStart === 'sun')
          out.weekStart = raw.weekStart;
        if (typeof raw.weekNumbers === 'boolean')
          out.weekNumbers = raw.weekNumbers;
        if ('landing' in raw) out.landing = raw.landing === true;
        if ('events' in raw) out.events = sanitizeEvents(raw.events);
        return out;
      }
    );
    info.daily = daily;
    info.calendar = calendar;
  }

  function safe(fn, fallback) {
    try {
      return fn();
    } catch (_) {
      return fallback;
    }
  }
  // Events of one day: all-day first, then by time.
  function eventsOn(events, y, m, d) {
    return events
      .filter(function (e) {
        return (
          e.month === m &&
          e.day === d &&
          (e.yearly || e.year === undefined || e.year === y)
        );
      })
      .map(function (e, i) {
        return { e: e, i: i };
      })
      .sort(function (a, b) {
        var x = a.e.time || '',
          y2 = b.e.time || '';
        return x === y2 ? a.i - b.i : x < y2 ? -1 : 1;
      })
      .map(function (p) {
        return p.e;
      });
  }
  // "14:30" in the Home clock format (12 h or 24 h); plain 24 h when the formatter is not available.
  function timeText(time) {
    var h = parseInt(time.slice(0, 2), 10),
      m = parseInt(time.slice(3, 5), 10);
    try {
      if (root.HomeI18n && root.HomeI18n.formatTime)
        return root.HomeI18n.formatTime(new Date(2000, 0, 1, h, m), false);
    } catch (_) {}
    return time;
  }
  function el(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // ---- page ----
  var host = null,
    selected = null,
    listening = false;

  function readToday() {
    var d = safe(clock, null);
    if (!d || isNaN(d.getTime())) return null;
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
  }
  function render() {
    if (!host) return;
    var today = readToday(), // device date, read once per render
      settings = safe(calendar.get, {
        weekStart: 'mon',
        weekNumbers: false,
        events: []
      }),
      marks = safe(daily.get, { showHolidays: true, showNameDays: true });
    host.innerHTML = '';
    if (!today) {
      host.appendChild(el('div', 'cal-empty', t('Date unavailable')));
      return;
    }
    if (!selected) selected = today;
    var grid = monthGrid(selected.year, selected.month, settings.weekStart),
      start = settings.weekStart === 'sun' ? 6 : 0,
      head = el('div', 'cal-head'),
      table = el('div', 'cal-grid'),
      row = el('div', 'cal-row cal-weekdays'),
      i,
      r,
      c;
    head.appendChild(
      el('div', 'cal-title', monthName(selected.month) + ' ' + selected.year)
    );
    host.appendChild(head);
    if (settings.weekNumbers)
      row.appendChild(el('div', 'cal-weekno cal-weekno-head', t('Wk')));
    for (i = 0; i < 7; i++)
      row.appendChild(
        el('div', 'cal-weekday', weekdayName((start + i) % 7, true))
      );
    table.appendChild(row);
    for (r = 0; r < grid.length; r++) {
      row = el('div', 'cal-row');
      if (settings.weekNumbers) {
        var thursday = grid[r][(3 - start + 7) % 7];
        row.appendChild(
          el(
            'div',
            'cal-weekno',
            String(isoWeek(thursday.year, thursday.month, thursday.day))
          )
        );
      }
      for (c = 0; c < 7; c++) {
        var cell = grid[r][c],
          node = el('div', 'cal-cell', String(cell.day)),
          dow = (start + c) % 7;
        if (cell.inMonth) node.className += ' in-month';
        if (dow >= 5) node.className += ' weekend';
        if (
          cell.year === today.year &&
          cell.month === today.month &&
          cell.day === today.day
        )
          node.className += ' today';
        if (
          marks.showHolidays &&
          safe(function () {
            return root.HomeRoCalendar.holidayNames(
              cell.year,
              cell.month,
              cell.day
            ).length;
          }, 0)
        )
          node.className += ' holiday';
        if (eventsOn(settings.events, cell.year, cell.month, cell.day).length)
          node.className += ' has-event';
        if (
          cell.year === selected.year &&
          cell.month === selected.month &&
          cell.day === selected.day
        )
          node.className += ' selected';
        row.appendChild(node);
      }
      table.appendChild(row);
    }
    host.appendChild(table);
    host.appendChild(detail(selected, settings, marks));
  }
  function detail(day, settings, marks) {
    var box = el('div', 'cal-detail'),
      holidays = safe(function () {
        return marks.showHolidays
          ? root.HomeRoCalendar.holidayNames(day.year, day.month, day.day)
          : [];
      }, []),
      names = safe(function () {
        return marks.showNameDays
          ? root.HomeRoCalendar.nameDays(day.year, day.month, day.day)
          : [];
      }, []),
      own = eventsOn(settings.events, day.year, day.month, day.day);
    function line(label, text) {
      var p = el('div', 'cal-line');
      p.appendChild(el('span', 'cal-label', label));
      p.appendChild(el('span', 'cal-text', text));
      box.appendChild(p);
    }
    box.appendChild(
      el(
        'div',
        'cal-date',
        weekdayName(weekdayOf(day.year, day.month, day.day), false) +
          ', ' +
          day.day +
          ' ' +
          monthName(day.month) +
          ' ' +
          day.year
      )
    );
    if (holidays.length) line(t('Holiday'), holidays.join(', '));
    if (names.length) line(t('Name day'), names.join(', '));
    own.forEach(function (e) {
      line(t('Your event'), (e.time ? timeText(e.time) + ' ' : '') + e.title);
    });
    if (!holidays.length && !names.length && !own.length)
      box.appendChild(el('div', 'cal-none', t('Nothing planned')));
    return box;
  }
  function move(key, e) {
    var today = readToday();
    if (!today || !selected) return false;
    var start = calendar.get().weekStart === 'sun' ? 6 : 0,
      column =
        (weekdayOf(selected.year, selected.month, selected.day) - start + 7) %
        7;
    if (key === 37) {
      if (column === 0) return false;
      selected = shift(selected, -1);
    } else if (key === 39) {
      if (column === 6) return false;
      selected = shift(selected, 1);
    } else if (key === 38) {
      // First week row of the month: fall through, the panel moves focus to its top row (Back).
      if (shift(selected, -7).month !== selected.month) return false;
      selected = shift(selected, -7);
    }
    else if (key === 40) selected = shift(selected, 7);
    else if (key === 33 || key === 427) selected = shiftMonth(selected, -1);
    else if (key === 34 || key === 428) selected = shiftMonth(selected, 1);
    else return false;
    return true;
  }
  function onKey(e) {
    var key = e.keyCode;
    if ([33, 34, 37, 38, 39, 40, 427, 428].indexOf(key) < 0) return;
    var handled = false;
    try {
      handled = move(key, e);
      if (handled) render();
    } catch (_) {}
    if (handled) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }
  function onShow() {
    selected = readToday();
    render();
    if (!listening) {
      root.addEventListener('keydown', onKey, true);
      listening = true;
    }
  }
  function onHide() {
    if (listening) root.removeEventListener('keydown', onKey, true);
    listening = false;
  }

  // ---- settings tab ----
  function button(cls, text) {
    var b = el('button', cls, text);
    b.type = 'button';
    return b;
  }
  function buildTab(pane) {
    var form = { day: 1, month: 1, yearly: true, allDay: true, hour: 9, minute: 0 },
      status = el('div', 'cal-status'),
      list = el('div', 'cal-events'),
      count = el('div', 'cal-count'),
      dayValue = el('span', 'cal-value'),
      hourValue = el('span', 'cal-value'),
      minuteValue = el('span', 'cal-value'),
      allDay = button('cal-allday'),
      monthValue = el('span', 'cal-value'),
      yearly = button('cal-yearly'),
      input = el('input', 'cal-title-input'),
      add = button('cal-add', t('Add event')),
      mon = button('cal-start-mon', t('Monday')),
      sun = button('cal-start-sun', t('Sunday')),
      weeknum = button('cal-weeknum'),
      hourRow = null,
      minuteRow = null;
    pane.classList.add('cal-tab');
    // The date fields start on today's date, re-read while untouched (the TV can stay on for days).
    var touched = false;
    function syncToday() {
      var now = readToday();
      if (touched || !now) return;
      form.day = now.day;
      form.month = now.month;
      refreshForm();
    }
    pane.addEventListener('focusin', syncToday);
    function section(title) {
      var s = el('div', 'cal-section');
      s.appendChild(el('h3', 'cal-section-title', title));
      pane.appendChild(s);
      return s;
    }
    function toggle(b, on) {
      b.className =
        b.className.replace(/ ?selected/g, '') + (on ? ' selected' : '');
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    function refreshSettings() {
      var s = calendar.get();
      toggle(mon, s.weekStart === 'mon');
      toggle(sun, s.weekStart === 'sun');
      landing.textContent = s.landing ? t('On') : t('Off');
      toggle(landing, s.landing);
      weeknum.textContent = s.weekNumbers ? t('On') : t('Off');
      toggle(weeknum, s.weekNumbers);
    }
    function clampDay() {
      form.day = Math.min(Math.max(form.day, 1), DAYS[form.month - 1]);
    }
    function refreshForm() {
      clampDay();
      dayValue.textContent = String(form.day);
      monthValue.textContent = monthName(form.month);
      yearly.textContent = form.yearly ? t('Yes') : t('No');
      toggle(yearly, form.yearly);
      allDay.textContent = form.allDay ? t('On') : t('Off');
      toggle(allDay, form.allDay);
      hourValue.textContent = two(form.hour);
      minuteValue.textContent = two(form.minute);
      if (hourRow) hourRow.hidden = minuteRow.hidden = form.allDay;
    }
    function refreshList(focusIndex) {
      var events = calendar.get().events;
      list.innerHTML = '';
      count.textContent = events.length + ' / ' + MAX_EVENTS;
      events.forEach(function (e) {
        var item = el('div', 'cal-event'),
          del = button('cal-delete', t('Delete'));
        item.appendChild(
          el(
            'span',
            'cal-event-text',
            two(e.day) +
              '.' +
              two(e.month) +
              (!e.yearly && e.year ? '.' + e.year : '') +
              (e.time ? ' ' + timeText(e.time) : '') +
              '  ' +
              e.title
          )
        );
        del.setAttribute('aria-label', t('Delete') + ' ' + e.title);
        del.onclick = function () {
          calendar.set({
            events: calendar.get().events.filter(function (x) {
              return x.id !== e.id;
            })
          });
          status.textContent = '';
          refreshList(true);
        };
        item.appendChild(del);
        list.appendChild(item);
      });
      if (focusIndex) {
        var targets = list.querySelectorAll('button');
        (targets[0] || add).focus();
      }
    }
    // First control: show today's card on the main page.
    var s0 = section(t('Show on main page')),
      landing = button('cal-landing');
    landing.onclick = function () {
      calendar.set({ landing: !calendar.get().landing });
      refreshSettings();
    };
    s0.appendChild(landing);
    // Week start and numbers.
    var s1 = section(t('First day of week'));
    mon.onclick = function () {
      calendar.set({ weekStart: 'mon' });
      refreshSettings();
    };
    sun.onclick = function () {
      calendar.set({ weekStart: 'sun' });
      refreshSettings();
    };
    s1.appendChild(mon);
    s1.appendChild(sun);
    var s2 = section(t('Week numbers'));
    weeknum.onclick = function () {
      calendar.set({ weekNumbers: !calendar.get().weekNumbers });
      refreshSettings();
    };
    s2.appendChild(weeknum);
    // Own events.
    var s3 = section(t('Own events'));
    s3.appendChild(count);
    s3.appendChild(list);
    function stepper(label, value, onStep) {
      var row = el('div', 'cal-field'),
        down = button('cal-down', '-'),
        up = button('cal-' + label.toLowerCase() + '-up', '+');
      down.className += ' cal-' + label.toLowerCase() + '-down';
      down.setAttribute('aria-label', t(label) + ' -');
      up.className += ' cal-up';
      up.setAttribute('aria-label', t(label) + ' +');
      down.onclick = function () {
        touched = true;
        onStep(-1);
      };
      up.onclick = function () {
        touched = true;
        onStep(1);
      };
      row.appendChild(el('span', 'cal-field-label', t(label)));
      row.appendChild(down);
      row.appendChild(value);
      row.appendChild(up);
      s3.appendChild(row);
      return row;
    }
    stepper('Day', dayValue, function (step) {
      var max = DAYS[form.month - 1];
      form.day = ((form.day - 1 + step + max) % max) + 1;
      refreshForm();
    });
    stepper('Month', monthValue, function (step) {
      form.month = ((form.month - 1 + step + 12) % 12) + 1;
      refreshForm();
    });
    // All day (default ON) or a time: Hour 0-23 and Minute 0-55 in steps of 5, both wrapping.
    var allDayRow = el('div', 'cal-field');
    allDayRow.appendChild(el('span', 'cal-field-label', t('All day')));
    allDay.onclick = function () {
      form.allDay = !form.allDay;
      if (!form.allDay) {
        // Switched to a time: the next full hour from now.
        var n = safe(clock, null) || new Date();
        form.hour = (n.getHours() + 1) % 24;
        form.minute = 0;
      }
      refreshForm();
    };
    allDayRow.appendChild(allDay);
    s3.appendChild(allDayRow);
    hourRow = stepper('Hour', hourValue, function (step) {
      form.hour = (form.hour + step + 24) % 24;
      refreshForm();
    });
    minuteRow = stepper('Minute', minuteValue, function (step) {
      form.minute = (form.minute + step * 5 + 60) % 60;
      refreshForm();
    });
    var titleRow = el('div', 'cal-field');
    input.type = 'text';
    input.maxLength = MAX_TITLE;
    input.autocomplete = 'off';
    input.placeholder = t('Event title');
    input.setAttribute('aria-label', t('Event title'));
    titleRow.appendChild(el('span', 'cal-field-label', t('Title')));
    titleRow.appendChild(input);
    s3.appendChild(titleRow);
    var yearRow = el('div', 'cal-field');
    yearRow.appendChild(el('span', 'cal-field-label', t('Every year')));
    yearly.onclick = function () {
      form.yearly = !form.yearly;
      refreshForm();
    };
    yearRow.appendChild(yearly);
    s3.appendChild(yearRow);
    add.onclick = function () {
      var title = input.value.trim().slice(0, MAX_TITLE),
        events = calendar.get().events;
      if (!title) {
        status.textContent = t('Enter a title');
        return;
      }
      if (events.length >= MAX_EVENTS) {
        status.textContent = t('Event limit reached (50)');
        return;
      }
      var base = readToday(),
        item = {
          id:
            'e' +
            new Date().getTime().toString(36) +
            Math.floor(Math.random() * 1679616).toString(36),
          day: form.day,
          month: form.month,
          title: title,
          yearly: form.yearly
        };
      if (!form.allDay) item.time = two(form.hour) + ':' + two(form.minute);
      if (!form.yearly && base) {
        // One-off: next time this date comes round.
        var passed =
          form.month < base.month ||
          (form.month === base.month && form.day < base.day);
        item.year = base.year + (passed ? 1 : 0);
        // 29 February exists only in leap years: use the next one, so the event can ever show.
        while (form.month === 2 && form.day === 29 && daysIn(item.year, 2) < 29)
          item.year++;
      }
      calendar.set({ events: events.concat([item]) });
      input.value = '';
      status.textContent = t('Event added');
      refreshList(false);
    };
    s3.appendChild(add);
    s3.appendChild(status);
    refreshSettings();
    syncToday();
    refreshForm();
    refreshList(false);
  }

  // Main page (landing-widgets.js), stored data only, no request.
  // Month grid of the current month, no markings: { title, weekdays: [7 short names from the week start], rows:
  // [[0 | day]], today: day number }; 0 = a cell outside the month. null when the device date is unavailable.
  function landingMonth() {
    var today = readToday();
    if (!today || !calendar) return null;
    var weekStart = safe(calendar.get, { weekStart: 'mon' }).weekStart,
      start = weekStart === 'sun' ? 6 : 0,
      grid = monthGrid(today.year, today.month, weekStart),
      weekdays = [],
      i;
    for (i = 0; i < 7; i++) weekdays.push(weekdayName((start + i) % 7, true));
    var events = safe(calendar.get, { events: [] }).events,
      marked = [],
      day;
    // Days of this month with an own event (a one-off only in its own year): a dot under the number.
    for (day = 1; day <= daysIn(today.year, today.month); day++)
      if (eventsOn(events, today.year, today.month, day).length)
        marked.push(day);
    return {
      title: monthName(today.month) + ' ' + today.year,
      weekdays: weekdays,
      today: today.day,
      marked: marked,
      rows: grid.map(function (row) {
        return row.map(function (cell) {
          return cell.inMonth ? cell.day : 0;
        });
      })
    };
  }
  // Name day (the top row of the main page): never empty. Names celebrated today (when name days are marked) on line 1,
  // the holiday name under them (when holidays are marked); a day without names says "No name days today" and gives the
  // next name day "21 Nov: Mihail, Gavril". At most 2 lines; null only when the device date is unavailable.
  function landingNameDay() {
    var today = readToday();
    if (!today || !daily) return null;
    var marks = safe(daily.get, { showHolidays: true, showNameDays: true }),
      lines = [],
      cal = root.HomeRoCalendar,
      holidays = safe(function () {
        return marks.showHolidays
          ? cal.holidayNames(today.year, today.month, today.day)
          : [];
      }, []),
      names = safe(function () {
        return marks.showNameDays
          ? cal.nameDays(today.year, today.month, today.day)
          : [];
      }, []),
      next = null;
    if (names.length) {
      lines.push(names.join(', '));
      if (holidays.length) lines.push(holidays.join(', '));
    } else if (marks.showNameDays) {
      lines.push(t('No name days today'));
      next = safe(function () {
        return cal.nextNameDay(today.year, today.month, today.day);
      }, null);
      if (next)
        lines.push(next.day + ' ' + shortMonth(next.month) + ': ' + next.names.join(', '));
      else if (holidays.length) lines.push(holidays.join(', '));
    } else if (holidays.length) lines.push(holidays.join(', '));
    // Name days not marked and no holiday to show: nothing at all.
    return lines.length ? { title: t('Name day'), lines: lines.slice(0, 2) } : null;
  }

  // Short month name for the events line: English table, Romanian from the catalogue, others from the engine.
  var SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function shortMonth(month) {
    var key = SHORT_MONTHS[month - 1];
    if (!root.HomeI18n || /^en/.test(root.HomeI18n.language())) return key;
    var text = t(key + ' (month)');
    if (text !== key + ' (month)') return text;
    try {
      return root.HomeI18n.formatDate(new Date(2026, month - 1, 15), { month: 'short' }) || key;
    } catch (_) {
      return key;
    }
  }
  // Next own events from now, stored data only: today's all-day events, today's timed events not yet passed, then the
  // following days up to 12 months ahead (all-day first, then by time; yearly events recur). At most 2 lines
  // { text, when, time, title }: "Today 14:30 Title", "Tomorrow 09:00 Title", "Sat 21 Nov 18:00 Title" (Romanian:
  // "azi", "mâine", "sâm 21 nov"); all-day events carry no time.
  function landingEvents() {
    var now = safe(clock, null),
      today = readToday();
    if (!now || !today || !calendar) return [];
    var events = safe(calendar.get, { events: [] }).events,
      minutes = now.getHours() * 60 + now.getMinutes(),
      out = [],
      i,
      day,
      list;
    for (i = 0; i <= 366 && out.length < 2; i++) {
      day = i ? shift(today, i) : today;
      list = eventsOn(events, day.year, day.month, day.day);
      list.forEach(function (e) {
        if (out.length >= 2) return;
        // Today: a timed event is shown until its minute is over.
        if (i === 0 && e.time && parseInt(e.time.slice(0, 2), 10) * 60 + parseInt(e.time.slice(3, 5), 10) < minutes)
          return;
        var when =
          i === 0
            ? t('Today')
            : i === 1
              ? t('Tomorrow')
              : (function () {
                  var w = weekdayName(weekdayOf(day.year, day.month, day.day), true);
                  if (root.HomeI18n && !/^en/.test(root.HomeI18n.language())) w = w.toLowerCase();
                  return w + ' ' + day.day + ' ' + shortMonth(day.month);
                })();
        out.push({
          when: when,
          time: e.time ? timeText(e.time) : '',
          title: e.title,
          text: when + (e.time ? ' ' + timeText(e.time) : '') + ' ' + e.title
        });
      });
    }
    return out;
  }

  // Events card of the main page: never empty (a line says so when nothing is upcoming).
  function landingEventsCard() {
    if (!calendar) return null;
    var list = landingEvents();
    return {
      title: t('Events'),
      lines: list.length
        ? list.map(function (e) {
            return e.text;
          })
        : [t('No events upcoming')]
    };
  }

  root.HomeCalendar = {
    landingEventsCard: landingEventsCard,
    landingEvents: landingEvents,
    landingMonth: landingMonth,
    landingNameDay: landingNameDay,
    monthGrid: monthGrid,
    isoWeek: isoWeek,
    sanitizeEvents: sanitizeEvents,
    // Test seam: the device clock used for "today".
    setClock: function (fn) {
      clock =
        typeof fn === 'function'
          ? fn
          : function () {
              return new Date();
            };
    }
  };
  if (info && calendar) {
    if (info.registerTab)
      info.registerTab({
        id: 'calendar',
        order: 30,
        label: 'Calendar',
        build: buildTab
      });
    if (root.InfoPanel)
      root.InfoPanel.registerPage({
        id: 'calendar',
        label: 'Calendar',
        render: function (container) {
          host = container;
          host.classList.add('cal-page');
        },
        onShow: onShow,
        onHide: onHide
      });
  }
})(window);
