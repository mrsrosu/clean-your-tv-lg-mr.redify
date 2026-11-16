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
  // Back to menu button (owner feedback): visible, pointer and remote reachable.
  const back = page.locator('#infoBack'),
    rowFocus = () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll('#infoPanel .info-tabs > *'))
          .map((b) => (b.classList.contains('focused') ? b.id || b.textContent : ''))
          .filter(Boolean)
      );
  assert.equal(await back.isVisible(), false, 'no button while closed');
  await info.click();
  assert.equal(await panel.isVisible(), true);
  assert.equal(await back.isVisible(), true, 'Back button visible');
  assert.equal((await back.innerText()).trim(), 'Back to menu');
  assert.equal(await back.locator('svg').count(), 1, 'arrow icon');
  assert.equal(
    await page.evaluate(
      () => document.querySelector('#infoPanel .info-tabs').firstElementChild.id
    ),
    'infoBack',
    'first item of the tab row'
  );
  await back.click();
  assert.equal(await panel.isVisible(), false, 'click on Back closes');
  assert.deepEqual(await topState(), { focused: true, open: false });
  // Remote: Up from the page reaches the button, Enter closes.
  await page.keyboard.press('Enter');
  assert.equal(await panel.isVisible(), true);
  assert.deepEqual(await rowFocus(), [], 'page focus first');
  await page.keyboard.press('ArrowUp');
  assert.deepEqual(await rowFocus(), ['infoBack'], 'Up reaches Back');
  await page.keyboard.press('Enter');
  assert.equal(await panel.isVisible(), false, 'Enter on Back closes');
  assert.deepEqual(await topState(), { focused: true, open: false });
  // Row navigation: Left/Right between Back and tabs, Enter switches page, Down returns to the page.
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowLeft');
  assert.deepEqual(await rowFocus(), ['infoBack'], 'Left stops at Back');
  assert.equal(await pageText(), 'page-calendar', 'row Left does not switch page');
  await page.keyboard.press('ArrowRight');
  assert.deepEqual(await rowFocus(), ['calendar']);
  await page.keyboard.press('ArrowRight');
  assert.deepEqual(await rowFocus(), ['finance']);
  await page.keyboard.press('Enter');
  assert.equal(await pageText(), 'page-finance', 'Enter on a tab switches page');
  assert.equal(await panel.isVisible(), true);
  await page.keyboard.press('ArrowDown');
  assert.deepEqual(await rowFocus(), [], 'Down returns to the page');
  await page.keyboard.press('ArrowRight');
  assert.equal(await pageText(), 'page-football', 'page keys work again');
  // Back / Esc still close from the row too, consumed.
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Escape');
  assert.equal(await panel.isVisible(), false, 'Esc closes from the row');
  assert.deepEqual(await topState(), { focused: true, open: false });
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowUp');
  const rowBack = await page.evaluate(() => {
    const ev = new KeyboardEvent('keydown', { keyCode: 461, bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  assert.equal(rowBack, true);
  assert.equal(await panel.isVisible(), false, 'Back closes from the row');
  // Reopened: row focus is not remembered.
  await page.keyboard.press('Enter');
  assert.deepEqual(await rowFocus(), []);
  await page.keyboard.press('Escape');
  // Scope off while open closes the panel and hides the button.
  await page.keyboard.press('Enter');
  assert.equal(await panel.isVisible(), true);
  await home.setScope(false);
  assert.equal(await panel.isVisible(), false, 'scope off closes');
  assert.equal(await info.isVisible(), false, 'button hidden');
  assert.equal(await page.evaluate(() => InfoPanel.isOpen()), false);
  assert.equal(await back.isVisible(), false, 'scope off: no Back button');
  await page.evaluate(() => InfoPanel.open());
  assert.equal(await back.isVisible(), false, 'scope off: open() is a no-op');
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
  // M4: labels are translated when rendered/opened (language known only after the scripts ran).
  const ro = await openHome({ mrRedify: true });
  await ro.page.evaluate(() => {
    localStorage.setItem('tvhome.language', 'ro');
    HomeI18n.refresh();
    InfoPanel.open();
  });
  const tabTexts = await ro.page
    .locator('#infoPanel .info-tab')
    .allInnerTexts();
  assert.ok(tabTexts.includes('Fotbal'), 'ro tab label: ' + tabTexts);
  assert.equal(
    await ro.page.locator('#btnInfo').getAttribute('aria-label'),
    'Informații'
  );
  assert.equal(await ro.page.locator('#btnInfo').getAttribute('title'), 'Informații');
  assert.equal(
    (await ro.page.locator('#infoBack').innerText()).trim(),
    'Înapoi la meniu'
  );
  await ro.page.evaluate(() => {
    InfoPanel.close();
    localStorage.removeItem('tvhome.language');
    HomeI18n.refresh();
  });
  await ro.close();
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
