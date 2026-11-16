'use strict';
const assert = require('node:assert/strict'),
  { openHome, ids } = require('./harness.cjs');
const base = [
  'home',
  'appearance',
  'themes',
  'wallpapers',
  'language',
  'updates',
  'advanced'
];
(async () => {
  // The root edition has its own settings panel and does not load the info modules.
  for (const edition of ['launcher']) {
    const home = await openHome({ mrRedify: true, edition }),
      page = home.page,
      tab = (id) => page.locator('[data-category="' + id + '"]');
    await page.evaluate(() => RenewalPanel.open());
    for (const id of ids.concat(base))
      assert.equal(await tab(id).isVisible(), true, edition + ' visible ' + id);
    // Appearance/Themes/Wallpapers keep their order relative to each other.
    const order = await page
      .locator('[role=tab]')
      .evaluateAll((a) => a.map((n) => n.dataset.category));
    assert.ok(order.indexOf('appearance') < order.indexOf('themes'));
    assert.ok(order.indexOf('themes') < order.indexOf('wallpapers'));
    // ArrowDown from the first tab reaches every tab, including the four scoped ones.
    const seen = [];
    await tab('home').focus();
    for (let i = 0; i < order.length; i++) {
      seen.push(
        await page.evaluate(() => document.activeElement.dataset.category)
      );
      await page.keyboard.press('ArrowDown');
    }
    for (const id of ids)
      assert.ok(seen.includes(id), edition + ' reaches ' + id);
    // Selected scoped tab: leaving the scope selects tab 0.
    await tab('calendar').click();
    assert.equal(await tab('calendar').getAttribute('aria-selected'), 'true');
    await home.setScope(false);
    for (const id of ids)
      assert.equal(await tab(id).isVisible(), false, edition + ' hidden ' + id);
    assert.equal(await tab('home').getAttribute('aria-selected'), 'true');
    assert.equal(await tab('calendar').getAttribute('aria-selected'), 'false');
    assert.equal(
      await page.locator('#settings-pane-calendar').isVisible(),
      false
    );
    // Navigation never lands on a hidden tab, and wraps through the footer.
    await tab('home').focus();
    const visited = [];
    for (let i = 0; i < order.length + 2; i++) {
      visited.push(
        await page.evaluate(
          () =>
            document.activeElement.dataset.category ||
            document.activeElement.tagName
        )
      );
      await page.keyboard.press('ArrowDown');
    }
    for (const id of ids)
      assert.ok(!visited.includes(id), edition + ' skips ' + id);
    for (const id of base)
      assert.ok(visited.includes(id), edition + ' still reaches ' + id);
    // Tab key skips hidden tabs too.
    await tab('home').focus();
    for (let i = 0; i < order.length + 2; i++) {
      await page.keyboard.press('Tab');
      const cat = await page.evaluate(
        () => document.activeElement.dataset.category
      );
      assert.ok(!ids.includes(cat), edition + ' Tab skips ' + cat);
    }
    // Existing tabs still select and show their pane, in both scopes.
    for (const scope of [false, true]) {
      await home.setScope(scope);
      for (const id of ['appearance', 'themes', 'wallpapers']) {
        await tab(id).click();
        assert.equal(await tab(id).getAttribute('aria-selected'), 'true');
        assert.equal(
          await page.locator('#settings-pane-' + id).isVisible(),
          true
        );
      }
    }
    // Back on: scoped tabs return and work.
    await tab('football').click();
    assert.equal(await tab('football').getAttribute('aria-selected'), 'true');
    assert.deepEqual(home.errors, [], edition + ' page errors');
    await home.close();
    console.log('PASS ' + edition);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
