'use strict';
const assert = require('node:assert/strict'),
  { openHome } = require('./harness.cjs');
// Calendar page (info panel) and Calendar settings tab, mr.redify scope, clock fixed to Fri 10 Apr 2026.
(async () => {
  const home = await openHome({ mrRedify: true }),
    page = home.page;
  const setup = (iso, extra) =>
    page.evaluate(
      ([iso, extra]) => {
        localStorage.removeItem('tvhome.calendar.v1');
        localStorage.removeItem('tvhome.daily.v1');
        if (extra) localStorage.setItem(extra[0], extra[1]);
        const d = new Date(iso);
        HomeCalendar.setClock(() => new Date(d.getTime()));
        InfoPanel.close();
      },
      [iso, extra || null]
    );
  const open = () => page.evaluate(() => InfoPanel.open());
  const title = () => page.locator('#infoPanel .cal-title').innerText();
  const cell = (n) =>
    page.locator('#infoPanel .cal-cell.in-month', {
      hasText: new RegExp('^' + n + '$')
    });
  const detail = () => page.locator('#infoPanel .cal-detail').innerText();
  const cls = async (n) => (await cell(n).first().getAttribute('class')) || '';

  // 1. Today, holidays, detail, month change.
  await setup('2026-04-10T12:00:00');
  await open();
  assert.match(await title(), /April 2026/);
  assert.match(await cls(10), /today/);
  assert.match(await cls(10), /holiday/, 'Good Friday');
  assert.match(await cls(12), /holiday/, 'Easter');
  assert.match(await cls(13), /holiday/);
  assert.doesNotMatch(await cls(11), /holiday/);
  assert.match(await detail(), /Vinerea Mare/);
  await page.keyboard.press('ArrowUp'); // 3 Apr
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight'); // 5 Apr: Florii
  assert.match(await cls(5), /selected/);
  assert.match(await detail(), /Florin/, 'name day');
  assert.equal(
    await page.locator('#infoPanel .cal-weekday').count(),
    7,
    'seven weekday headers'
  );
  // 12 Apr: Paste.
  for (let i = 0; i < 1; i++) await page.keyboard.press('ArrowDown'); // 12 Apr
  assert.match(await detail(), /Paștele|Pastele/i);
  // Crossing months with Down, and PageDown/PageUp.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown'); // 3 May
  assert.match(await title(), /May 2026/);
  await page.keyboard.press('PageUp');
  assert.match(await title(), /April 2026/);
  await page.keyboard.press('PageDown');
  await page.keyboard.press('PageDown');
  assert.match(await title(), /June 2026/);
  // daily toggles are honoured.
  await page.evaluate(() =>
    HomeInfo.daily.set({ showHolidays: false, showNameDays: false })
  );
  await page.evaluate(() => {
    InfoPanel.close();
    InfoPanel.open();
  });
  assert.match(await title(), /April 2026/);
  assert.doesNotMatch(await cls(10), /holiday/);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  assert.doesNotMatch(await detail(), /Florin/);
  // Up in the first week row of the month falls through to the panel: Back button focused, calendar idle.
  assert.match(await cls(5), /selected/);
  await page.keyboard.press('ArrowUp');
  assert.equal(
    await page.evaluate(() =>
      document.getElementById('infoBack').classList.contains('focused')
    ),
    true,
    'Up from the first row reaches Back'
  );
  assert.match(await title(), /April 2026/, 'no month change');
  await page.keyboard.press('ArrowLeft'); // stays on Back, calendar not moved
  assert.match(await cls(5), /selected/);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown'); // calendar moves again: 12 Apr
  assert.match(await cls(12), /selected/, 'Down returns to the grid');
  await page.evaluate(() => HomeInfo.daily.reset());

  // 2. Own events appear on the grid and in the detail.
  await setup('2026-04-10T12:00:00');
  await page.evaluate(() =>
    HomeInfo.calendar.set({
      events: [
        { id: 'a', day: 5, month: 4, title: 'Dentist', yearly: true },
        { id: 'b', day: 20, month: 4, title: 'Once', yearly: false, year: 2025 }
      ]
    })
  );
  await open();
  assert.match(await cls(5), /has-event/);
  assert.doesNotMatch(await cls(20), /has-event/, 'one-off from another year');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  assert.match(await detail(), /Dentist/);

  // 3. Edges: Left in the first column goes to the panel (page switch); mid-row stays.
  await setup('2026-04-10T12:00:00');
  await page.evaluate(() =>
    InfoPanel.registerPage({
      id: 'zz',
      label: 'zz',
      render(c) {
        c.textContent = 'page-zz';
      }
    })
  );
  await open();
  // Monday start, 10 Apr is a Friday: Left x4 reaches Monday 6 Apr, one more falls through to the panel.
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
  assert.match(await cls(6), /selected/);
  assert.equal(
    await page.evaluate(
      () => !!document.querySelector('#infoPanel .cal-grid')?.offsetParent
    ),
    true
  );
  // Right at the last column (Sunday 12 Apr) goes to the next page.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  assert.match(await cls(12), /selected/);
  await page.keyboard.press('ArrowRight'); // next page: exchange rates
  assert.equal(await page.locator('#infoPanel .fin-page').isVisible(), true);
  await page.keyboard.press('ArrowRight'); // then football
  assert.equal(await page.locator('#infoPanel .fb-page').isVisible(), true);
  await page.keyboard.press('ArrowRight');
  assert.equal(
    await page.evaluate(
      () =>
        document.querySelector('#infoPanel .info-page:not([hidden])')
          .textContent
    ),
    'page-zz'
  );
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft'); // back to the calendar
  assert.equal(await page.locator('#infoPanel .cal-grid').isVisible(), true);
  await page.keyboard.press('Enter'); // OK on a day: nothing harmful
  assert.equal(await page.locator('#infoPanel .cal-grid').isVisible(), true);
  await page.evaluate(() => InfoPanel.close());

  // 4. Calendar tab: replaces the placeholder, settings and own event management.
  await setup('2026-04-10T12:00:00');
  await page.evaluate(() => RenewalPanel.open());
  await page.locator('[data-category="calendar"]').click();
  const pane = page.locator('#settings-pane-calendar');
  assert.equal(await pane.isVisible(), true);
  assert.equal(
    await pane.locator('.cal-weeknum').count(),
    1,
    'real tab, not placeholder'
  );
  await pane.locator('.cal-start-sun').click();
  await pane.locator('.cal-weeknum').click();
  assert.deepEqual(
    await page.evaluate(() => {
      const c = HomeInfo.calendar.get();
      return [c.weekStart, c.weekNumbers];
    }),
    ['sun', true]
  );
  // Add an event: day 10 -> 11 with the stepper, title typed in the text input.
  await pane.locator('.cal-day-up').click();
  await pane.locator('.cal-title-input').fill('Anniv');
  await pane.locator('.cal-yearly').click(); // toggles to "no"
  await pane.locator('.cal-add').click();
  const events = await page.evaluate(() => HomeInfo.calendar.get().events);
  assert.equal(events.length, 1);
  assert.deepEqual(
    [events[0].day, events[0].month, events[0].title, events[0].yearly],
    [11, 4, 'Anniv', false]
  );
  assert.equal(await pane.locator('.cal-event').count(), 1);
  // Empty title is refused.
  await pane.locator('.cal-title-input').fill('  ');
  await pane.locator('.cal-add').click();
  assert.equal(
    await page.evaluate(() => HomeInfo.calendar.get().events.length),
    1
  );
  await page.evaluate(() => RenewalPanel.close && RenewalPanel.close());
  await open();
  assert.match(await cls(11), /has-event/, 'added event shows on the grid');
  assert.equal(
    (await page.locator('#infoPanel .cal-weekno').count()) > 0,
    true,
    'week numbers shown'
  );
  assert.equal(
    (await page.locator('#infoPanel .cal-weekday').first().innerText()).trim(),
    'Sun',
    'Sunday first'
  );
  await page.evaluate(() => InfoPanel.close());
  // Delete.
  await page.evaluate(() => RenewalPanel.open());
  await page.locator('[data-category="calendar"]').click();
  await pane.locator('.cal-delete').first().click();
  assert.equal(
    await page.evaluate(() => HomeInfo.calendar.get().events.length),
    0
  );
  // 4b. Event time: "All day" (default ON) or Hour / Minute steppers; next full hour from now when switched OFF.
  await setup('2026-04-10T12:20:00');
  await page.evaluate(() => {
    localStorage.setItem('tvhome.clockFormat', '24h');
    HomeI18n.refresh();
  });
  await page.evaluate(() => RenewalPanel.open());
  await page.locator('[data-category="calendar"]').click();
  const allDay = pane.locator('.cal-allday'),
    hourRow = pane.locator('.cal-hour-up'),
    minuteRow = pane.locator('.cal-minute-up');
  assert.equal(await allDay.innerText(), 'On', 'all day by default');
  assert.equal(await hourRow.isVisible(), false, 'no hour stepper while all day');
  assert.equal(await minuteRow.isVisible(), false);
  // An all-day event.
  await pane.locator('.cal-title-input').fill('Holiday trip');
  await pane.locator('.cal-add').click();
  assert.equal(await page.evaluate(() => 'time' in HomeInfo.calendar.get().events[0]), false, 'all-day: no time stored');
  // OFF: steppers appear on the next full hour (12:20 -> 13:00).
  await allDay.click();
  assert.equal(await allDay.innerText(), 'Off');
  assert.equal(await hourRow.isVisible(), true);
  assert.equal(await minuteRow.isVisible(), true);
  const vals = () => pane.locator('.cal-field .cal-value').allInnerTexts();
  assert.deepEqual((await vals()).slice(2), ['13', '00'], 'default: next full hour');
  // Hour wraps 23 -> 0 and 0 -> 23; minute steps by 5 and wraps 55 -> 0 and 0 -> 55.
  for (let i = 0; i < 11; i++) await pane.locator('.cal-hour-up').click();
  assert.equal((await vals())[2], '00', '13 + 11 = 24 -> 00');
  await pane.locator('.cal-hour-down').click();
  assert.equal((await vals())[2], '23');
  await pane.locator('.cal-hour-up').click();
  for (let i = 0; i < 11; i++) await pane.locator('.cal-minute-up').click();
  assert.equal((await vals())[3], '55');
  await pane.locator('.cal-minute-up').click();
  assert.equal((await vals())[3], '00', '55 -> 00');
  await pane.locator('.cal-minute-down').click();
  assert.equal((await vals())[3], '55', '00 -> 55');
  for (let i = 0; i < 9; i++) await pane.locator('.cal-minute-down').click();
  assert.equal((await vals())[3], '10');
  for (let i = 0; i < 14; i++) await pane.locator('.cal-hour-up').click(); // 00 -> 14
  await pane.locator('.cal-title-input').fill('Dentist');
  await pane.locator('.cal-add').click();
  const timed = await page.evaluate(() => HomeInfo.calendar.get().events.map((e) => [e.title, e.time || null]));
  assert.deepEqual(timed, [['Holiday trip', null], ['Dentist', '14:10']]);
  // The list shows the time; same-day order is all-day first, then by time (also in the page's day detail).
  const listText = await pane.locator('.cal-event-text').allInnerTexts();
  assert.match(listText[0], /Holiday trip/);
  assert.doesNotMatch(listText[0], /\d\d:\d\d/);
  assert.match(listText[1], /\s14:10\s+Dentist/);
  await page.evaluate(() => {
    HomeInfo.calendar.set({
      events: [
        { id: 'q1', day: 10, month: 4, title: 'Late', yearly: true, time: '18:00' },
        { id: 'q2', day: 10, month: 4, title: 'Early', yearly: true, time: '07:30' },
        { id: 'q3', day: 10, month: 4, title: 'All day', yearly: true }
      ]
    });
    document.getElementById('renewalClose').click();
  });
  await open();
  const detailTexts = await page.locator("#infoPanel .cal-detail .cal-line .cal-text").allInnerTexts();
  assert.deepEqual(detailTexts.slice(-3), ['All day', '07:30 Early', '18:00 Late'], 'all-day first, then by time');
  await page.evaluate(() => InfoPanel.close());
  // 12-hour Home clock format: the stored time stays 24 h, the display follows the clock setting.
  await page.evaluate(() => {
    localStorage.setItem('tvhome.clockFormat', '12h');
    HomeI18n.refresh();
  });
  await open();
  assert.match((await page.locator('#infoPanel .cal-detail .cal-line .cal-text').allInnerTexts()).slice(-1)[0], /^(6:00|06:00)\s?PM Late$/i);
  assert.equal(await page.evaluate(() => HomeInfo.calendar.get().events.find((e) => e.title === 'Late').time), '18:00');
  await page.evaluate(() => {
    localStorage.removeItem('tvhome.clockFormat');
    HomeI18n.refresh();
    InfoPanel.close();
  });
  await page.evaluate(() => HomeInfo.calendar.set({ events: [] }));

  // Limit 50.
  await page.evaluate(() => {
    const list = [];
    for (let i = 0; i < 50; i++)
      list.push({
        id: 'x' + i,
        day: 1,
        month: 1,
        title: 'E' + i,
        yearly: true
      });
    HomeInfo.calendar.set({ events: list });
  });
  await page.evaluate(() => RenewalPanel.close && RenewalPanel.close());
  await page.evaluate(() => RenewalPanel.open());
  await page.locator('[data-category="calendar"]').click();
  await pane.locator('.cal-title-input').fill('Extra');
  await pane.locator('.cal-add').click();
  assert.equal(
    await page.evaluate(() => HomeInfo.calendar.get().events.length),
    50
  );
  await page.evaluate(() => RenewalPanel.close && RenewalPanel.close());

  // 5. Resilience: corrupt store, bad date, throwing lookup.
  await setup('2026-04-10T12:00:00', [
    'tvhome.calendar.v1',
    '{"events":"oops","weekStart":"sun"}'
  ]);
  await open();
  assert.match(await title(), /April 2026/);
  assert.ok((await page.locator('#infoPanel .cal-cell').count()) >= 28);
  await page.evaluate(() => InfoPanel.close());
  await setup('2026-04-10T12:00:00');
  await page.evaluate(() => {
    window.__orig = HomeRoCalendar.holidayNames;
    HomeRoCalendar.holidayNames = () => {
      throw new Error('boom');
    };
  });
  await open();
  assert.match(await title(), /April 2026/);
  assert.doesNotMatch(await cls(10), /holiday/);
  await page.evaluate(() => {
    HomeRoCalendar.holidayNames = window.__orig;
    InfoPanel.close();
  });
  await setup('2026-04-10T12:00:00');
  await page.evaluate(() => HomeCalendar.setClock(() => new Date(NaN)));
  await open();
  assert.equal(
    await page.locator('#infoPanel .cal-cell.in-month').count(),
    0,
    'bad date: empty month'
  );
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('PageDown');
  await page.evaluate(() => InfoPanel.close());

  // 6. Romanian month and weekday names; Romanian holiday names come from the data.
  await setup('2026-11-16T12:00:00');
  await page.evaluate(() => {
    localStorage.setItem('tvhome.language', 'ro');
    HomeI18n.refresh();
  });
  await open();
  assert.match(await title(), /noiembrie 2026/);
  assert.match(await detail(), /luni, 16 noiembrie 2026/);
  assert.equal(
    (await page.locator('#infoPanel .cal-weekday').first().innerText()).trim(),
    'Lun'
  );
  await page.evaluate(() => {
    InfoPanel.close();
    localStorage.removeItem('tvhome.language');
    HomeI18n.refresh();
  });
  // 7. M9: a one-off event on 29 February lands in the next leap year, so it can appear in the grid.
  await setup('2026-11-16T12:00:00');
  await page.evaluate(() => RenewalPanel.open());
  await page.locator('[data-category="calendar"]').click();
  const pane7 = page.locator('#settings-pane-calendar');
  const val = (n) => pane7.locator('.cal-value').nth(n).innerText();
  for (let i = 0; i < 12 && !/^Feb/.test(await val(1)); i++)
    await pane7.locator('.cal-month-up').click();
  for (let i = 0; i < 31 && (await val(0)).trim() !== '29'; i++)
    await pane7.locator('.cal-day-up').click();
  assert.match(await val(1), /^Feb/);
  assert.equal((await val(0)).trim(), '29');
  await pane7.locator('.cal-title-input').fill('Leap');
  if ((await pane7.locator('.cal-yearly').getAttribute('aria-pressed')) === 'true')
    await pane7.locator('.cal-yearly').click(); // off
  await pane7.locator('.cal-add').click();
  const leap = await page.evaluate(() => HomeInfo.calendar.get().events);
  assert.equal(leap.length, 1);
  assert.deepEqual([leap[0].day, leap[0].month, leap[0].year], [29, 2, 2028]);
  await page.evaluate(() => document.getElementById('renewalClose').click());

  assert.deepEqual(home.errors, [], 'page errors');
  await home.close();
  console.log('PASS calendar-ui');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
