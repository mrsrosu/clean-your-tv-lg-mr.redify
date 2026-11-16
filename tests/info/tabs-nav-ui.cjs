'use strict';
const assert = require('node:assert/strict'),
  { openHome } = require('./harness.cjs');
// Settings tabs of the info features: remote Down/Up visit EVERY visible control of the pane in visual order (the
// Settings navigation is geometric: a control that is not horizontally aligned with its neighbours gets skipped).
(async () => {
  const home = await openHome({ mrRedify: true }),
    page = home.page;
  await page.evaluate(() => {
    localStorage.clear();
    // Data so that every control of every tab exists: rates, followed teams, picker chips, own events.
    HomeInfo.finance.set({
      currencies: ['EUR', 'USD'],
      current: { date: '2026-11-16', rates: { EUR: { value: 5, multiplier: 1 }, USD: { value: 4.6, multiplier: 1 }, GBP: { value: 5.8, multiplier: 1 } } }
    });
    HomeInfo.calendar.set({ events: [{ id: 'e1', day: 3, month: 4, title: 'Birthday', yearly: true }, { id: 'e2', day: 9, month: 5, title: 'Trip', yearly: false, year: 2026 }] });
    const list = [];
    for (let i = 0; i < 12; i++) list.push({ id: 't' + i, name: 'Team ' + i });
    localStorage.setItem('tvhome.cache.v1.fb.teams.eng.1', JSON.stringify({ value: list, fetchedAt: Date.now() }));
    HomeInfo.football.set({ competitions: ['eng.1', 'nat'], teams: [{ competition: 'nat', id: '473', name: 'Romania' }] });
    RenewalPanel.open();
  });
  const ids = ['idle', 'daily', 'calendar', 'football'];
  // Controls are addressed by their index among the visible focusable controls (a tab may redraw its DOM on focus).
  const LIST = (id) =>
    `Array.prototype.filter.call(document.getElementById('settings-pane-${id}').querySelectorAll('button, input, select, a[href], [tabindex]'), (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.disabled && e.tabIndex >= 0; })`;
  const focusAt = (id, i) => page.evaluate(`(${LIST(id)})[${i}].focus()`);
  const activeIndex = (id) => page.evaluate(`(${LIST(id)}).indexOf(document.activeElement)`);
  for (const id of ids) {
    await page.locator('[data-category="' + id + '"]').click();
    await page.waitForTimeout(300);
    await focusAt(id, 0); // lets a tab load its data (football lists teams on first focus) before it is measured
    await page.waitForTimeout(500);
    const info = (await page.evaluate(`(${LIST(id)}).map((e, i) => ({ nav: i, name: (e.className || e.tagName) + '|' + (e.textContent || e.value || '').trim().slice(0, 24), top: Math.round(e.getBoundingClientRect().top), pressed: e.hasAttribute('aria-pressed'), cls: e.className }))`));
    assert.ok(info.length >= 2, id + ': controls found');
    // Visual rows (controls whose tops are within 8 px); Down/Up must reach every ROW in order, Right/Left every
    // control inside a row.
    const rows = [];
    info.forEach((x) => {
      const row = rows.find((r) => Math.abs(r.top - x.top) <= 8);
      if (row) row.items.push(x);
      else rows.push({ top: x.top, items: [x] });
    });
    rows.sort((p, q) => p.top - q.top);
    const rowOf = (nav) => rows.findIndex((r) => r.items.some((x) => x.nav === nav));
    const name = (nav) => (info.find((x) => x.nav === nav) || { name: '#' + nav }).name;
    const walk = async (start, key) => {
      await focusAt(id, start);
      const seen = [start];
      for (let i = 0; i < info.length + 6; i++) {
        await page.keyboard.press(key);
        const cur = await activeIndex(id);
        if (cur < 0) break; // left the pane (menu / footer)
        if (cur === seen[seen.length - 1]) break;
        seen.push(cur);
      }
      return seen;
    };
    const down = await walk(rows[0].items[0].nav, 'ArrowDown'),
      up = await walk(rows[rows.length - 1].items[0].nav, 'ArrowUp');
    const rowsDown = down.map(rowOf),
      rowsUp = up.map(rowOf);
    for (let r = 0; r < rows.length; r++) {
      assert.ok(rowsDown.indexOf(r) >= 0, id + ': Down skipped the row ' + rows[r].items.map((x) => x.name).join(' / ') + '; visited ' + down.map(name).join(' > '));
      assert.ok(rowsUp.indexOf(r) >= 0, id + ': Up skipped the row ' + rows[r].items.map((x) => x.name).join(' / ') + '; visited ' + up.map(name).join(' > '));
    }
    assert.deepEqual(rowsDown, rowsDown.slice().sort((p, q) => p - q), id + ': Down goes in visual order');
    // Inside a row Right reaches every control, Left comes back.
    for (const row of rows) {
      const sorted = row.items.slice().sort((p, q) => p.nav - q.nav);
      const rightSeen = await walk(sorted[0].nav, 'ArrowRight'),
        leftSeen = await walk(sorted[sorted.length - 1].nav, 'ArrowLeft');
      sorted.forEach((x) => {
        assert.ok(rightSeen.indexOf(x.nav) >= 0, id + ': Right skipped ' + x.name + ' in its row; visited ' + rightSeen.map(name).join(' > '));
        assert.ok(leftSeen.indexOf(x.nav) >= 0, id + ': Left skipped ' + x.name + ' in its row');
      });
    }
    // Enter on every toggle (aria-pressed) flips it and a second Enter flips it back.
    const toggles = info.filter((x) => x.pressed && !/fb-followed|fb-team-chip|fb-comp-chip|cal-yearly|idle-style|idle-timeout|cal-start|fin-chip/.test(x.cls));
    assert.ok(toggles.length >= 1, id + ': has toggles');
    for (const t of toggles) {
      const read = () => page.evaluate(`(${LIST(id)})[${t.nav}].getAttribute('aria-pressed')`);
      const before = await read();
      await focusAt(id, t.nav);
      await page.keyboard.press('Enter');
      const after = await read();
      assert.notEqual(after, before, id + ': Enter toggles ' + t.name);
      await focusAt(id, t.nav);
      await page.keyboard.press('Enter');
      assert.equal(await read(), before, id + ': second Enter flips back ' + t.name);
    }
  }
  assert.deepEqual(home.errors, [], 'page errors');
  await home.close();
  console.log('PASS tabs-nav-ui');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
