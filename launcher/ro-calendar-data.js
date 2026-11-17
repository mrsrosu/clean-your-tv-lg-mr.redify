/* Romanian calendar data: Orthodox Easter, legal days off, name days. Pure, offline, no DOM.
 *
 * Legal holidays: Codul muncii (Legea 53/2003) art. 139 alin. (1), current text checked 16 Nov 2026 at
 *   https://www.rubinian.com/codul-muncii-titlul-3-capitolul-2-sectiunea-3-articolul-139
 *   (amendments there: Legea 64/2018 Vinerea Mare, Legea 220/2016 1 iunie, Legea 52/2023 6-7 ianuarie).
 *   25 Oct (Armed Forces Day) is NOT in art. 139 and is not a day off. The two days per non-Christian
 *   religion in art. 139 depend on the person and are not listed. Holidays on weekends are not moved.
 * Name days: Romanian Orthodox calendar (https://calendar.patriarhia.ro), through the CC BY 4.0 dataset
 *   "Romanian Name Days and Holidays" by trends.ro (https://huggingface.co/datasets/radool/romanian-name-days),
 *   checked 16 Nov 2026. The dataset lists 47 days; the other days were filled on 17 Nov 2026 from the saint(s) of
 *   the day in the 2026 Patriarhia calendar (primary commemoration only): the saint's own name as a Romanian given
 *   name, plus the usual feminine/related forms (marked "derived" in docs/name-days-review.md). A few days that the
 *   2026 calendar shows as movable feasts (Easter, Pentecost, ...) and 29 Feb come from the menologion, also marked.
 *   Weak attributions stay out (Radu, Simona, Emil, Cristian). The 44 days of the dataset keep exactly their names.
 *   Name-to-saint links are a popular convention, not church doctrine.
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

  // Keyed MM-DD, all days of a leap year that have a name (a few days of the Lord's feasts and of martyrs without a
  // Romanian given name are left out on purpose: docs/name-days-review.md lists them with the reason).
  var NAME_DAYS = {
    '01-01': ['Vasile', 'Vasilica'],
    '01-02': ['Silvestru'],
    '01-04': ['Teoctist', 'Nichifor'],
    '01-06': ['Iordan', 'Iordana'],
    '01-07': ['Ioan', 'Ion', 'Ioana', 'Ionela', 'Ionuț', 'Oana'],
    '01-08': ['Gheorghe', 'George', 'Georgeta', 'Georgiana'],
    '01-09': ['Petru', 'Petre'],
    '01-10': ['Grigore', 'Grigorie'],
    '01-11': ['Teodosie', 'Teodosia'],
    '01-12': ['Tatiana'],
    '01-13': ['Iacob'],
    '01-14': ['Nina'],
    '01-15': ['Pavel', 'Paul', 'Ioan', 'Ion', 'Paula', 'Ioana', 'Ionela', 'Ionuț'],
    '01-16': ['Petru', 'Petre'],
    '01-17': ['Anton', 'Antonia', 'Antonie'],
    '01-18': ['Atanasie'],
    '01-19': ['Macarie'],
    '01-20': ['Eftimie'],
    '01-21': ['Maxim'],
    '01-22': ['Timotei'],
    '01-23': ['Clement'],
    '01-24': ['Xenia'],
    '01-25': ['Grigore'],
    '01-26': ['Iosif'],
    '01-27': ['Ioan', 'Ion', 'Ioana', 'Ionela', 'Ionuț'],
    '01-28': ['Efrem', 'Isaac', 'Iacob'],
    '01-29': ['Ignat', 'Ignatie'],
    '01-30': ['Vasile', 'Grigore', 'Grigorie', 'Ioan', 'Ion', 'Ioana', 'Ionela', 'Ionuț'],
    '01-31': ['Ioan', 'Ion', 'Ioana', 'Ionela', 'Ionuț'],
    '02-01': ['Trifon'],
    '02-03': ['Simion'],
    '02-04': ['Isidor'],
    '02-05': ['Agata'],
    '02-06': ['Fotie'],
    '02-07': ['Partenie'],
    '02-08': ['Teodor', 'Teodora'],
    '02-09': ['Nichifor'],
    '02-10': ['Haralambie'],
    '02-11': ['Teodora'],
    '02-12': ['Meletie'],
    '02-13': ['Martinian'],
    '02-14': ['Avram'],
    '02-15': ['Onisim'],
    '02-16': ['Pamfil'],
    '02-17': ['Teodor', 'Teodora'],
    '02-18': ['Leon'],
    '02-19': ['Arhip'],
    '02-20': ['Leon'],
    '02-21': ['Timotei'],
    '02-22': ['Adam'],
    '02-23': ['Policarp'],
    '02-24': ['Ioan', 'Ion', 'Ioana', 'Ionela', 'Ionuț'],
    '02-25': ['Tarasie'],
    '02-26': ['Porfirie'],
    '02-27': ['Procopie'],
    '02-28': ['Ioan', 'Ion', 'Casian', 'Gherman', 'Ioana', 'Ionela', 'Ionuț'],
    '02-29': ['Casian'],
    '03-01': ['Evdochia'],
    '03-02': ['Teodot'],
    '03-03': ['Eutropie'],
    '03-04': ['Gherasim'],
    '03-05': ['Marcu', 'Marcel'],
    '03-07': ['Efrem'],
    '03-08': ['Liviu', 'Galaction', 'Livia'],
    '03-10': ['Codrat', 'Ciprian', 'Dionisie', 'Cipriana'],
    '03-11': ['Sofronie'],
    '03-12': ['Teofan'],
    '03-13': ['Nichifor'],
    '03-14': ['Benedict'],
    '03-15': ['Agapie'],
    '03-16': ['Sabin'],
    '03-17': ['Alexie'],
    '03-18': ['Chiril'],
    '03-19': ['Daria', 'Claudiu', 'Claudia'],
    '03-20': ['Sava'],
    '03-21': ['Iacob'],
    '03-22': ['Vasile'],
    '03-23': ['Nicon'],
    '03-26': ['Gavril'],
    '03-27': ['Lidia'],
    '03-28': ['Ilarion', 'Ștefan', 'Ștefania'],
    '03-29': ['Marcu', 'Chiril', 'Marcel'],
    '03-30': ['Ioan', 'Ion', 'Ioana', 'Ionela', 'Ionuț'],
    '03-31': ['Ipatie'],
    '04-01': ['Maria'],
    '04-02': ['Tit'],
    '04-03': ['Nichita'],
    '04-04': ['Iosif', 'Gheorghe', 'George', 'Zosima', 'Georgeta', 'Georgiana'],
    '04-05': ['Teodora'],
    '04-06': ['Irineu'],
    '04-07': ['Gheorghe', 'George', 'Georgeta', 'Georgiana'],
    '04-08': ['Celestin'],
    '04-09': ['Vadim'],
    '04-10': ['Maxim'],
    '04-11': ['Calinic'],
    '04-12': ['Vasile'],
    '04-13': ['Martin'],
    '04-14': ['Pahomie'],
    '04-15': ['Aristarh', 'Trofim'],
    '04-16': ['Agapia', 'Irina'],
    '04-17': ['Simeon'],
    '04-18': ['Ioan', 'Ion', 'Ioana', 'Ionela', 'Ionuț'],
    '04-19': ['Ioan', 'Ion', 'Ioana', 'Ionela', 'Ionuț'],
    '04-20': ['Teodor', 'Teodora'],
    '04-21': ['Ianuarie'],
    '04-22': ['Teodor', 'Teodora'],
    '04-23': ['Gheorghe', 'George', 'Georgeta', 'Georgiana'],
    '04-24': ['Ilie', 'Simion', 'Ștefan', 'Sava', 'Ștefania'],
    '04-25': ['Marcu'],
    '04-26': ['Chiril'],
    '04-27': ['Simeon'],
    '04-28': ['Maxim'],
    '04-29': ['Memnon'],
    '04-30': ['Iacob'],
    '05-01': ['Eftimie', 'Ignat', 'Ignatie', 'Acachie'],
    '05-02': ['Atanasie', 'Atanasia'],
    '05-03': ['Timotei'],
    '05-04': ['Pelaghia'],
    '05-05': ['Irina'],
    '05-06': ['Iov'],
    '05-07': ['Acachie', 'Codrat'],
    '05-08': ['Ioan', 'Ion', 'Ioana', 'Ionela', 'Ionuț'],
    '05-09': ['Isaia'],
    '05-10': ['Simon'],
    '05-11': ['Dionisie'],
    '05-12': ['Ioan', 'Ion', 'Ioana', 'Ionela', 'Ionuț'],
    '05-13': ['Sergiu'],
    '05-14': ['Isidor'],
    '05-15': ['Iacob'],
    '05-16': ['Paisie'],
    '05-17': ['Andronic'],
    '05-18': ['Petru', 'Petre', 'Dionisie', 'Paulin'],
    '05-19': ['Patrichie'],
    '05-20': ['Lidia'],
    '05-21': ['Constantin', 'Elena'],
    '05-22': ['Marcel'],
    '05-23': ['Mihail', 'Mihai', 'Mihaela', 'Gabriel', 'Gabriela'],
    '05-24': ['Simeon'],
    '05-25': ['Ioan', 'Ion', 'Ioana', 'Ionela', 'Ionuț'],
    '05-26': ['Carp'],
    '05-27': ['Iuliu', 'Iulia'],
    '05-28': ['Eutihie', 'Nichita'],
    '05-29': ['Teodosia'],
    '05-30': ['Varlaam'],
    '06-01': ['Iustin', 'Iustina'],
    '06-02': ['Ioan', 'Ion', 'Ioana', 'Ionela', 'Ionuț'],
    '06-03': ['Ipatie', 'Paula'],
    '06-04': ['Filip'],
    '06-05': ['Elisabeta'],
    '06-06': ['Ilarion'],
    '06-07': ['Teodot'],
    '06-08': ['Nicandru', 'Marcian'],
    '06-09': ['Chiril'],
    '06-10': ['Alexandru', 'Antonina', 'Alexandra'],
    '06-11': ['Bartolomeu', 'Barnaba'],
    '06-12': ['Onufrie', 'Petru', 'Petre'],
    '06-14': ['Elisei'],
    '06-15': ['Isihie'],
    '06-16': ['Neofit'],
    '06-17': ['Inochentie', 'Felix'],
    '06-18': ['Leontie', 'Ipatie', 'Teodul'],
    '06-19': ['Paisie'],
    '06-20': ['Metodie'],
    '06-21': ['Iulian', 'Iuliana'],
    '06-22': ['Grigore', 'Grigorie'],
    '06-23': ['Agripina'],
    '06-24': ['Sânziana'],
    '06-25': ['Fevronia'],
    '06-26': ['David'],
    '06-27': ['Ioana'],
    '06-28': ['Ioan', 'Ion', 'Ioana', 'Ionela', 'Ionuț'],
    '06-29': ['Petru', 'Petre', 'Pavel'],
    '06-30': ['Ghelasie'],
    '07-01': ['Leontie'],
    '07-02': ['Ștefan', 'Ștefania'],
    '07-03': ['Anatolie'],
    '07-04': ['Olimpia'],
    '07-05': ['Atanasie', 'Atanasia'],
    '07-06': ['Lucia'],
    '07-07': ['Toma'],
    '07-08': ['Procopie', 'Teodosia'],
    '07-09': ['Pangratie'],
    '07-11': ['Olga'],
    '07-12': ['Ilarie'],
    '07-13': ['Dumitru', 'Dimitrie', 'Dumitra'],
    '07-14': ['Nicodim'],
    '07-15': ['Vladimir'],
    '07-16': ['Iulia'],
    '07-17': ['Marina'],
    '07-18': ['Emilian'],
    '07-19': ['Macrina'],
    '07-20': ['Ilie', 'Ilinca'],
    '07-21': ['Rafael', 'Partenie', 'Agapia'],
    '07-22': ['Magdalena', 'Mădălina'],
    '07-23': ['Foca'],
    '07-24': ['Cristina'],
    '07-25': ['Ana', 'Anca'],
    '07-26': ['Ioanichie'],
    '07-27': ['Pantelimon'],
    '07-28': ['Prohor'],
    '07-29': ['Calinic', 'Veniamin'],
    '07-30': ['Silvan', 'Andronic'],
    '07-31': ['Evdochim'],
    '08-02': ['Ștefan'],
    '08-03': ['Salomeea'],
    '08-05': ['Ioan', 'Ion', 'Iacob', 'Ioana', 'Ionela', 'Ionuț'],
    '08-07': ['Teodora'],
    '08-08': ['Alexandru', 'Alexandra'],
    '08-09': ['Matia'],
    '08-10': ['Ipolit'],
    '08-11': ['Nifon'],
    '08-12': ['Fotie'],
    '08-13': ['Maxim'],
    '08-15': ['Maria', 'Marian', 'Mariana', 'Marinela'],
    '08-16': ['Constantin', 'Ștefan', 'Matei', 'Constanța'],
    '08-17': ['Gheorghe', 'George', 'Georgeta', 'Georgiana'],
    '08-18': ['Florin'],
    '08-19': ['Andrei', 'Timotei', 'Agapie', 'Tecla', 'Andreea'],
    '08-20': ['Samuel'],
    '08-21': ['Tadeu'],
    '08-23': ['Lup'],
    '08-24': ['Eutihie'],
    '08-25': ['Bartolomeu'],
    '08-26': ['Adrian', 'Adriana'],
    '08-27': ['Pimen'],
    '08-28': ['Moise'],
    '08-29': ['Ioan', 'Ion', 'Ioana', 'Ionela', 'Ionuț'],
    '08-30': ['Alexandru', 'Alexandra'],
    '08-31': ['Macarie'],
    '09-01': ['Dionisie'],
    '09-02': ['Ioan', 'Ion', 'Ioana', 'Ionela', 'Ionuț'],
    '09-03': ['Neofit', 'Meletie'],
    '09-04': ['Moise'],
    '09-05': ['Zaharia', 'Elisabeta', 'Ioan', 'Ion', 'Ioana', 'Ionela', 'Ionuț'],
    '09-06': ['Mihail', 'Mihai', 'Mihaela', 'Gabriel', 'Gabriela'],
    '09-07': ['Simeon'],
    '09-08': ['Maria'],
    '09-09': ['Ioachim'],
    '09-10': ['Minodora'],
    '09-11': ['Teodora'],
    '09-12': ['Macedonie', 'Teodul'],
    '09-13': ['Ioan', 'Ion', 'Ioana', 'Ionela', 'Ionuț'],
    '09-15': ['Iosif'],
    '09-16': ['Antim'],
    '09-17': ['Sofia'],
    '09-18': ['Ilarion'],
    '09-19': ['Trofim', 'Savatie'],
    '09-20': ['Eustațiu', 'Agapie'],
    '09-21': ['Codrat'],
    '09-22': ['Teodosie', 'Teodosia'],
    '09-23': ['Ioan', 'Ion', 'Ioana', 'Ionela', 'Ionuț'],
    '09-24': ['Tecla'],
    '09-25': ['Eufrosina'],
    '09-26': ['Ioan', 'Ion', 'Ioana', 'Ionela', 'Ionuț'],
    '09-27': ['Antim'],
    '09-28': ['Hariton'],
    '09-29': ['Chiriac'],
    '09-30': ['Grigore', 'Grigorie'],
    '10-01': ['Anania'],
    '10-02': ['Ciprian', 'Cipriana'],
    '10-03': ['Denisa'],
    '10-04': ['Dumitru'],
    '10-05': ['Misail'],
    '10-06': ['Toma'],
    '10-07': ['Sergiu'],
    '10-08': ['Pelaghia', 'Taisia'],
    '10-09': ['Iacob'],
    '10-10': ['Teofil'],
    '10-11': ['Filip'],
    '10-12': ['Andronic'],
    '10-13': ['Andrei', 'Andreea'],
    '10-14': ['Parascheva', 'Paraschiva'],
    '10-15': ['Magdalena'],
    '10-16': ['Longhin'],
    '10-17': ['Andrei', 'Andreea'],
    '10-18': ['Luca'],
    '10-19': ['Cleopatra'],
    '10-20': ['Artemie'],
    '10-21': ['Visarion', 'Sofronie'],
    '10-23': ['Iacob'],
    '10-24': ['Marcu', 'Valentin', 'Marcel', 'Valentina'],
    '10-25': ['Marcian'],
    '10-26': ['Dumitru'],
    '10-27': ['Dumitru', 'Dimitrie', 'Dumitra'],
    '10-28': ['Teofana'],
    '10-29': ['Anastasia', 'Romana'],
    '10-30': ['Zenovie'],
    '10-31': ['Urban', 'Narcis', 'Narcisa'],
    '11-01': ['Cosma', 'Damian', 'Cosmin', 'Damiana'],
    '11-03': ['Iosif'],
    '11-04': ['Ioanichie'],
    '11-05': ['Galaction'],
    '11-06': ['Pavel', 'Paul', 'Paula'],
    '11-07': ['Lazăr'],
    '11-08': ['Mihail', 'Mihai', 'Mihaela', 'Gabriel', 'Gabriela'],
    '11-09': ['Nectarie'],
    '11-10': ['Visarion'],
    '11-11': ['Victor'],
    '11-12': ['Atanasie', 'Vasile', 'Grigore', 'Grigorie', 'Atanasia'],
    '11-13': ['Ioan', 'Ion', 'Ioana', 'Ionela', 'Ionuț'],
    '11-14': ['Filip'],
    '11-15': ['Paisie'],
    '11-16': ['Matei'],
    '11-17': ['Grigore', 'Grigorie', 'Ghenadie'],
    '11-18': ['Nectarie'],
    '11-19': ['Varlaam'],
    '11-20': ['Grigore', 'Grigorie'],
    '11-22': ['Filimon', 'Arhip', 'Onisim'],
    '11-23': ['Antonie', 'Anton', 'Antonia'],
    '11-24': ['Clement', 'Petru', 'Petre'],
    '11-25': ['Ecaterina', 'Cătălina', 'Cătălin'],
    '11-26': ['Alipie', 'Nicon', 'Stelian'],
    '11-27': ['Iacob'],
    '11-28': ['Arsenie'],
    '11-29': ['Andrei', 'Andreea'],
    '11-30': ['Andrei', 'Andreea'],
    '12-01': ['Anastasia'],
    '12-02': ['Paisie', 'Cleopa'],
    '12-03': ['Gheorghe', 'George', 'Georgeta', 'Georgiana'],
    '12-04': ['Varvara'],
    '12-05': ['Sava'],
    '12-06': ['Nicolae', 'Nicoleta', 'Niculina'],
    '12-07': ['Ambrozie'],
    '12-08': ['Onisifor'],
    '12-09': ['Ana', 'Maria'],
    '12-10': ['Mina'],
    '12-11': ['Luca'],
    '12-12': ['Spiridon'],
    '12-13': ['Dosoftei'],
    '12-14': ['Calinic', 'Filimon'],
    '12-15': ['Elefterie'],
    '12-16': ['Teofana'],
    '12-17': ['Daniel', 'Daniela'],
    '12-18': ['Sebastian', 'Zoe'],
    '12-19': ['Bonifaciu'],
    '12-20': ['Ignat'],
    '12-21': ['Iuliana'],
    '12-22': ['Anastasia', 'Petru', 'Petre'],
    '12-23': ['Antonina'],
    '12-24': ['Eugenia'],
    '12-26': ['David'],
    '12-27': ['Ștefan', 'Ștefania'],
    '12-29': ['Marcel', 'Tadeu'],
    '12-30': ['Anisia'],
    '12-31': ['Melania', 'Romana']
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

  // The next day after year-month-day (searching day by day, at most 366 days) that has name days, movable ones
  // included: { year, month, day, names } or null when the table has none at all.
  function nextNameDay(year, month, day) {
    var i, d, names;
    if (!validYear(year)) return null;
    for (i = 1; i <= 366; i++) {
      d = new Date(Date.UTC(year, month - 1, day + i));
      if (!validYear(d.getUTCFullYear())) return null;
      names = nameDays(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
      if (names.length)
        return {
          year: d.getUTCFullYear(),
          month: d.getUTCMonth() + 1,
          day: d.getUTCDate(),
          names: names
        };
    }
    return null;
  }

  return {
    nextNameDay: nextNameDay,
    orthodoxEaster: orthodoxEaster,
    holidays: holidays,
    holidayNames: holidayNames,
    nameDays: nameDays
  };
});
