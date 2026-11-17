'use strict';
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  { openHome } = require('./harness.cjs');
const xml = fs.readFileSync('tests/info/fixtures/nbrfxrates.xml', 'utf8'),
  fixtureDate = /<PublishingDate>([^<]+)</.exec(xml)[1];
// Exchange rates page (info panel) and the Rates & holidays tab, mr.redify scope, service bridge faked.
(async () => {
  const home = await openHome({ mrRedify: true }),
    page = home.page;
  const setup = (reply, seed) =>
    page.evaluate(
      ([reply, seed]) => {
        InfoPanel.close();
        ['tvhome.finance.v1', 'tvhome.daily.v1', 'tvhome.cache.v1.bnr', 'tvhome.bnr.sched.v1'].forEach(
          (k) => localStorage.removeItem(k)
        );
        if (seed) localStorage.setItem(seed[0], seed[1]);
        // The schedule runs on a fixed instant: Monday 16.11.2026 18:00 Romanian time (after both slots of the fixture day).
        HomeInfoFinance.setClock(() => Date.parse('2026-11-16T16:00:00Z'));
        window.__calls = [];
        window.__reply = reply;
        if (reply !== 'absent') {
          window.PalmServiceBridge = function () {
            this.cancel = function () {};
            this.call = (url, payload) => {
              window.__calls.push([url, payload]);
              setTimeout(() => this.onservicecallback(window.__reply), 0);
            };
          };
        } else delete window.PalmServiceBridge;
      },
      [reply, seed || null]
    );
  const good = JSON.stringify({ returnValue: true, xml }),
    openRates = async () => {
      await page.evaluate(() => InfoPanel.open());
      await page
        .locator('#infoPanel .info-tab', { hasText: 'Exchange rates' })
        .click();
    },
    rows = () =>
      page
        .locator('#infoPanel .fin-row')
        .evaluateAll((els) =>
          els.map((e) => e.innerText.replace(/\s+/g, ' ').trim())
        ),
    text = () => page.locator('#infoPanel .fin-page').innerText();

  // 1. Chosen currencies with the date, no arrows without a previous day.
  await setup(good);
  await openRates();
  await page.waitForSelector('#infoPanel .fin-row');
  const r1 = await rows();
  assert.equal(r1.length, 4);
  assert.match(r1[0], /^EUR 5\.3494 RON/);
  assert.match(r1[1], /^USD 4\.8600 RON/);
  assert.match(await text(), new RegExp(fixtureDate));
  assert.equal(
    await page
      .locator('#infoPanel .fin-arrow.up, #infoPanel .fin-arrow.down')
      .count(),
    0
  );
  assert.equal(
    await page.evaluate(() => window.__calls[0][0]),
    'luna://com.gathin.tvhome.renewal/bnrRates'
  );
  assert.doesNotMatch(await text(), /update required|Offline/i);

  // 2. Arrows against the previous published day (seeded current becomes previous).
  const old = JSON.stringify({
    currencies: ['EUR', 'USD', 'GBP', 'CHF'],
    current: {
      date: '2026-11-13',
      rates: {
        EUR: { value: 5.3, multiplier: 1 },
        USD: { value: 4.9, multiplier: 1 },
        GBP: { value: 6.4103, multiplier: 1 }
      }
    },
    previous: null
  });
  await setup(good, ['tvhome.finance.v1', old]);
  await openRates();
  await page.waitForSelector('#infoPanel .fin-arrow.up');
  const a = await page
    .locator('#infoPanel .fin-row')
    .evaluateAll((els) =>
      els.map((e) => e.querySelector('.fin-arrow').className)
    );
  assert.match(a[0], /up/);
  assert.match(a[1], /down/);
  assert.doesNotMatch(a[2] + a[3], /up|down/, 'equal / no previous: no arrow');
  assert.equal(
    await page.evaluate(() => HomeInfo.finance.get().previous.date),
    '2026-11-13'
  );

  // 3. Multiplier shown as such.
  await page.evaluate(() => HomeInfo.finance.set({ currencies: ['HUF'] }));
  await page.evaluate(() => {
    InfoPanel.close();
    InfoPanel.open();
  });
  await page
    .locator('#infoPanel .info-tab', { hasText: 'Exchange rates' })
    .click();
  await page.waitForSelector('#infoPanel .fin-row');
  assert.match((await rows())[0], /^HUF 100 = 1\.4662 RON/);

  // 4. Service without bnrRates: message, no values, never throws.
  for (const reply of [
    JSON.stringify({
      returnValue: false,
      errorCode: -1,
      errorText: 'Unknown method "bnrRates"'
    }),
    'absent'
  ]) {
    await setup(reply);
    await openRates();
    await page.waitForFunction(() =>
      /update required/i.test(
        document.querySelector('#infoPanel .fin-page').innerText
      )
    );
    assert.equal(await page.locator('#infoPanel .fin-row').count(), 0);
  }
  // Root edition: the info panel stays closed (scope off) and the transport still makes no bnrRates call.
  await setup(good);
  await page.evaluate(() => {
    InfoPanel.close();
    localStorage.removeItem('tvhome.cache.v1.bnr');
    window.ROOT_VERSION = '1';
  });
  await page.evaluate(() => InfoPanel.open());
  assert.equal(await page.evaluate(() => InfoPanel.isOpen()), false);
  assert.equal(
    await page.evaluate(() => HomeInfoFinance.refresh().then((r) => r.state)),
    'update-required'
  );
  assert.equal(
    await page.evaluate(
      () => window.__calls.filter((c) => /bnrRates/.test(c[0])).length
    ),
    0
  );
  await page.evaluate(() => delete window.ROOT_VERSION);

  // 5. Offline with a cache: values and "last updated".
  await setup(
    JSON.stringify({ returnValue: false, errorCode: 'bnr-network-error' }),
    [
      'tvhome.cache.v1.bnr',
      JSON.stringify({ value: xml, fetchedAt: Date.now() - 5 * 3600000 })
    ]
  );
  await openRates();
  await page.waitForFunction(() =>
    /Last updated/.test(
      document.querySelector('#infoPanel .fin-page').innerText
    )
  );
  assert.equal((await rows()).length, 4);
  assert.match(await text(), /Offline/);
  // Offline without cache: neutral message.
  await setup(JSON.stringify({ returnValue: false, errorCode: 'bnr-timeout' }));
  await openRates();
  await page.waitForFunction(() =>
    /unavailable/i.test(
      document.querySelector('#infoPanel .fin-page').innerText
    )
  );

  // 6. Keys fall through to the panel; the (cheap, schedule-checking) 60 s timer exists only while the page is shown.
  await setup(good);
  await page.evaluate(() => {
    window.__live = 0;
    const set = window.setInterval,
      clear = window.clearInterval;
    window.__ids = {};
    window.setInterval = function (fn, ms) {
      const id = set.call(window, fn, ms);
      if (ms === 60000) {
        window.__ids[id] = true;
        window.__live++;
      }
      return id;
    };
    window.clearInterval = function (id) {
      if (window.__ids[id]) {
        delete window.__ids[id];
        window.__live--;
      }
      return clear.call(window, id);
    };
  });
  await openRates();
  assert.equal(
    await page.evaluate(() => window.__live),
    1,
    'timer while shown'
  );
  await page.keyboard.press('ArrowLeft');
  assert.equal(
    await page.locator('#infoPanel .cal-grid').isVisible(),
    true,
    'back to the calendar'
  );
  assert.equal(
    await page.evaluate(() => window.__live),
    0,
    'no timer once hidden'
  );
  await page
    .locator('#infoPanel .info-tab', { hasText: 'Exchange rates' })
    .click();
  assert.equal(await page.evaluate(() => window.__live), 1);
  await page.evaluate(() => InfoPanel.close());
  assert.equal(
    await page.evaluate(() => window.__live),
    0,
    'no timer once closed'
  );

  // 7. Tab: toggles and currency choice.
  await setup(good);
  await page.evaluate(() => RenewalPanel.open());
  await page.locator('[data-category="daily"]').click();
  const pane = page.locator('#settings-pane-daily');
  assert.equal(await pane.isVisible(), true);
  assert.equal(
    await pane.locator('.fin-toggle').count(),
    4, // Rates + Name day landing toggles, holidays, name days
    'real tab, not placeholder'
  );
  assert.equal(
    await page.evaluate(
      () => window.__calls.filter((c) => /bnrRates/.test(c[0])).length
    ),
    0,
    'nothing fetched before focus'
  );
  await pane.locator('.fin-toggle').first().focus();
  await page.waitForFunction(
    () =>
      document.querySelectorAll('#settings-pane-daily .fin-chip').length > 20
  );
  assert.equal(
    await page.evaluate(() => HomeInfo.daily.get().showHolidays),
    true
  );
  await pane.locator('.fin-toggle-showHolidays').click();
  await pane.locator('.fin-toggle-showNameDays').click();
  assert.deepEqual(
    await page.evaluate(() => {
      const d = HomeInfo.daily.get();
      return [d.showHolidays, d.showNameDays];
    }),
    [false, false]
  );
  assert.equal(
    await pane.locator('.fin-toggle-showHolidays').getAttribute('aria-pressed'),
    'false'
  );
  const chip = (c) =>
    pane.locator('.fin-chip', { hasText: new RegExp('^' + c + '$') });
  assert.equal(await chip('EUR').getAttribute('aria-pressed'), 'true');
  assert.equal(await chip('JPY').getAttribute('aria-pressed'), 'false');
  await chip('JPY').click();
  assert.deepEqual(
    await page.evaluate(() => HomeInfo.finance.get().currencies),
    ['EUR', 'USD', 'GBP', 'CHF', 'JPY']
  );
  await chip('EUR').click();
  assert.equal(
    await page.evaluate(() =>
      HomeInfo.finance.get().currencies.includes('EUR')
    ),
    false
  );
  for (const c of ['AUD', 'CAD', 'CZK', 'DKK']) await chip(c).click();
  assert.equal(
    await page.evaluate(() => HomeInfo.finance.get().currencies.length),
    8
  );
  await chip('PLN').click();
  assert.equal(
    await page.evaluate(() => HomeInfo.finance.get().currencies.length),
    8,
    'limit 8'
  );
  assert.match(await pane.locator('.fin-status').innerText(), /At most 8/);
  // Never below one currency.
  for (const c of ['USD', 'GBP', 'CHF', 'JPY', 'AUD', 'CAD', 'CZK', 'DKK'])
    await chip(c).click();
  assert.deepEqual(
    await page.evaluate(() => HomeInfo.finance.get().currencies),
    ['DKK']
  );
  assert.match(await pane.locator('.fin-status').innerText(), /at least one/);
  // Chip keeps focus after a toggle (remote navigation).
  assert.equal(
    await page.evaluate(() =>
      document.activeElement.className.includes('fin-chip')
    ),
    true
  );

  // 8. Tab hint when the service is not available; default four codes without data.
  await setup(JSON.stringify({ returnValue: false, errorCode: -1 }));
  await page.evaluate(() => RenewalPanel.close && RenewalPanel.close());
  await page.evaluate(() => RenewalPanel.open());
  await page.locator('[data-category="daily"]').click();
  await page.locator('[data-category="home"]').click();
  await page.locator('[data-category="daily"]').click();
  await pane.locator('.fin-toggle').first().focus();
  await page.waitForFunction(() =>
    /update required/i.test(
      document.querySelector('#settings-pane-daily .fin-hint').innerText
    )
  );
  assert.equal(await pane.locator('.fin-chip').count(), 4);
  // Corrupt store: defaults.
  await setup(good, [
    'tvhome.finance.v1',
    '{"currencies":["xx"],"current":{"date":1}}'
  ]);
  assert.deepEqual(await page.evaluate(() => HomeInfo.finance.get()), {
    currencies: ['EUR', 'USD', 'GBP', 'CHF'],
    current: null,
    previous: null,
    landing: false
  });

  assert.deepEqual(home.errors, [], 'no page errors');
  await home.close();
  console.log('PASS finance-ui');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
