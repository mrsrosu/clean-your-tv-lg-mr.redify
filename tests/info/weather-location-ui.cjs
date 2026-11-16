'use strict';
const assert = require('node:assert/strict'),
  { openHome } = require('./harness.cjs');
// HomeWeather.snapshot() also returns the location of the weather (saved or resolved), '' when unknown, no request.
(async () => {
  const home = await openHome({ mrRedify: true }),
    page = home.page;
  let requests = 0;
  page.on('request', (r) => {
    if (/^https?:/.test(r.url())) requests++;
  });
  // Without data there is no snapshot at all.
  assert.equal(await page.evaluate(() => HomeWeather.snapshot()), null);
  await page.context().addInitScript(() => {
    const place = { name: 'Bucharest', latitude: 44.4268, longitude: 26.1, country: 'Romania' };
    localStorage.setItem(
      'tvhome.weather.v1',
      JSON.stringify({
        version: 1,
        provider: 'open-meteo',
        enabled: true,
        mode: 'manual',
        location: place,
        caches: {
          'open-meteo': {
            key: '44.427,26.100',
            updated: Date.now(),
            data: { temp: 6, code: 61, isDay: true, timezone: 'Europe/Bucharest', offset: 7200, time: '2026-11-16T12:00', days: [{ date: '2026-11-16', low: 2, high: 7, code: 61 }] }
          }
        }
      })
    );
  });
  await page.reload();
  await page.waitForFunction(() => window.RootLauncherRendered && window.HomeInfo);
  const snap = await page.evaluate(() => HomeWeather.snapshot());
  assert.ok(snap, 'snapshot from the cached data');
  assert.equal(snap.temp, 6);
  assert.equal(snap.location, 'Bucharest');
  assert.equal(typeof snap.label, 'string');
  assert.equal(requests, 0, 'no request for the location');
  assert.deepEqual(home.errors, [], 'page errors');
  await home.close();
  console.log('PASS weather-location-ui');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
