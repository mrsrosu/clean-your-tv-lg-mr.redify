'use strict';
const assert = require('node:assert/strict'),
  { openHome } = require('./harness.cjs');
// Romania national team (ESPN 473, competition group "nat"): picker in the Football tab, page, main-page card, Romanian label.
(async () => {
  const home = await openHome({ mrRedify: true }),
    page = home.page;
  await page.evaluate(() => {
    localStorage.clear();
    HomeFootball.setClock(() => new Date('2026-11-16T12:00:00Z'));
    HomeFootball.refresh = () => Promise.resolve({});
    HomeInfo.football.set({ landing: true });
  });
  // Tab: the group is a chip like the leagues; ticking it lists Romania, picking follows it (counts towards the 5).
  await page.evaluate(() => RenewalPanel.open());
  await page.locator('[data-category="football"]').click();
  const pane = page.locator('#settings-pane-football');
  await page.evaluate(() => document.querySelector('#settings-pane-football button').focus());
  const chip = pane.locator('.fb-comp-chip', { hasText: 'National teams' });
  assert.equal(await chip.count(), 1, 'National teams chip');
  await chip.click();
  assert.deepEqual(await page.evaluate(() => HomeInfo.football.get().competitions), ['nat']);
  await pane.locator('.fb-team-chip', { hasText: 'Romania' }).waitFor({ timeout: 4000 });
  assert.equal(await pane.locator('.fb-team-chip').count(), 1, 'only Romania in the group');
  assert.match(await pane.innerText(), /National teams/);
  await pane.locator('.fb-team-chip', { hasText: 'Romania' }).click();
  assert.deepEqual(await page.evaluate(() => HomeInfo.football.get().teams), [{ competition: 'nat', id: '473', name: 'Romania' }]);
  assert.equal(await pane.locator('.fb-followed').count(), 1);
  // Four more teams still fit; a sixth does not.
  await page.evaluate(() => {
    const t = (i) => ({ competition: 'eng.1', id: String(i), name: 'T' + i });
    HomeInfo.football.set({ teams: [HomeInfo.football.get().teams[0], t(1), t(2), t(3), t(4), t(5)] });
  });
  assert.equal(await page.evaluate(() => HomeInfo.football.get().teams.length), 5);
  assert.equal(await page.evaluate(() => HomeInfo.football.get().teams[0].competition), 'nat');
  await page.evaluate(() => {
    HomeInfo.football.set({ teams: [{ competition: 'nat', id: '473', name: 'Romania' }] });
    document.getElementById('renewalClose').click();
  });

  // Page and card with a Romania match in the snapshot (and a team without any matches: graceful).
  await page.evaluate(() => {
    const logo = 'https://a.espncdn.com/i/teamlogos/countries/500/rou.png',
      ro = { id: '473', name: 'Romania', score: null, logo };
    const m = (id, state, home, away, start, hs, as) => ({
      id, competition: 'nat', state, clock: '', start,
      home: Object.assign({}, home, { score: hs === undefined ? null : hs }),
      away: Object.assign({}, away, { score: as === undefined ? null : as })
    });
    localStorage.setItem(
      'tvhome.football.snapshot.v1',
      JSON.stringify({
        boards: {},
        teams: {
          'nat:473': [
            m('n1', 'post', ro, { id: '578', name: 'Wales' }, '2026-06-06T16:00:00Z', 1, 1),
            m('n4', 'pre', { id: '482', name: 'Bosnia' }, ro, '2026-11-20T19:45:00Z')
          ]
        }
      })
    );
    document.getElementById('hero').style.top = '1000px';
    document.getElementById('dockBand').style.top = '1000px';
    HomeLanding.render();
  });
  const card = await page.evaluate(() => document.querySelector('#landingWidgets [data-lw="football"]').textContent);
  assert.match(card, /Bosnia/);
  assert.match(card, /Romania/);
  assert.match(card, /20\.11 \d\d:\d\d/);
  await page.evaluate(() => InfoPanel.open());
  await page.locator('#infoPanel .info-tab', { hasText: 'Football' }).click();
  const pg = await page.locator('.fb-page').innerText();
  assert.match(pg, /Romania/);
  assert.match(pg, /Wales/);
  assert.match(pg, /Bosnia – Romania/);
  assert.ok((await page.locator('.fb-page .fb-team-name').first().innerText()).includes('Romania'));
  await page.evaluate(() => InfoPanel.close());
  // A team without matches: "No matches found", no error.
  await page.evaluate(() => {
    HomeInfo.football.set({ teams: [{ competition: 'nat', id: '999', name: 'Nowhere' }] });
    HomeLanding.render();
  });
  assert.equal(await page.evaluate(() => HomeLanding.state().cards.indexOf('football')), -1, 'no data: no card');
  await page.evaluate(() => InfoPanel.open());
  await page.locator('#infoPanel .info-tab', { hasText: 'Football' }).click();
  assert.match(await page.locator('.fb-page').innerText(), /No matches found/);
  await page.evaluate(() => InfoPanel.close());

  // Romanian UI: display name România, group name Echipe naționale; the stored name stays ESPN's.
  await page.evaluate(() => {
    localStorage.setItem('tvhome.language', 'ro');
    HomeI18n.refresh();
  });
  assert.equal(await page.evaluate(() => HomeFootball.label('Romania')), 'România');
  assert.equal(await page.evaluate(() => HomeFootball.label('Wales')), 'Wales');
  assert.equal(await page.evaluate(() => HomeI18n.t('National teams')), 'Echipe naționale');
  await page.evaluate(() => RenewalPanel.open());
  await page.locator('[data-category="football"]').click();
  await page.evaluate(() => document.querySelector('#settings-pane-football button').focus());
  await pane.locator('.fb-landing').click(); // the tab redraws (its text is read when it draws)
  await pane.locator('.fb-landing').click();
  await page.waitForTimeout(300);
  assert.match(await pane.innerText(), /Echipe naționale/);
  assert.match(await pane.innerText(), /România/);
  await page.evaluate(() => HomeInfo.football.set({ teams: [{ competition: 'nat', id: '473', name: 'Romania' }] }));
  assert.equal(await page.evaluate(() => HomeInfo.football.get().teams[0].name), 'Romania', 'stored name unchanged');
  assert.deepEqual(home.errors, [], 'page errors');
  await home.close();
  console.log('PASS national-ui');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
