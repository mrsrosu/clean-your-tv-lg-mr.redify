'use strict';
const assert = require('node:assert/strict'),
  { openHome } = require('./harness.cjs');
// Football logos on the page, in the Settings tab and in the main-page card: sizes, hosts, onerror, budget.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);
const ES = (n) => 'https://a.espncdn.com/i/teamlogos/soccer/500/' + n + '.png';
const DB = (n) => 'https://r2.thesportsdb.com/images/media/team/badge/' + n + '.png';
function match(id, state, home, away, start, hs, as, clock) {
  return {
    id,
    competition: 'eng.1',
    home: Object.assign({ score: hs === undefined ? null : hs }, home),
    away: Object.assign({ score: as === undefined ? null : as }, away),
    start,
    state,
    clock: clock || ''
  };
}
(async () => {
  const home = await openHome({ mrRedify: true }),
    page = home.page,
    seen = [];
  // Real answers for the logo hosts (the harness aborts every other http request).
  await page.route(/espncdn\.com|thesportsdb\.com|evil\.example/, (route) => {
    const url = route.request().url();
    seen.push(url);
    if (/evil\.example/.test(url) || /\/404\.png/.test(url) || /\/tiny$/.test(url))
      return route.fulfill({ status: 404, body: '' });
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
  });
  await page.evaluate(
    () => {
      const ES = (n) => 'https://a.espncdn.com/i/teamlogos/soccer/500/' + n + '.png',
        DB = (n) => 'https://r2.thesportsdb.com/images/media/team/badge/' + n + '.png';
      localStorage.clear();
      HomeFootball.setClock(() => new Date('2026-11-16T12:00:00Z'));
      const teams = [
        { competition: 'eng.1', id: '1', name: 'Arsenal' },
        { competition: 'eng.1', id: '3', name: 'Everton' }
      ];
      HomeInfo.football.set({ competitions: ['eng.1'], teams, landing: true });
      const board = [
        { id: 'm1', competition: 'eng.1', home: { id: '1', name: 'Arsenal', score: 2, logo: ES(1) }, away: { id: '2', name: 'Chelsea', score: 1, logo: DB('chel') }, start: '2026-11-16T11:00:00Z', state: 'in', clock: "34'" },
        { id: 'm2', competition: 'eng.1', home: { id: '3', name: 'Everton', score: null, logo: ES(3) }, away: { id: '4', name: 'Fulham', score: null, logo: 'https://evil.example/x.png' }, start: '2026-11-21T15:00:00Z', state: 'pre', clock: '' },
        { id: 'm3', competition: 'eng.1', home: { id: '5', name: 'Brighton', score: 0, logo: 'https://a.espncdn.com/i/404.png' }, away: { id: '6', name: 'Leeds', score: 3 }, start: '2026-11-16T14:00:00Z', state: 'pre', clock: '' }
      ];
      for (let i = 0; i < 30; i++)
        board.push({ id: 'x' + i, competition: 'eng.1', home: { id: 'h' + i, name: 'H' + i, score: null, logo: ES(100 + i) }, away: { id: 'a' + i, name: 'A' + i, score: null, logo: ES(200 + i) }, start: '2026-11-16T18:00:00Z', state: 'pre', clock: '' });
      localStorage.setItem('tvhome.football.snapshot.v1', JSON.stringify({ boards: { 'eng.1': board }, teams: {} }));
      HomeFootball.refresh = () => Promise.resolve({});
      const hero = document.getElementById('hero');
      hero.style.top = '1000px';
      document.getElementById('dockBand').style.top = '1000px';
      HomeLanding.render();
    }
  );
  await page.waitForTimeout(400);

  // Main-page card: only the logos that are valid; 24 px, no alt, explicit size.
  const card = await page.evaluate(() =>
    Array.prototype.map.call(document.querySelectorAll('#landingWidgets img'), (i) => ({
      w: i.getAttribute('width'),
      h: i.getAttribute('height'),
      alt: i.getAttribute('alt'),
      src: i.getAttribute('src')
    }))
  );
  assert.ok(card.length >= 2, 'logos in the card (the live match): ' + card.length);
  card.forEach((i) => {
    assert.equal(i.w, '30');
    assert.equal(i.h, '30');
    assert.equal(i.alt, '');
    assert.match(i.src, /^https:\/\/(a\.espncdn\.com|a1\.espncdn\.com|www\.thesportsdb\.com|r2\.thesportsdb\.com)\//);
  });
  // SportsDB: the sized rendition is asked first, the plain URL after its failure; it ends loaded.
  assert.ok(seen.some((u) => u === DB('chel') + '/tiny'), 'sized URL tried first');
  assert.ok(seen.some((u) => u === DB('chel')), 'plain URL as fallback');
  assert.equal(
    await page.evaluate(() =>
      Array.prototype.some.call(document.querySelectorAll('#landingWidgets img'), (i) => /chel\.png$/.test(i.src) && i.complete && i.naturalWidth > 0)
    ),
    true,
    'fallback image loaded'
  );
  // A host that is not allowed is never requested; no broken image stays in the DOM.
  assert.equal(seen.some((u) => /evil\.example/.test(u)), false, 'evil host never requested');
  await page.waitForTimeout(300);
  assert.equal(
    await page.evaluate(() =>
      Array.prototype.every.call(document.querySelectorAll('#landingWidgets img'), (i) => i.complete && i.naturalWidth > 0)
    ),
    true,
    'every remaining image loaded'
  );
  // onerror: the 404 logo (both URLs fail) removed itself.
  assert.equal(
    await page.evaluate(() => Array.prototype.some.call(document.querySelectorAll('img'), (i) => /\/404\.png/.test(i.src))),
    false
  );

  // logoNode: validation is repeated (cached data is not trusted), sizes explicit.
  const nodes = await page.evaluate(() => ({
    bad: ['http://a.espncdn.com/x.png', 'https://evil.example/x.png', 'javascript:alert(1)', '', null, 7].map((u) => HomeFootball.logoNode(u, 24)),
    good: (() => {
      const n = HomeFootball.logoNode('https://a.espncdn.com/i/x.png', 40);
      return { w: n.width, h: n.height, alt: n.alt, cls: n.className };
    })()
  }));
  assert.deepEqual(nodes.bad, [null, null, null, null, null, null]);
  assert.deepEqual(nodes.good, { w: 40, h: 40, alt: '', cls: 'fb-logo' });

  // Page: open the football page of the info panel.
  await page.evaluate(() => {
    InfoPanel.open();
  });
  await page.locator('#infoPanel .info-tab', { hasText: 'Football' }).click();
  await page.waitForTimeout(300);
  const pageImgs = await page.evaluate(() => ({
    all: document.querySelectorAll('.fb-page img').length,
    head: Array.prototype.map.call(document.querySelectorAll('.fb-page .fb-team-name img'), (i) => i.width),
    next: Array.prototype.map.call(document.querySelectorAll('.fb-page .fb-next img'), (i) => i.width),
    rows: Array.prototype.map.call(document.querySelectorAll('.fb-page .fb-match img'), (i) => i.width),
    text: document.querySelector('.fb-page .fb-home') ? document.querySelector('.fb-page .fb-home').textContent : ''
  }));
  assert.ok(pageImgs.all > 0 && pageImgs.all <= 40, 'at most 40 images on the page: ' + pageImgs.all);
  assert.ok(pageImgs.head.every((w) => w === 28) && pageImgs.head.length >= 1, 'team header logos 28 px');
  assert.ok(pageImgs.next.length >= 1 && pageImgs.next.every((w) => w === 40), 'next-match logos about 40 px');
  assert.ok(pageImgs.rows.length >= 1 && pageImgs.rows.every((w) => w === 28), 'row logos 28 px');
  assert.ok(!/\bimg\b/.test(pageImgs.text) && pageImgs.text.length > 0, 'names stay plain text');
  await page.evaluate(() => InfoPanel.close());

  // Tab: followed chips and picker chips carry logos from the cached team list; images are bounded.
  await page.evaluate(
    () => {
      const ES = (n) => 'https://a.espncdn.com/i/teamlogos/soccer/500/' + n + '.png',
        list = [];
      for (let i = 0; i < 60; i++) list.push({ id: 't' + i, name: 'Team ' + i, logo: ES(300 + i) });
      localStorage.setItem('tvhome.cache.v1.fb.teams.eng.1', JSON.stringify({ value: list, fetchedAt: Date.now() }));
      RenewalPanel.open();
    }
  );
  await page.locator('[data-category="football"]').click();
  await page.locator('#settings-pane-football').focus().catch(() => {});
  await page.evaluate(() => document.querySelector('#settings-pane-football button').focus());
  await page.waitForTimeout(400);
  const tab = await page.evaluate(() => ({
    n: document.querySelectorAll('#settings-pane-football img').length,
    sizes: Array.prototype.map.call(document.querySelectorAll('#settings-pane-football img'), (i) => i.width),
    chips: document.querySelectorAll('#settings-pane-football .fb-team-chip').length,
    followed: document.querySelectorAll('#settings-pane-football .fb-followed img').length
  }));
  assert.ok(tab.chips >= 50, 'picker chips: ' + tab.chips);
  assert.ok(tab.n > 0 && tab.n <= 40, 'at most 40 logos in the tab: ' + tab.n);
  assert.ok(tab.sizes.every((w) => w === 24));
  assert.ok(tab.followed >= 1, 'followed team chip shows its logo (from the snapshot)');
  await page.evaluate(() => document.getElementById('renewalClose').click());

  // Only URL strings are stored; no image data anywhere in localStorage.
  assert.equal(
    await page.evaluate(() => {
      let bad = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const v = localStorage.getItem(localStorage.key(i));
        if (/data:image|base64,iVBOR/.test(v)) bad++;
      }
      return bad;
    }),
    0
  );
  assert.deepEqual(home.errors, [], 'page errors');
  await home.close();
  console.log('PASS logos-ui');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
