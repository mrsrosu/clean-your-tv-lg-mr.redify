/* Romanian calendar data: Orthodox Easter, legal days off, name days. Pure, offline, no DOM.
 *
 * Legal holidays: Codul muncii (Legea 53/2003) art. 139 alin. (1), current text checked 16 Nov 2026 at
 *   https://www.rubinian.com/codul-muncii-titlul-3-capitolul-2-sectiunea-3-articolul-139
 *   (amendments there: Legea 64/2018 Vinerea Mare, Legea 220/2016 1 iunie, Legea 52/2023 6-7 ianuarie).
 *   25 Oct (Armed Forces Day) is NOT in art. 139 and is not a day off. The two days per non-Christian
 *   religion in art. 139 depend on the person and are not listed. Holidays on weekends are not moved.
 * Name days: Romanian Orthodox calendar (https://calendar.patriarhia.ro), through the CC BY 4.0 dataset
 *   "Romanian Name Days and Holidays" by trends.ro (https://huggingface.co/datasets/radool/romanian-name-days),
 *   checked 16 Nov 2026. Only attributions marked established were kept; weak ones were left out
 *   (Radu, Simona, Emil, Cristian). Name-to-saint links are a popular convention, not church doctrine.
 * Easter: Julian computus + 13 days, valid 1900-2099 only; elsewhere functions return null / [].
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HomeRoCalendar = factory();
})(this, function () {
  'use strict';
  var DAY = 86400000;

  function validYear(year) {
    return typeof year === 'number' && year % 1 === 0 && year >= 1900 && year <= 2099;
  }

  function orthodoxEaster(year) {
    if (!validYear(year)) return null;
    var d = (19 * (year % 19) + 15) % 30,
      e = (2 * (year % 4) + 4 * (year % 7) - d + 34) % 7,
      total = d + e + 114,
      date = new Date(Date.UTC(year, Math.floor(total / 31) - 1, (total % 31) + 1 + 13));
    return { month: date.getUTCMonth() + 1, day: date.getUTCDate() };
  }

  // Easter plus offset days, as { month, day }.
  function shifted(year, offset) {
    var easter = orthodoxEaster(year),
      date = new Date(Date.UTC(year, easter.month - 1, easter.day) + offset * DAY);
    return { month: date.getUTCMonth() + 1, day: date.getUTCDate() };
  }

  var FIXED_HOLIDAYS = [
    [1, 1, 'Anul Nou'],
    [1, 2, 'Anul Nou'],
    [1, 6, 'Botezul Domnului - Bobotează'],
    [1, 7, 'Soborul Sfântului Ioan Botezătorul'],
    [1, 24, 'Ziua Unirii Principatelor Române'],
    [5, 1, 'Ziua Muncii'],
    [6, 1, 'Ziua Copilului'],
    [8, 15, 'Adormirea Maicii Domnului'],
    [11, 30, 'Sfântul Apostol Andrei'],
    [12, 1, 'Ziua Națională a României'],
    [12, 25, 'Crăciunul (prima zi)'],
    [12, 26, 'Crăciunul (a doua zi)']
  ];
  var MOVABLE_HOLIDAYS = [
    [-2, 'Vinerea Mare'],
    [0, 'Paștele (prima zi)'],
    [1, 'Paștele (a doua zi)'],
    [49, 'Rusalii (prima zi)'],
    [50, 'Rusalii (a doua zi)']
  ];

  function holidays(year) {
    if (!validYear(year)) return [];
    var list = FIXED_HOLIDAYS.map(function (h, i) {
      return { month: h[0], day: h[1], name: h[2], order: i };
    });
    MOVABLE_HOLIDAYS.forEach(function (h, i) {
      var date = shifted(year, h[0]);
      list.push({ month: date.month, day: date.day, name: h[1], order: 100 + i });
    });
    list.sort(function (a, b) {
      return a.month * 100 + a.day - (b.month * 100 + b.day) || a.order - b.order;
    });
    return list.map(function (h) {
      return { month: h.month, day: h.day, name: h.name };
    });
  }

  function holidayNames(year, month, day) {
    return holidays(year)
      .filter(function (h) {
        return h.month === month && h.day === day;
      })
      .map(function (h) {
        return h.name;
      });
  }

  // Keyed MM-DD.
  var NAME_DAYS = {
    '01-01': ['Vasile', 'Vasilica'],
    '01-07': ['Ioan', 'Ion', 'Ioana', 'Ionela', 'Ionuț', 'Oana'],
    '01-12': ['Tatiana'],
    '01-17': ['Anton', 'Antonia', 'Antonie'],
    '01-18': ['Atanasie'],
    '01-21': ['Maxim'],
    '01-25': ['Grigore'],
    '02-01': ['Trifon'],
    '02-03': ['Simion'],
    '02-10': ['Haralambie'],
    '02-17': ['Teodor', 'Teodora'],
    '04-23': ['Gheorghe', 'George', 'Georgeta', 'Georgiana'],
    '04-25': ['Marcu'],
    '05-05': ['Irina'],
    '05-21': ['Constantin', 'Elena'],
    '06-24': ['Sânziana'],
    '06-29': ['Petru', 'Petre', 'Pavel'],
    '07-20': ['Ilie', 'Ilinca'],
    '07-22': ['Magdalena', 'Mădălina'],
    '07-24': ['Cristina'],
    '07-25': ['Ana', 'Anca'],
    '07-27': ['Pantelimon'],
    '08-15': ['Maria', 'Marian', 'Mariana', 'Marinela'],
    '08-26': ['Adrian', 'Adriana'],
    '08-30': ['Alexandru', 'Alexandra'],
    '09-17': ['Sofia'],
    '10-03': ['Denisa'],
    '10-14': ['Parascheva', 'Paraschiva'],
    '10-26': ['Dumitru'],
    '11-08': ['Mihail', 'Mihai', 'Mihaela', 'Gabriel', 'Gabriela'],
    '11-11': ['Victor'],
    '11-14': ['Filip'],
    '11-16': ['Matei'],
    '11-25': ['Ecaterina', 'Cătălina', 'Cătălin'],
    '11-30': ['Andrei', 'Andreea'],
    '12-04': ['Varvara'],
    '12-05': ['Sava'],
    '12-06': ['Nicolae', 'Nicoleta', 'Niculina'],
    '12-12': ['Spiridon'],
    '12-17': ['Daniel', 'Daniela'],
    '12-20': ['Ignat'],
    '12-26': ['David'],
    '12-27': ['Ștefan', 'Ștefania']
  };
  // Florii (Palm Sunday, Easter - 7 days).
  var FLORII = ['Florin', 'Florina', 'Floriana', 'Florentina', 'Florica', 'Viorel', 'Viorica'];

  function two(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function nameDays(year, month, day) {
    if (!validYear(year)) return [];
    var out = (NAME_DAYS[two(month) + '-' + two(day)] || []).slice(),
      florii = shifted(year, -7);
    if (florii.month === month && florii.day === day) out = out.concat(FLORII);
    return out;
  }

  return {
    orthodoxEaster: orthodoxEaster,
    holidays: holidays,
    holidayNames: holidayNames,
    nameDays: nameDays
  };
});
