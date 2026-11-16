'use strict';
const assert = require('node:assert/strict'),
  { openHome } = require('./harness.cjs');
// "Show on main page" toggle: first control of the Calendar, Rates & holidays and Football tabs; stored as `landing`.
(async () => {
  const home = await openHome({ mrRedify: true }),
    page = home.page,
    tabs = [
      { id: 'calendar', store: 'calendar', cls: 'cal-landing' },
      { id: 'daily', store: 'finance', cls: 'fin-toggle-landing' },
      { id: 'daily', store: 'daily', cls: 'fin-toggle-nameday', second: true },
      { id: 'football', store: 'football', cls: 'fb-landing' }
    ];
  // Defaults and sanitizing (stored garbage reads false; set() with a non-boolean stores false).
  for (const t of tabs) {
    const v = await page.evaluate((s) => {
      const out = [HomeInfo[s].get().landing];
      HomeInfo[s].set({ landing: 'yes' });
      out.push(HomeInfo[s].get().landing);
      HomeInfo[s].set({ landing: true });
      out.push(HomeInfo[s].get().landing);
      HomeInfo[s].set({ landing: 1 });
      out.push(HomeInfo[s].get().landing);
      const key = {
        calendar: 'tvhome.calendar.v1',
        finance: 'tvhome.finance.v1',
        football: 'tvhome.football.v1',
        daily: 'tvhome.daily.v1'
      }[s];
      localStorage.setItem(key, '{"landing":"x"}');
      out.push(HomeInfo[s].get().landing);
      localStorage.removeItem(key);
      return out;
    }, t.store);
    assert.deepEqual(v, [false, false, true, false, false], t.id + ' landing sanitize');
  }
  await page.evaluate(() => RenewalPanel.open());
  for (const t of tabs) {
    await page.locator('[data-category="' + t.id + '"]').click();
    const pane = page.locator('#settings-pane-' + t.id),
      nth = t.second ? 1 : 0,
      first = pane.locator('button').nth(nth);
    assert.equal(await first.evaluate((b, c) => b.classList.contains(c), t.cls), true, t.id + ' ' + t.cls + ' control (first' + (t.second ? ' two' : '') + ')');
    assert.match(await pane.innerText(), t.second ? /Show name day on main page/ : /Show on main page/);
    assert.equal(await first.innerText(), 'Off');
    assert.equal(await first.getAttribute('aria-pressed'), 'false');
    // Remote path: focus + Enter on a real button.
    await first.focus();
    await page.keyboard.press('Enter');
    assert.equal(
      await page.evaluate((s) => HomeInfo[s].get().landing, t.store),
      true,
      t.id + ' ON'
    );
    const again = pane.locator('button').nth(nth);
    assert.equal(await again.innerText(), 'On');
    assert.equal(await again.getAttribute('aria-pressed'), 'true');
    await again.click();
    assert.equal(
      await page.evaluate((s) => HomeInfo[s].get().landing, t.store),
      false,
      t.id + ' OFF'
    );
  }
  assert.deepEqual(home.errors, [], 'page errors');
  // Romanian label.
  await page.evaluate(() => {
    document.getElementById('renewalClose').click();
    localStorage.setItem('tvhome.language', 'ro');
    HomeI18n.refresh();
  });
  assert.equal(
    await page.evaluate(() => HomeI18n.t('Show on main page')),
    'Arată pe pagina principală'
  );
  assert.equal(await page.evaluate(() => HomeI18n.t('Idle screen')), 'Ecran de repaus');
  assert.equal(
    await page.evaluate(() => HomeI18n.t('Show name day on main page')),
    'Arată onomastica pe pagina principală'
  );
  assert.match(
    await page.evaluate(() =>
      HomeI18n.t('The LG screensaver also runs over Home. Turn it off in the TV settings (search for Screen Saver) or set it longer than the time chosen here, otherwise it will appear on top of this screen. This screen only works while Home is in the foreground.')
    ),
    /^Screensaverul LG rulează și peste Home\. Oprește-l din setările TV-ului \(caută Screen Saver\)/
  );
  await home.close();
  console.log('PASS landing-toggles-ui');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
