'use strict';
const assert = require('node:assert/strict'),
  { openHome } = require('./harness.cjs');
// Header button + full-screen info panel, scoped to the mr.redify theme.
(async () => {
  const home = await openHome({ mrRedify: true }),
    page = home.page,
    info = page.locator('#btnInfo'),
    panel = page.locator('#infoPanel');
  await page.evaluate(() => {
    // The real calendar, rates and football pages are registered first; keep their slots but make them plain pages here.
    ['calendar', 'finance', 'football', 'one', 'two'].forEach((id) =>
      InfoPanel.registerPage({
        id,
        label: id,
        render(c) {
          c.textContent = 'page-' + id;
          window['__shown_' + id] = 0;
        },
        onShow() {
          window['__shown_' + id]++;
        },
        onHide() {
          window['__hidden_' + id] = true;
        }
      })
    );
  });
  const topState = () =>
    page.evaluate(() => ({
      focused: document.getElementById('btnInfo').classList.contains('focused'),
      open: InfoPanel.isOpen()
    }));
  const pageText = () =>
    page.evaluate(() => {
      const v = document.querySelector('#infoPanel .info-page:not([hidden])');
      return v ? v.textContent : '';
    });
  // On: visible, icon only, last header button.
  assert.equal(await info.isVisible(), true, 'button visible');
  assert.equal((await info.innerText()).trim(), '', 'icon only');
  assert.equal(
    await page.evaluate(
      () => document.getElementById('topButtons').lastElementChild.id
    ),
    'btnInfo'
  );
  assert.equal(await panel.isVisible(), false);
  // Focus the header from the grid: Up from the first tile reaches a top button.
  await page.keyboard.press('ArrowUp');
  let guard = 0;
  while (!(await topState()).focused && guard++ < 6)
    await page.keyboard.press('ArrowRight');
  assert.equal((await topState()).focused, true, 'arrows reach Info');
  // OK opens.
  await page.keyboard.press('Enter');
  assert.equal(await panel.isVisible(), true, 'panel open');
  assert.equal(await pageText(), 'page-calendar');
  await page.keyboard.press('ArrowRight');
  assert.equal(await pageText(), 'page-finance');
  await page.keyboard.press('ArrowRight');
  assert.equal(await pageText(), 'page-football');
  await page.keyboard.press('ArrowRight');
  assert.equal(await pageText(), 'page-one');
  assert.equal(await page.evaluate(() => window.__shown_one), 1);
  await page.keyboard.press('ArrowRight');
  assert.equal(await pageText(), 'page-two');
  assert.equal(await page.evaluate(() => window.__hidden_one), true);
  await page.keyboard.press('ArrowRight');
  assert.equal(await pageText(), 'page-two', 'no wrap past last page');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await pageText(), 'page-one');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await pageText(), 'page-football');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await pageText(), 'page-finance');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await pageText(), 'page-calendar');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await pageText(), 'page-calendar', 'no wrap before first page');
  // Back closes, focus returns to the button, Home is not exited.
  // A consumed Back never reaches Home's own handler, which is what would let the OS exit it.
  const backConsumed = await page.evaluate(() => {
    const ev = new KeyboardEvent('keydown', {
      keyCode: 461,
      bubbles: true,
      cancelable: true
    });
    document.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  assert.equal(await panel.isVisible(), false, 'Back closes');
  assert.deepEqual(await topState(), { focused: true, open: false });
  assert.equal(backConsumed, true, 'Back consumed');
  assert.equal(await page.evaluate(() => RenewalPanel.isOpen()), false);
  // Pointer: click on the button opens, click again... Back closes.
  await info.click();
  assert.equal(await panel.isVisible(), true, 'click opens');
  await page.keyboard.press('Escape');
  assert.equal(await panel.isVisible(), false);
  // Scope off while open closes the panel and hides the button.
  await page.keyboard.press('Enter');
  assert.equal(await panel.isVisible(), true);
  await home.setScope(false);
  assert.equal(await panel.isVisible(), false, 'scope off closes');
  assert.equal(await info.isVisible(), false, 'button hidden');
  assert.equal(await page.evaluate(() => InfoPanel.isOpen()), false);
  // Off: arrows never land on it, even from Settings.
  await page.keyboard.press('ArrowUp');
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('ArrowRight');
    assert.equal((await topState()).focused, false, 'never focus hidden Info');
  }
  assert.equal(
    await page.evaluate(() =>
      document.getElementById('btnSettings').classList.contains('focused')
    ),
    true,
    'stops on Settings'
  );
  // Back on: button returns; with no pages the panel shows an empty message.
  await home.setScope(true);
  assert.equal(await info.isVisible(), true);
  assert.deepEqual(home.errors, [], 'page errors');
  await home.close();
  // Fresh page: only the built-in pages are registered; the panel opens on it.
  const empty = await openHome({ mrRedify: true });
  await empty.page.evaluate(() => InfoPanel.open());
  assert.equal(await empty.page.locator('#infoPanel').isVisible(), true);
  assert.ok(
    (await empty.page.locator('#infoPanel').innerText()).trim().length > 0
  );
  await empty.page.evaluate(() => InfoPanel.close());
  assert.deepEqual(empty.errors, [], 'empty page errors');
  await empty.close();
  // Root edition: the panel never opens and the button stays hidden, even with the theme class on.
  const rootHome = await openHome({ mrRedify: true, edition: 'root-launcher' });
  await rootHome.page.evaluate(() => InfoPanel.open());
  assert.equal(
    await rootHome.page.evaluate(() => InfoPanel.isOpen()),
    false,
    'root: panel does not open'
  );
  assert.equal(await rootHome.page.locator('#btnInfo').isVisible(), false);
  assert.deepEqual(rootHome.errors, [], 'root page errors');
  await rootHome.close();
  console.log('PASS panel');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
