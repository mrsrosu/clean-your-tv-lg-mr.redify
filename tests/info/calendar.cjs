const strict = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm');
const assert = Object.assign((v, m) => strict(v, m), strict, {
  deepEqual: (a, b) => strict.deepEqual(JSON.parse(JSON.stringify(a)), b)
});
// info-store.js + calendar-page.js in a bare context (no DOM): stores and monthGrid are pure.
function context(storage) {
  const surface = { classList: { contains: () => false } },
    document = {
      getElementById: () => surface,
      addEventListener() {},
      readyState: 'complete'
    },
    ctx = { document, localStorage: storage };
  ctx.window = ctx;
  vm.runInNewContext(fs.readFileSync('launcher/info-store.js', 'utf8'), ctx);
  vm.runInNewContext(fs.readFileSync('launcher/ro-calendar-data.js', 'utf8'), ctx);
  vm.runInNewContext(fs.readFileSync('launcher/calendar-page.js', 'utf8'), ctx);
  return ctx;
}
function memory(seed) {
  const data = Object.assign({}, seed);
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem(k, v) {
      data[k] = String(v);
    }
  };
}
function test(name, fn) {
  fn();
  console.log('ok - ' + name);
}
const ev = (n, over) =>
  Object.assign(
    { id: 'e' + n, day: 5, month: 3, title: 'T' + n, yearly: true },
    over
  );

test('monthGrid(2026, 11, mon): first cell Mon 26 Oct, rows of 7, at most 6 rows', () => {
  const g = context(memory()).HomeCalendar.monthGrid(2026, 11, 'mon');
  assert.ok(g.length <= 6 && g.length >= 4);
  g.forEach((r) => assert.equal(r.length, 7));
  assert.deepEqual(g[0][0], { year: 2026, month: 10, day: 26, inMonth: false });
  assert.deepEqual(g[0][6], { year: 2026, month: 11, day: 1, inMonth: true });
  const last = g[g.length - 1][6];
  assert.ok(last.month === 12 || (last.month === 11 && last.day === 30));
});
test('monthGrid sunday start and february edge cases', () => {
  const C = context(memory()).HomeCalendar,
    sun = C.monthGrid(2026, 11, 'sun');
  assert.deepEqual(sun[0][0], { year: 2026, month: 11, day: 1, inMonth: true });
  // Feb 2026 starts on Sunday, 28 days: 4 rows with Sunday start.
  assert.equal(C.monthGrid(2026, 2, 'sun').length, 4);
  // Year boundary: Dec 2026 grid ends in Jan 2027.
  const dec = C.monthGrid(2026, 12, 'mon'),
    end = dec[dec.length - 1][6];
  assert.ok(end.year === 2027 || (end.year === 2026 && end.month === 12));
  assert.deepEqual(
    C.monthGrid(2024, 2, 'mon')
      .flat()
      .filter((c) => c.inMonth).length,
    29
  );
});
test('daily store defaults and sanitize (landing = Name day card, boolean only, default false)', () => {
  const mem = memory(),
    d = context(mem).HomeInfo.daily;
  assert.deepEqual(d.get(), {
    showHolidays: true,
    showNameDays: true,
    landing: false
  });
  assert.deepEqual(d.set({ showHolidays: false, showNameDays: 'x' }), {
    showHolidays: false,
    showNameDays: true,
    landing: false
  });
  assert.equal(d.set({ landing: true }).landing, true);
  assert.equal(d.set({ landing: 'yes' }).landing, false);
  assert.equal(d.set({ landing: 1 }).landing, false);
  mem.data['tvhome.daily.v1'] = '{"landing":"x","showHolidays":false}';
  assert.deepEqual(d.get(), { showHolidays: false, showNameDays: true, landing: false });
  assert.ok('tvhome.daily.v1' in mem.data);
});
test('calendar store defaults', () => {
  const mem = memory(),
    c = context(mem).HomeInfo.calendar;
  assert.deepEqual(c.get(), {
    weekStart: 'mon',
    weekNumbers: false,
    events: [],
    landing: false
  });
  assert.deepEqual(
    c.set({ weekStart: 'sun', weekNumbers: true }).weekStart,
    'sun'
  );
  assert.equal(c.set({ weekStart: 'wed' }).weekStart, 'sun');
  assert.ok('tvhome.calendar.v1' in mem.data);
});
test('sanitize: 60 events -> 50', () => {
  const list = [];
  for (let i = 0; i < 60; i++) list.push(ev(i));
  const c = context(memory()).HomeInfo.calendar;
  assert.equal(c.set({ events: list }).events.length, 50);
  const mem = memory({
    'tvhome.calendar.v1': JSON.stringify({ events: list })
  });
  assert.equal(context(mem).HomeInfo.calendar.get().events.length, 50);
});
test('sanitize drops invalid items, keeps valid ones, trims title', () => {
  const c = context(memory()).HomeInfo.calendar,
    out = c.set({
      events: [
        ev(1, { month: 13 }),
        ev(2, { month: 0 }),
        ev(3, { day: 31, month: 4 }),
        ev(4, { day: 30, month: 2 }),
        ev(5, { day: 29, month: 2 }),
        ev(6, { title: '   ' }),
        ev(7, { title: 5 }),
        ev(8, { id: '' }),
        ev(9, { id: 7 }),
        ev(10, { day: 1.5 }),
        ev(11, { title: '  Ana  ' }),
        ev(12, { yearly: 'yes' }),
        null,
        'x',
        ev(13, { title: 'x'.repeat(200) })
      ]
    }).events;
  assert.deepEqual(
    out.map((e) => e.id),
    ['e5', 'e11', 'e13']
  );
  assert.equal(out[1].title, 'Ana');
  assert.equal(out[2].title.length, 60);
  assert.equal(out[0].yearly, true);
});
test('sanitize: events not an array -> [] (also from corrupt storage)', () => {
  const c = context(memory()).HomeInfo.calendar;
  assert.deepEqual(c.set({ events: 'nope' }).events, []);
  assert.deepEqual(c.set({ events: { a: 1 } }).events, []);
  const mem = memory({
    'tvhome.calendar.v1': JSON.stringify({ weekStart: 'sun', events: 'bad' })
  });
  assert.deepEqual(context(mem).HomeInfo.calendar.get(), {
    weekStart: 'sun',
    weekNumbers: false,
    events: [],
    landing: false
  });
  const junk = memory({ 'tvhome.calendar.v1': '{broken' });
  assert.deepEqual(context(junk).HomeInfo.calendar.get(), {
    weekStart: 'mon',
    weekNumbers: false,
    events: [],
    landing: false
  });
});
const cev = (id, day, month, title, extra) => Object.assign({ id, day, month, title, yearly: true }, extra);
test('sanitize: optional time HH:MM (24 h); an invalid time drops the time, not the event; old events unchanged', () => {
  const C = context(memory()).HomeCalendar,
    list = C.sanitizeEvents([
      cev('a', 1, 2, 'A'),
      cev('b', 1, 2, 'B', { time: '14:30' }),
      cev('c', 1, 2, 'C', { time: '24:00' }),
      cev('d', 1, 2, 'D', { time: '9:05' }),
      cev('e', 1, 2, 'E', { time: '12:60' }),
      cev('f', 1, 2, 'F', { time: 1430 }),
      cev('g', 1, 2, 'G', { time: '00:00' }),
      cev('h', 1, 2, 'H', { time: '23:59' }),
      cev('i', 1, 2, 'I', { time: '' })
    ]);
  assert.equal(list.length, 9, 'no event is lost');
  assert.deepEqual(list.map((x) => x.time || null), [null, '14:30', null, null, null, null, '00:00', '23:59', null]);
  assert.equal('time' in list[0], false, 'an old event has no time key');
  assert.deepEqual(list[0], { id: 'a', day: 1, month: 2, title: 'A', yearly: true });
  assert.equal(C.sanitizeEvents(Array.from({ length: 60 }, (_, i) => cev('x' + i, 1, 2, 'T', { time: '10:00' }))).length, 50);
});
test('stored events with and without time load unchanged; corrupt time values are safe', () => {
  const mem = memory({
    'tvhome.calendar.v1': JSON.stringify({ events: [cev('a', 3, 4, 'Old'), cev('b', 3, 4, 'New', { time: '08:15' }), cev('c', 3, 4, 'Bad', { time: { x: 1 } })] })
  });
  const got = context(mem).HomeInfo.calendar.get().events;
  assert.deepEqual(got.map((x) => [x.id, x.time || null]), [['a', null], ['b', '08:15'], ['c', null]]);
});
function landing(events, now) {
  const mem = memory(),
    ctx = context(mem);
  ctx.HomeCalendar.setClock(() => now);
  ctx.HomeInfo.calendar.set({ events });
  return ctx.HomeCalendar;
}
test('landingMonth.marked: days of the current month with an own event (yearly and one-off), other months excluded', () => {
  const now = new Date(2026, 10, 16, 12, 0),
    C = landing(
      [
        cev('a', 20, 11, 'Yearly'),
        cev('b', 5, 11, 'One-off', { yearly: false, year: 2026 }),
        cev('c', 7, 11, 'Other year', { yearly: false, year: 2025 }),
        cev('d', 9, 12, 'December'),
        cev('e', 20, 11, 'Same day twice', { time: '10:00' }),
        cev('f', 30, 11, 'Last day')
      ],
      now
    ),
    m = C.landingMonth();
  assert.deepEqual(m.marked, [5, 20, 30]);
  assert.equal(m.today, 16);
  assert.deepEqual(landing([], now).landingMonth().marked, []);
});
const one = (id, day, month, title, extra) => cev(id, day, month, title, Object.assign({ yearly: false, year: 2026 }, extra));
test('landingEvents: today all-day, today not passed, tomorrow, later days up to 12 months; max 2 lines; empty', () => {
  const noon = new Date(2026, 10, 16, 12, 30), // Monday
    L = (events, now) => landing(events, now || noon).landingEvents().map((x) => x.text);
  assert.deepEqual(L([]), []);
  assert.deepEqual(L([cev('a', 16, 11, 'Passed', { time: '09:00' })]), ['Tue 16 Nov 09:00 Passed'], 'passed today: a yearly event recurs next year');
  assert.deepEqual(L([one('a', 16, 11, 'Passed', { time: '09:00' })]), [], 'a passed one-off is gone');
  assert.deepEqual(L([one('a', 16, 11, 'Soon', { time: '12:30' })]), ['Today 12:30 Soon'], 'the current minute is not passed');
  assert.deepEqual(L([one('a', 16, 11, 'Later', { time: '18:00' })]), ['Today 18:00 Later']);
  assert.deepEqual(L([one('a', 16, 11, 'Whole day')]), ['Today Whole day'], 'all-day: no time');
  assert.deepEqual(L([one('a', 17, 11, 'Dentist', { time: '09:00' })]), ['Tomorrow 09:00 Dentist']);
  assert.deepEqual(L([one('a', 21, 11, 'Match', { time: '18:00' })]), ['Sat 21 Nov 18:00 Match']);
  assert.deepEqual(L([one('a', 23, 11, 'Edge')]), ['Mon 23 Nov Edge'], 'day +7');
  assert.deepEqual(L([one('a', 24, 11, 'Later')]), ['Tue 24 Nov Later'], 'day +8: inside the 12 months');
  assert.deepEqual(L([one('a', 24, 11, 'Beyond', { year: 2028 })]), [], 'a one-off more than 12 months away');
  assert.deepEqual(L([cev('a', 15, 11, 'Almost a year', { time: '10:00' })]), ['Mon 15 Nov 10:00 Almost a year'], 'day +364 (2027): yearly recurs');
  assert.deepEqual(L([one('a', 16, 11, 'Past', { year: 2025 })]), [], 'one-off of another year');
  // Order: today all-day, today timed by time, then the following days; at most two lines.
  const many = L([
    one('1', 17, 11, 'Tomorrow all day'),
    one('2', 16, 11, 'Timed', { time: '20:00' }),
    one('3', 16, 11, 'All day'),
    one('4', 16, 11, 'Earlier timed', { time: '15:00' })
  ]);
  assert.deepEqual(many, ['Today All day', 'Today 15:00 Earlier timed']);
  assert.deepEqual(L([one('1', 18, 11, 'B'), one('2', 17, 11, 'A', { time: '10:00' }), one('3', 17, 11, 'A0')]), ['Tomorrow A0', 'Tomorrow 10:00 A']);
  // Once the minute is over the event disappears.
  const C = landing([one('a', 16, 11, 'Soon', { time: '12:30' })], noon);
  assert.equal(C.landingEvents().length, 1);
  C.setClock(() => new Date(2026, 10, 16, 12, 31));
  assert.equal(C.landingEvents().length, 0);
  // Year boundary: 29 December looks 7 days ahead into January.
  assert.deepEqual(L([one('a', 3, 1, 'New year', { year: 2027 })], new Date(2026, 11, 29, 8, 0)), ['Sun 3 Jan New year']);
});
test('landingEventsCard: never empty; "No events upcoming" when nothing is coming; otherwise the next 2 lines', () => {
  const now = new Date(2026, 10, 16, 12, 30),
    C0 = landing([], now);
  assert.deepEqual(C0.landingEventsCard(), { title: 'Events', lines: ['No events upcoming'] });
  const C1 = landing([one('a', 17, 11, 'Dentist', { time: '09:00' }), one('b', 18, 11, 'Second'), one('c', 19, 11, 'Third')], now);
  assert.deepEqual(C1.landingEventsCard().lines, ['Tomorrow 09:00 Dentist', 'Wed 18 Nov Second']);
  assert.deepEqual(C1.landingEvents().length, 2);
});
function nameDay(now, marks) {
  const ctx = context(memory());
  ctx.HomeCalendar.setClock(() => now);
  if (marks) ctx.HomeInfo.daily.set(marks);
  return ctx.HomeCalendar.landingNameDay();
}
test('landingNameDay: never empty: names; names + holiday; no names -> "No name days today" + the next one', () => {
  const L = (y, m, d, marks) => nameDay(new Date(y, m - 1, d, 12), marks).lines;
  assert.deepEqual(nameDay(new Date(2026, 10, 16, 12)), { title: 'Name day', lines: ['Matei'] });
  // 17 November (Sf. Grigorie Taumaturgul) now has its names.
  assert.deepEqual(L(2026, 11, 17), ['Grigore, Grigorie, Ghenadie']);
  assert.deepEqual(L(2026, 11, 25), ['Ecaterina, Cătălina, Cătălin']);
  // 30 November: names and the holiday (St Andrew); 1 December: the name and the National Day.
  const hol = L(2026, 11, 30);
  assert.equal(hol.length, 2);
  assert.match(hol[0], /Andrei, Andreea/);
  assert.match(hol[1], /Andrei/);
  assert.deepEqual(L(2026, 12, 1), ['Anastasia', 'Ziua Națională a României']);
  // Days that stay without names: "No name days today" and the next one (also over the year end and a month end).
  assert.deepEqual(L(2026, 12, 25), ['No name days today', '26 Dec: David'], 'Christmas: no name, next 26 Dec');
  assert.deepEqual(L(2026, 3, 9), ['No name days today', '10 Mar: Codrat, Ciprian, Dionisie, Cipriana']);
  assert.deepEqual(L(2026, 12, 28), ['No name days today', '29 Dec: Marcel, Tadeu']);
  assert.equal(nameDay(new Date(2026, 11, 31, 12)).lines[0], 'Melania, Romana', '31 Dec has names');
  // The next-name-day line wraps over the year end and a month end for a day without names (leap year 2028).
  assert.deepEqual(L(2028, 3, 9), ['No name days today', '10 Mar: Codrat, Ciprian, Dionisie, Cipriana']);
  // Movable: Florii (5 April 2026) adds its names to the fixed saint of the day; the day before points to it.
  assert.equal(L(2026, 4, 5)[0], 'Teodora, Florin, Florina, Floriana, Florentina, Florica, Viorel, Viorica', 'movable + fixed');
  assert.equal(nameDay(new Date(2026, 3, 4, 12)).lines.length, 1, '4 April has names itself');
  // 29 February.
  assert.deepEqual(L(2028, 2, 29), ['Casian']);
});
test('landingNameDay: the Rates & holidays switches still apply', () => {
  const day = new Date(2026, 10, 30, 12);
  assert.deepEqual(nameDay(day, { showHolidays: false }).lines, ['Andrei, Andreea'], 'holidays off: no holiday line');
  assert.deepEqual(nameDay(new Date(2026, 11, 1, 12), { showHolidays: false }).lines, ['Anastasia']);
  assert.deepEqual(nameDay(day, { showNameDays: false }).lines.length, 1, 'name days off: the holiday only');
  assert.match(nameDay(day, { showNameDays: false }).lines[0], /Andrei/);
  assert.equal(nameDay(new Date(2026, 10, 17, 12), { showNameDays: false }), null, 'nothing to show: no element');
  assert.equal(nameDay(new Date(2026, 10, 17, 12), { showNameDays: false, showHolidays: false }), null);
  assert.deepEqual(nameDay(new Date(2026, 11, 25, 12), { showNameDays: false }).lines.length, 1, 'holiday only');
});
test('isoWeek', () => {
  const C = context(memory()).HomeCalendar;
  assert.equal(C.isoWeek(2026, 1, 1), 1);
  assert.equal(C.isoWeek(2026, 11, 16), 47);
  assert.equal(C.isoWeek(2021, 1, 3), 53);
  assert.equal(C.isoWeek(2024, 12, 30), 1);
});
