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
test('daily store defaults and sanitize', () => {
  const mem = memory(),
    d = context(mem).HomeInfo.daily;
  assert.deepEqual(d.get(), { showHolidays: true, showNameDays: true });
  assert.deepEqual(d.set({ showHolidays: false, showNameDays: 'x' }), {
    showHolidays: false,
    showNameDays: true
  });
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
test('isoWeek', () => {
  const C = context(memory()).HomeCalendar;
  assert.equal(C.isoWeek(2026, 1, 1), 1);
  assert.equal(C.isoWeek(2026, 11, 16), 47);
  assert.equal(C.isoWeek(2021, 1, 3), 53);
  assert.equal(C.isoWeek(2024, 12, 30), 1);
});
