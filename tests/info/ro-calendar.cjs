const assert = require('node:assert/strict'),
  C = require('../../launcher/ro-calendar-data.js');

// 1. Orthodox Easter (Julian computus + 13 days, 1900-2099).
[
  [2024, 5, 5],
  [2025, 4, 20],
  [2026, 4, 12],
  [2027, 5, 2]
].forEach(([y, m, d]) =>
  assert.deepEqual(C.orthodoxEaster(y), { month: m, day: d }, 'Easter ' + y)
);
[1899, 2100, 2026.5, NaN, '2026', null, undefined].forEach((y) => {
  assert.equal(C.orthodoxEaster(y), null, 'out of range: ' + y);
  assert.deepEqual(C.holidays(y), []);
  assert.deepEqual(C.nameDays(y, 1, 1), []);
});

// 2. Legal holidays 2026.
const has = (list, m, d, text) =>
  list.some((h) => h.month === m && h.day === d && h.name.indexOf(text) >= 0);
const h26 = C.holidays(2026);
assert(has(h26, 4, 10, 'Vinerea Mare'));
assert(has(h26, 4, 12, 'Paște') && has(h26, 4, 13, 'Paște'));
assert(has(h26, 5, 31, 'Rusalii') && has(h26, 6, 1, 'Rusalii'));
assert(has(h26, 1, 6, 'Bobotează') && has(h26, 1, 7, 'Ioan'));
assert(has(h26, 1, 24, 'Unirii'));
assert(has(h26, 11, 30, 'Andrei') && has(h26, 12, 1, 'Națională'));
assert(has(h26, 12, 25, 'Crăciun') && has(h26, 12, 26, 'Crăciun'));
assert(has(h26, 8, 15, 'Adormirea'));
assert(!h26.some((h) => h.month === 10 && h.day === 25), '25 Oct is not a day off');
assert.equal(h26.length, 17);
for (let i = 1; i < h26.length; i++)
  assert(
    h26[i - 1].month * 100 + h26[i - 1].day <= h26[i].month * 100 + h26[i].day,
    'sorted'
  );
const june1 = C.holidayNames(2026, 6, 1);
assert(june1.some((n) => n.indexOf('Rusalii') >= 0));
assert(june1.some((n) => n.indexOf('Copilului') >= 0));
assert.deepEqual(C.holidayNames(2026, 3, 3), []);

// 3. Name days: fixed table plus Easter-relative.
assert(C.nameDays(2026, 5, 21).indexOf('Constantin') >= 0);
assert(C.nameDays(2026, 5, 21).indexOf('Elena') >= 0);
assert(C.nameDays(2026, 4, 23).indexOf('Gheorghe') >= 0);
assert(C.nameDays(2026, 4, 5).indexOf('Florin') >= 0, 'Florii 2026');
assert(C.nameDays(2026, 3, 29).indexOf('Florin') < 0);
assert(C.nameDays(2027, 4, 25).indexOf('Florin') >= 0, 'Florii 2027');
assert(Array.isArray(C.nameDays(2026, 4, 12)));

// 4. Every day of a leap year returns arrays, never throws.
const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
days.forEach((n, i) => {
  for (let d = 1; d <= n; d++) {
    assert(Array.isArray(C.nameDays(2024, i + 1, d)));
    assert(Array.isArray(C.holidayNames(2024, i + 1, d)));
  }
});
assert(Array.isArray(C.nameDays(2026, 13, 40)));

// nextNameDay: the next day (day by day, up to 366 days) that has name days, movable ones included.
const nd = (y, m, d) => C.nextNameDay(y, m, d);
assert.deepEqual(nd(2026, 11, 16), { year: 2026, month: 11, day: 25, names: ['Ecaterina', 'Cătălina', 'Cătălin'] }, 'after Matei (today has names: still the NEXT day)');
assert.deepEqual(nd(2026, 11, 7), { year: 2026, month: 11, day: 8, names: ['Mihail', 'Mihai', 'Mihaela', 'Gabriel', 'Gabriela'] }, 'tomorrow');
assert.equal(nd(2026, 11, 28).day, 30, 'month wrap inside the year');
assert.deepEqual([nd(2026, 12, 27).year, nd(2026, 12, 27).month, nd(2026, 12, 27).day], [2027, 1, 1], 'year wrap');
assert.deepEqual([nd(2026, 12, 31).year, nd(2026, 12, 31).month, nd(2026, 12, 31).day], [2027, 1, 1]);
assert.deepEqual([nd(2026, 1, 31).month, nd(2026, 1, 31).day], [2, 1], 'month wrap');
// Movable: Florii (Palm Sunday, Easter 12 April 2026 -> 5 April) comes before 23 April.
const fl = nd(2026, 4, 4);
assert.deepEqual([fl.month, fl.day], [4, 5]);
assert.ok(fl.names.indexOf('Florin') >= 0 && fl.names.indexOf('Viorica') >= 0);
assert.deepEqual([nd(2026, 4, 5).month, nd(2026, 4, 5).day], [4, 23], 'after Florii the fixed one');
assert.deepEqual([nd(2024, 4, 27).month, nd(2024, 4, 27).day], [4, 28], '2024: Easter 5 May -> Florii 28 April');
assert.equal(nd(2099, 12, 31), null, 'out of the supported years: null, never throws');
assert.equal(nd(1899, 1, 1), null);
assert.equal(nd('x', 1, 1), null);
// Every date of 2026 finds one within a year and never returns the start day.
for (let m = 1; m <= 12; m++) {
  const r = nd(2026, m, 15);
  assert.ok(r && r.names.length > 0 && (r.year > 2026 || r.month > m || (r.month === m && r.day > 15)), 'month ' + m);
}
console.log('PASS ro-calendar');
