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
const pick = (r) => (r ? [r.year, r.month, r.day] : null);
assert.deepEqual(nd(2026, 11, 16), { year: 2026, month: 11, day: 17, names: ['Grigore', 'Grigorie', 'Ghenadie'] }, 'after Matei: the NEXT day, 17 Nov (today has names too)');
assert.deepEqual(nd(2026, 11, 7), { year: 2026, month: 11, day: 8, names: ['Mihail', 'Mihai', 'Mihaela', 'Gabriel', 'Gabriela'] }, 'tomorrow');
assert.deepEqual(pick(nd(2026, 11, 28)), [2026, 11, 29], 'month wrap inside the year');
assert.deepEqual(pick(nd(2026, 12, 31)), [2027, 1, 1], 'year wrap');
assert.deepEqual(pick(nd(2026, 1, 31)), [2026, 2, 1], 'month wrap');
// A run of days without names (leap year 2028: 25 Dec has none, 26 Dec has David): the search skips them.
assert.deepEqual(pick(nd(2026, 12, 24)), [2026, 12, 26], '25 Dec has no name: skipped');
assert.deepEqual(pick(nd(2026, 3, 8)), [2026, 3, 10], '9 Mar has no name: skipped');
// Movable: Florii (Palm Sunday, Easter 12 April 2026 -> 5 April) adds its names to the fixed ones of the day.
const fl = nd(2026, 4, 4);
assert.deepEqual([fl.month, fl.day], [4, 5]);
assert.ok(fl.names.indexOf('Florin') >= 0 && fl.names.indexOf('Viorica') >= 0 && fl.names.indexOf('Teodora') >= 0, 'fixed + movable: ' + fl.names);
assert.deepEqual(pick(nd(2026, 4, 5)), [2026, 4, 6]);
assert.deepEqual(pick(nd(2024, 4, 27)), [2024, 4, 28], '2024: Easter 5 May -> Florii 28 April');
assert.ok(nd(2024, 4, 27).names.indexOf('Florentina') >= 0);
assert.equal(nd(2099, 12, 31), null, 'out of the supported years: null, never throws');
assert.equal(nd(1899, 1, 1), null);
assert.equal(nd('x', 1, 1), null);
// Every day of 2026 finds a next one within a week and never returns the start day.
for (let m = 1; m <= 12; m++)
  for (let d = 1; d <= 28; d++) {
    const r = nd(2026, m, d),
      gap = (Date.UTC(r.year, r.month - 1, r.day) - Date.UTC(2026, m - 1, d)) / 86400000;
    assert.ok(r && r.names.length > 0 && gap >= 1 && gap <= 7, m + '-' + d + ' next in ' + gap + ' days');
  }

// ---- The complete table (366 days) ----
// Days of a leap year without a Romanian given name on purpose (feasts of the Lord, martyrs groups), with the reason.
const NO_NAME = {"01-03": "prophet Maleahi and Sf. Mc. Gordie: no established Romanian given name", "01-05": "Sf. Mc. Teopempt and Teonas, Sf. Sinclitichia: no established Romanian given name", "02-02": "Întâmpinarea Domnului (feast of the Lord): no saint with a given name", "03-06": "42 Martyrs of Amoreea: no established Romanian given name", "03-09": "40 Martyrs of Sevastia: no established Romanian given name", "03-24": "Sf. Ier. Artemon: no established Romanian given name", "03-25": "Buna Vestire (feast of the Lord/Theotokos): no saint with a given name", "05-31": "2026 source shows Pentecost (movable); the fixed saint of 31 May (Sf. Mc. Ermeu) has no Romanian given name", "06-13": "Sf. Mc. Achilina, Trifilie: no established Romanian given name", "07-10": "45 Martyrs of Nicopolis: no established Romanian given name", "08-01": "7 Maccabee brothers: no established Romanian given name", "08-04": "7 Youths of Ephesus, Sf. Mc. Tatuil: no established Romanian given name", "08-06": "Schimbarea la Față (feast of the Lord): no saint with a given name", "08-14": "prophet Miheia: no established Romanian given name", "08-22": "Sf. Mc. Agatonic: no established Romanian given name", "09-14": "Înălțarea Sfintei Cruci (feast of the Lord): no saint with a given name", "10-22": "Sf. Ier. Averchie, 7 Youths of Ephesus: no established Romanian given name", "11-02": "Sf. Mc. Achindin, Pigasie, Elpidifor, Anempodist: no established Romanian given name", "11-21": "Intrarea în biserică a Maicii Domnului: no saint with a given name", "12-25": "Nașterea Domnului (Crăciunul): no saint with a given name", "12-28": "20,000 Martyrs of Nicomedia: no established Romanian given name"};
// The 44 days of the dataset (CC BY 4.0): their names must stay exactly.
const DATASET = {"01-01": ["Vasile", "Vasilica"], "01-07": ["Ioan", "Ion", "Ioana", "Ionela", "Ionuț", "Oana"], "01-12": ["Tatiana"], "01-17": ["Anton", "Antonia", "Antonie"], "01-18": ["Atanasie"], "01-21": ["Maxim"], "01-25": ["Grigore"], "02-01": ["Trifon"], "02-03": ["Simion"], "02-10": ["Haralambie"], "02-17": ["Teodor", "Teodora"], "04-23": ["Gheorghe", "George", "Georgeta", "Georgiana"], "04-25": ["Marcu"], "05-05": ["Irina"], "05-21": ["Constantin", "Elena"], "06-24": ["Sânziana"], "06-29": ["Petru", "Petre", "Pavel"], "07-20": ["Ilie", "Ilinca"], "07-22": ["Magdalena", "Mădălina"], "07-24": ["Cristina"], "07-25": ["Ana", "Anca"], "07-27": ["Pantelimon"], "08-15": ["Maria", "Marian", "Mariana", "Marinela"], "08-26": ["Adrian", "Adriana"], "08-30": ["Alexandru", "Alexandra"], "09-17": ["Sofia"], "10-03": ["Denisa"], "10-14": ["Parascheva", "Paraschiva"], "10-26": ["Dumitru"], "11-08": ["Mihail", "Mihai", "Mihaela", "Gabriel", "Gabriela"], "11-11": ["Victor"], "11-14": ["Filip"], "11-16": ["Matei"], "11-25": ["Ecaterina", "Cătălina", "Cătălin"], "11-30": ["Andrei", "Andreea"], "12-04": ["Varvara"], "12-05": ["Sava"], "12-06": ["Nicolae", "Nicoleta", "Niculina"], "12-12": ["Spiridon"], "12-17": ["Daniel", "Daniela"], "12-20": ["Ignat"], "12-26": ["David"], "12-27": ["Ștefan", "Ștefania"]};
const allDays = [];
for (let m = 1; m <= 12; m++) for (let d = 1; d <= new Date(Date.UTC(2028, m, 0)).getUTCDate(); d++) allDays.push([m, d]);
assert.equal(allDays.length, 366);
const mmdd = (m, d) => String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
let filled = 0;
allDays.forEach(([m, d]) => {
  const key = mmdd(m, d),
    names = C.nameDays(2028, m, d), // 2028: Florii of 2028 (Easter 16 Apr -> 9 Apr) is the only movable day
    fixed = names.filter((n) => ['Florin', 'Florina', 'Floriana', 'Florentina', 'Florica', 'Viorel', 'Viorica'].indexOf(n) < 0 || key !== '04-09');
  if (NO_NAME[key]) {
    assert.deepEqual(fixed.length ? fixed : [], [], key + ' is on the explicit no-name list: ' + NO_NAME[key]);
    assert.ok(NO_NAME[key].length > 10, key + ' needs a reason');
    return;
  }
  filled++;
  assert.ok(names.length >= 1, key + ' has at least one name');
  assert.equal(new Set(names).size, names.length, key + ' has duplicates: ' + names);
  names.forEach((n) => {
    assert.equal(typeof n, 'string');
    assert.equal(n, n.trim(), key + ': "' + n + '" is not trimmed');
    assert.ok(n.length >= 2, key + ': empty/short name');
    assert.ok(!/[şţŞŢ]/.test(n), key + ': "' + n + '" uses cedilla ş/ţ (must be comma-below ș/ț)');
    assert.ok(/^[A-ZĂÂÎȘȚ][a-zăâîșț-]+$/.test(n), key + ': "' + n + '" is not a plain Romanian name');
    assert.ok(!/[sStT]/.test('') , '');
  });
});
assert.equal(filled + Object.keys(NO_NAME).length, 366, 'every day is filled or explained');
assert.ok(filled >= 340, 'filled days: ' + filled);
// No ASCII-only substitutes for names that need ș/ț/ă/â/î (a sample of the usual suspects).
const all = new Set();
allDays.forEach(([m, d]) => C.nameDays(2028, m, d).forEach((n) => all.add(n)));
['Ștefan', 'Ștefania', 'Ionuț', 'Mădălina', 'Sânziana', 'Cătălin', 'Cătălina', 'Constanța', 'Eustațiu', 'Lazăr'].forEach((n) => assert.ok(all.has(n), n + ' present'));
['Stefan', 'Stefania', 'Ionut', 'Madalina', 'Sanziana', 'Catalin', 'Catalina', 'Constanta', 'Eustatiu', 'Lazar'].forEach((n) => assert.ok(!all.has(n), 'ASCII substitute ' + n));
// The dataset days keep exactly their names.
Object.keys(DATASET).forEach((key) => {
  const [m, d] = key.split('-').map(Number);
  assert.deepEqual(C.nameDays(2028, m, d).filter((n) => DATASET[key].indexOf(n) >= 0), DATASET[key], key + ' keeps its names');
  assert.deepEqual(C.nameDays(2028, m, d).slice(0, DATASET[key].length), DATASET[key], key + ' unchanged and in order');
});
// Spot checks: the day of the report (17 Nov), a leap day, a holiday with names (1 Dec), a day that is a holiday only.
assert.deepEqual(C.nameDays(2026, 11, 17), ['Grigore', 'Grigorie', 'Ghenadie']);
assert.deepEqual(C.nameDays(2028, 2, 29), ['Casian']);
assert.deepEqual(C.nameDays(2026, 12, 1), ['Anastasia']);
assert.deepEqual(C.holidayNames(2026, 12, 1), ['Ziua Națională a României']);
assert.deepEqual(C.nameDays(2026, 12, 25), [], 'Crăciunul: no name');
assert.deepEqual(C.nameDays(2026, 1, 6), ['Iordan', 'Iordana']);
// Movable names are computed, not duplicated in the fixed table: only the Florii day carries them.
let florii = 0;
allDays.forEach(([m, d]) => {
  if (C.nameDays(2026, m, d).indexOf('Viorica') >= 0) florii++;
});
assert.equal(florii, 1, 'Viorica only on Florii of 2026 (5 April)');
assert.equal(C.nameDays(2026, 4, 5).indexOf('Viorica') >= 0, true);
assert.equal(C.nameDays(2027, 4, 5).indexOf('Viorica') >= 0, false, '2027: Florii on 25 April');
assert.equal(C.nameDays(2027, 4, 25).indexOf('Viorica') >= 0, true);
// Size: the file stays compact for the TV.
assert.ok(require('node:fs').statSync('launcher/ro-calendar-data.js').size < 40000, 'compact data file');
console.log('PASS ro-calendar');
