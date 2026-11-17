const strict = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm');
const assert = Object.assign((v, m) => strict(v, m), strict, {
  deepEqual: (a, b) => strict.deepEqual(JSON.parse(JSON.stringify(a)), b)
});
const xml = fs.readFileSync('tests/info/fixtures/nbrfxrates.xml', 'utf8');
const fixtureDate = /<PublishingDate>([^<]+)<\/PublishingDate>/.exec(xml)[1],
  fixtureEur = Number(/currency="EUR">([^<]+)</.exec(xml)[1]);
// info-store.js + info-fetch.js + finance.js in a bare context (no DOM).
function memory(seed) {
  const data = Object.assign({}, seed);
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem(k, v) {
      data[k] = String(v);
    }
  };
}
function context(storage, extra) {
  const on = !!(extra && extra.mrRedify),
    surface = { classList: { contains: (c) => on && c === 'ctv-mr-redify' } },
    document = {
      getElementById: () => surface,
      addEventListener() {},
      readyState: 'complete'
    },
    ctx = Object.assign(
      {
        document,
        localStorage: storage,
        Promise,
        XMLHttpRequest: function () {}
      },
      extra || {}
    );
  ctx.window = ctx;
  for (const f of ['info-store', 'info-fetch', 'ro-calendar-data', 'finance'])
    vm.runInNewContext(fs.readFileSync('launcher/' + f + '.js', 'utf8'), ctx);
  return ctx;
}
const tests = [];
function test(name, fn) {
  tests.push([name, fn]);
}
const rate = (v, m) => ({ value: v, multiplier: m || 1 });
const day = (date, eur) => ({
  date,
  rates: { EUR: rate(eur), USD: rate(4.86), HUF: rate(1.4662, 100) }
});

test('parse(fixture): date, EUR value, HUF multiplier', () => {
  const p = context(memory()).HomeInfoFinance.parse(xml);
  assert.equal(p.date, fixtureDate);
  assert.equal(p.rates.EUR.value, fixtureEur);
  assert.equal(p.rates.EUR.multiplier, 1);
  assert.equal(p.rates.HUF.multiplier, 100);
  assert.equal(p.rates.USD.value, 4.86);
  assert.ok(Object.keys(p.rates).length > 20);
});
test('parse throws on invalid input', () => {
  const F = context(memory()).HomeInfoFinance;
  for (const bad of [
    '',
    'hello',
    '{"a":1}',
    null,
    undefined,
    42,
    '<DataSet></DataSet>',
    '<DataSet><Header><PublishingDate>x</PublishingDate></Header></DataSet>',
    '<DataSet><Header><PublishingDate>2026-01-02</PublishingDate></Header><Body><Cube date="2026-01-02"></Cube></Body></DataSet>'
  ])
    assert.throws(() => F.parse(bad), undefined, String(bad));
});
test('parse drops malformed rates, keeps valid ones', () => {
  const F = context(memory()).HomeInfoFinance,
    p = F.parse(
      '<DataSet><Header><PublishingDate>2026-01-02</PublishingDate></Header><Body><Cube date="2026-01-02">' +
        '<Rate currency="EUR">5.0</Rate><Rate currency="usd">4</Rate><Rate currency="GBP">abc</Rate>' +
        '<Rate currency="CHF" multiplier="0">1</Rate><Rate currency="HUF" multiplier="100">1.5</Rate><Rate currency="JPY">-1</Rate>' +
        '</Cube></Body></DataSet>'
    );
  assert.deepEqual(Object.keys(p.rates).sort(), ['EUR', 'HUF']);
  assert.equal(p.rates.HUF.multiplier, 100);
});
test('store defaults and currency sanitize', () => {
  const mem = memory(),
    I = context(mem).HomeInfo;
  assert.deepEqual(I.finance.get(), {
    currencies: ['EUR', 'USD', 'GBP', 'CHF'],
    current: null,
    previous: null,
    landing: false
  });
  I.finance.set({ currencies: ['EUR', 'eur', 'USD', 'ab', 'ABCD', 7, 'GBP'] });
  assert.deepEqual(I.finance.get().currencies, ['EUR', 'USD', 'GBP']);
  I.finance.set({ currencies: [] });
  assert.deepEqual(
    I.finance.get().currencies,
    ['EUR', 'USD', 'GBP'],
    'empty rejected'
  );
  I.finance.set({ currencies: 'EUR' });
  assert.deepEqual(I.finance.get().currencies, ['EUR', 'USD', 'GBP']);
  const nine = 'ABCDEFGHI'.split('').map((c) => c + 'XX');
  I.finance.set({ currencies: nine });
  assert.equal(I.finance.get().currencies.length, 8, 'at most 8');
  assert.ok(mem.data['tvhome.finance.v1']);
});
test('store sanitizes current and previous', () => {
  const I = context(memory()).HomeInfo;
  I.finance.set({ current: day('2026-11-16', 5.3) });
  assert.equal(I.finance.get().current.rates.EUR.value, 5.3);
  I.finance.set({ current: { date: 'bad', rates: {} } });
  assert.equal(I.finance.get().current.date, '2026-11-16', 'bad one rejected');
  I.finance.set({
    previous: { date: '2026-11-13', rates: { EUR: { value: 'x' } } }
  });
  assert.equal(I.finance.get().previous, null);
  I.finance.set({ current: null });
  assert.equal(I.finance.get().current, null);
});
test('rotation: new date moves current to previous, same date keeps previous', () => {
  const ctx = context(memory()),
    F = ctx.HomeInfoFinance,
    I = ctx.HomeInfo;
  F.ingest(day('2026-11-12', 5.1));
  assert.equal(I.finance.get().current.date, '2026-11-12');
  assert.equal(I.finance.get().previous, null);
  F.ingest(day('2026-11-13', 5.2));
  assert.equal(I.finance.get().previous.date, '2026-11-12');
  assert.equal(I.finance.get().previous.rates.EUR.value, 5.1);
  F.ingest(day('2026-11-13', 5.25)); // republished the same day
  assert.equal(I.finance.get().previous.date, '2026-11-12');
  assert.equal(I.finance.get().current.rates.EUR.value, 5.25);
  F.ingest(day('2026-11-16', 5.3));
  assert.equal(I.finance.get().previous.date, '2026-11-13');
  assert.equal(I.finance.get().previous.rates.EUR.value, 5.25);
  F.ingest(day('2026-11-10', 9)); // older than current: ignored
  assert.equal(I.finance.get().current.date, '2026-11-16');
});
test('idleLines: one short line per chosen currency, [] without data', () => {
  const ctx = context(memory()),
    F = ctx.HomeInfoFinance;
  assert.deepEqual(F.idleLines(), []);
  F.ingest(ctx.HomeInfoFinance.parse(xml));
  const lines = F.idleLines();
  assert.equal(lines.length, 4);
  assert.equal(lines[0], 'EUR ' + fixtureEur.toFixed(3));
  ctx.HomeInfo.finance.set({ currencies: ['HUF', 'XXX'] });
  assert.deepEqual(F.idleLines(), ['100 HUF 1.466']);
});
test('arrows against previous, only when previous exists', () => {
  const ctx = context(memory()),
    F = ctx.HomeInfoFinance;
  F.ingest(day('2026-11-12', 5.1));
  assert.equal(F.trend('EUR'), 0, 'no previous');
  F.ingest({
    date: '2026-11-13',
    rates: { EUR: rate(5.2), USD: rate(4.8), HUF: rate(1.4662, 100) }
  });
  assert.equal(F.trend('EUR'), 1);
  assert.equal(F.trend('USD'), -1);
  assert.equal(F.trend('HUF'), 0);
  assert.equal(F.trend('ZZZ'), 0);
});
// Fake bridge: replies with a canned raw string.
function bridgeContext(mem, reply, root) {
  const calls = [];
  function Bridge() {}
  Bridge.prototype.call = function (url, payload) {
    calls.push({ url, payload });
    const self = this;
    if (reply === 'throw') throw new Error('private');
    if (reply !== 'silent')
      Promise.resolve().then(() => self.onservicecallback(reply));
  };
  Bridge.prototype.cancel = function () {};
  const ctx = context(mem, {
    PalmServiceBridge: Bridge,
    setTimeout,
    clearTimeout,
    ROOT_VERSION: root ? '1' : undefined
  });
  ctx.calls = calls;
  return ctx;
}
test('transport: good reply is cached and parsed', async () => {
  const mem = memory(),
    ctx = bridgeContext(mem, JSON.stringify({ returnValue: true, xml }));
  const r = await ctx.HomeInfoFinance.refresh();
  assert.equal(r.state, 'ok');
  assert.equal(ctx.calls[0].url, 'luna://com.gathin.tvhome.renewal/bnrRates');
  assert.deepEqual(Object.keys(JSON.parse(ctx.calls[0].payload)), ['id']);
  assert.equal(ctx.HomeInfo.finance.get().current.date, fixtureDate);
  assert.ok(mem.data['tvhome.cache.v1.bnr']);
  // The schedule decides: the stored rates are current for the instant the page was opened, so no second call.
  ctx.HomeInfoFinance.setClock(() => Date.parse(fixtureDate + 'T16:00:00Z')); // after both slots of the fixture day
  await ctx.HomeInfoFinance.refreshIfDue();
  assert.equal(ctx.calls.length, 1, 'refreshIfDue asks nothing when the rate date is current');
});
test('transport: unknown method / service errors => update-required, never throws', async () => {
  for (const reply of [
    JSON.stringify({
      returnValue: false,
      errorCode: -1,
      errorText: 'Unknown method "bnrRates"'
    }),
    JSON.stringify({ returnValue: false, errorCode: 'caller-not-authorized' }),
    JSON.stringify({ returnValue: false, errorCode: 'invalid-request' }),
    'not json',
    'throw'
  ]) {
    const ctx = bridgeContext(memory(), reply);
    assert.equal(
      (await ctx.HomeInfoFinance.refresh()).state,
      'update-required',
      reply
    );
  }
  const noBridge = context(memory());
  assert.equal(
    (await noBridge.HomeInfoFinance.refresh()).state,
    'update-required'
  );
  const root = bridgeContext(
    memory(),
    JSON.stringify({ returnValue: true, xml }),
    true
  );
  assert.equal((await root.HomeInfoFinance.refresh()).state, 'update-required');
  assert.equal(root.calls.length, 0, 'Root has no bnrRates: no call');
});
test('transport: transient bnr-* codes (busy, timeout) => offline, not update-required', async () => {
  for (const code of ['bnr-busy', 'bnr-timeout', 'bnr-http-status']) {
    const ctx = bridgeContext(
      memory(),
      JSON.stringify({ returnValue: false, errorCode: code })
    );
    assert.equal((await ctx.HomeInfoFinance.refresh()).state, 'offline', code);
  }
});
test('transport: network errors => offline; cache shows as stale', async () => {
  const mem = memory(),
    err = JSON.stringify({
      returnValue: false,
      errorCode: 'bnr-network-error'
    });
  let ctx = bridgeContext(mem, err);
  let r = await ctx.HomeInfoFinance.refresh();
  assert.equal(r.state, 'offline');
  assert.equal(r.fetchedAt, null);
  assert.equal(ctx.HomeInfo.finance.get().current, null);
  // Expired cache + failing network: stale values.
  mem.data['tvhome.cache.v1.bnr'] = JSON.stringify({
    value: xml,
    fetchedAt: Date.now() - 4 * 3600000
  });
  ctx = bridgeContext(mem, err);
  r = await ctx.HomeInfoFinance.refresh();
  assert.equal(r.state, 'offline');
  assert.ok(r.fetchedAt > 0);
  assert.equal(ctx.HomeInfo.finance.get().current.date, fixtureDate);
  // Expired cache + service missing: values plus update-required.
  ctx = bridgeContext(
    mem,
    JSON.stringify({ returnValue: false, errorCode: -1 })
  );
  r = await ctx.HomeInfoFinance.refresh();
  assert.equal(r.state, 'update-required');
  assert.ok(r.fetchedAt > 0);
});
test('transport: reply without XML or with corrupt XML never rotates', async () => {
  const ctx = bridgeContext(
    memory(),
    JSON.stringify({ returnValue: true, xml: '<DataSet>' })
  );
  const r = await ctx.HomeInfoFinance.refresh();
  assert.notEqual(r.state, 'ok');
  assert.equal(ctx.HomeInfo.finance.get().current, null);
});
test('display: 3 decimals everywhere (idle rows, page text); stored values keep 4; arrows use the stored values', () => {
  const ctx = context(memory()),
    F = ctx.HomeInfoFinance;
  F.ingest({ date: '2026-11-13', rates: { EUR: rate(5.3491), USD: rate(4.8604), GBP: rate(2.3454), CHF: rate(2.3456), HUF: rate(1.4662, 100) } });
  F.ingest({ date: '2026-11-16', rates: { EUR: rate(5.3494), USD: rate(4.8601), GBP: rate(2.3454), CHF: rate(2.3456), HUF: rate(1.4662, 100) } });
  ctx.HomeInfo.finance.set({ currencies: ['EUR', 'USD', 'GBP', 'CHF', 'HUF'] });
  assert.deepEqual(F.idleLines(), ['EUR 5.349', 'USD 4.860', 'GBP 2.345', 'CHF 2.346', '100 HUF 1.466'], 'one currency per row');
  assert.equal(ctx.HomeInfo.finance.get().current.rates.EUR.value, 5.3494, 'stored with 4 decimals');
  assert.equal(F.trend('EUR'), 1, 'arrow compares stored values (5.3491 -> 5.3494) although both read 5.349');
  assert.equal(F.trend('USD'), -1);
  assert.equal(F.trend('GBP'), 0);
});
test('landingCard: three currencies per line joined with " · ", at most 2 lines (6 currencies), date meta', () => {
  const ctx = context(memory()),
    F = ctx.HomeInfoFinance,
    all = {};
  ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD', 'SEK'].forEach((c, i) => (all[c] = rate(1 + i / 7)));
  F.ingest({ date: '2026-11-16', rates: Object.assign({ HUF: rate(1.4662, 100) }, all) });
  assert.equal(F.landingCard().meta, '16.11');
  assert.deepEqual(F.landingCard().lines, ['EUR 1.000 · USD 1.143 · GBP 1.286', 'CHF 1.429']);
  ctx.HomeInfo.finance.set({ currencies: ['EUR', 'USD', 'GBP'] });
  assert.deepEqual(F.landingCard().lines, ['EUR 1.000 · USD 1.143 · GBP 1.286'], 'a full line of three');
  ctx.HomeInfo.finance.set({ currencies: ['EUR'] });
  assert.deepEqual(F.landingCard().lines, ['EUR 1.000']);
  ctx.HomeInfo.finance.set({ currencies: ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CAD'] });
  assert.deepEqual(F.landingCard().lines, ['EUR 1.000 · USD 1.143 · GBP 1.286', 'CHF 1.429 · JPY 1.571 · CAD 1.714'], 'six currencies in two lines');
  ctx.HomeInfo.finance.set({ currencies: ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD', 'SEK'] });
  assert.equal(F.landingCard().lines.length, 2, 'beyond six: not shown on the card');
  assert.ok(F.landingCard().lines.join(' ').indexOf('AUD') < 0);
  ctx.HomeInfo.finance.set({ currencies: ['HUF', 'EUR'] });
  assert.deepEqual(F.landingCard().lines, ['100 HUF 1.466 · EUR 1.000']);
  assert.deepEqual(F.idleLines().length, 2, 'the idle panel keeps one row per currency');
});
// ---- BNR schedule (injected clock): requests only at 13:05 / 14:05 Romanian time of banking days ----
const UTC = (iso, hm) => Date.parse(iso + 'T' + hm + ':00Z');
const xmlOn = (date) => xml.replace(/2026-11-16/g, date);
const GOOD = (date) => JSON.stringify({ returnValue: true, xml: xmlOn(date) });
const NET = JSON.stringify({ returnValue: false, errorCode: 'bnr-network-error' });
// A scheduled context: mr.redify on, a bridge whose replies come from a mutable queue.
function sched(mem, replies) {
  const calls = [];
  function Bridge() {}
  Bridge.prototype.call = function () {
    calls.push(1);
    const self = this,
      reply = typeof replies.next === 'function' ? replies.next() : replies.reply;
    Promise.resolve().then(() => self.onservicecallback(reply));
  };
  Bridge.prototype.cancel = function () {};
  const ctx = context(mem, { PalmServiceBridge: Bridge, setTimeout, clearTimeout, mrRedify: true });
  ctx.calls = calls;
  let now = 0;
  ctx.at = (ms) => {
    now = ms;
    ctx.HomeInfoFinance.setClock(() => now);
  };
  return ctx;
}
const stored = (ctx, date) => ctx.HomeInfoFinance.ingest(day(date, 5.1));
async function asks(ctx, ms) {
  ctx.at(ms);
  const before = ctx.calls.length;
  await ctx.HomeInfoFinance.refreshIfDue();
  return ctx.calls.length - before;
}
test('schedule: Romanian time from UTC, EET/EEST switch on the last Sunday of March/October at 01:00 UTC', () => {
  const F = context(memory()).HomeInfoFinance;
  assert.equal(F.isSummerTime(UTC('2026-03-29', '00:59')), false);
  assert.equal(F.isSummerTime(UTC('2026-03-29', '01:00')), true);
  assert.equal(F.isSummerTime(UTC('2026-10-25', '00:59')), true);
  assert.equal(F.isSummerTime(UTC('2026-10-25', '01:00')), false);
  assert.deepEqual(F.roLocal(UTC('2026-11-16', '11:05')), { y: 2026, m: 11, d: 16, h: 13, min: 5 });
  assert.deepEqual(F.roLocal(UTC('2026-06-15', '10:05')), { y: 2026, m: 6, d: 15, h: 13, min: 5 });
  assert.deepEqual(F.roLocal(UTC('2026-06-15', '21:30')), { y: 2026, m: 6, d: 16, h: 0, min: 30 }, 'past midnight local');
  const w = F.neededRate(UTC('2026-11-16', '11:05')),
    su = F.neededRate(UTC('2026-06-15', '10:05'));
  assert.equal(w.date, '2026-11-16');
  assert.equal(w.slot1, UTC('2026-11-16', '11:05'));
  assert.equal(w.slot2, UTC('2026-11-16', '12:05'));
  assert.equal(su.slot1, UTC('2026-06-15', '10:05'));
  assert.equal(su.slot2, UTC('2026-06-15', '11:05'));
  assert.equal(F.neededRate(UTC('2026-11-16', '11:04')).date, '2026-11-13', 'before 13:05: still last Friday');
});
test('schedule: nothing before 13:05; 13:05 asks once; a fresh date ends the day; no second request', async () => {
  const ctx = sched(memory(), { reply: GOOD('2026-11-16') });
  stored(ctx, '2026-11-13');
  assert.equal(await asks(ctx, UTC('2026-11-16', '00:00')), 0);
  assert.equal(await asks(ctx, UTC('2026-11-16', '11:04')), 0, '13:04');
  assert.equal(await asks(ctx, UTC('2026-11-16', '11:05')), 1, '13:05');
  assert.equal(ctx.HomeInfo.finance.get().current.date, '2026-11-16');
  for (const t of ['11:06', '11:30', '12:04', '12:05', '12:06', '16:00', '23:59'])
    assert.equal(await asks(ctx, UTC('2026-11-16', t)), 0, 'no more today: ' + t);
  assert.equal(ctx.HomeInfo.finance.get().previous.date, '2026-11-13');
});
test('schedule: BNR late: the old date at 13:05 -> the second request at 14:05 only, then nothing', async () => {
  const replies = { reply: GOOD('2026-11-13') },
    ctx = sched(memory(), replies);
  stored(ctx, '2026-11-13');
  assert.equal(await asks(ctx, UTC('2026-11-16', '11:05')), 1, 'slot 1');
  for (const t of ['11:06', '11:40', '12:04'])
    assert.equal(await asks(ctx, UTC('2026-11-16', t)), 0, 'answered (old date): wait for slot 2: ' + t);
  replies.reply = GOOD('2026-11-16');
  assert.equal(await asks(ctx, UTC('2026-11-16', '12:05')), 1, 'slot 2');
  assert.equal(ctx.HomeInfo.finance.get().current.date, '2026-11-16');
  assert.equal(await asks(ctx, UTC('2026-11-16', '13:00')), 0);
  // Both slots late: after 14:05 no more until the next banking day.
  const ctx2 = sched(memory(), { reply: GOOD('2026-11-13') });
  stored(ctx2, '2026-11-13');
  assert.equal(await asks(ctx2, UTC('2026-11-16', '11:05')), 1);
  assert.equal(await asks(ctx2, UTC('2026-11-16', '12:05')), 1);
  for (const t of ['12:06', '14:00', '23:00'])
    assert.equal(await asks(ctx2, UTC('2026-11-16', t)), 0, 'after slot 2: ' + t);
  assert.equal(await asks(ctx2, UTC('2026-11-17', '11:04')), 0);
  assert.equal(await asks(ctx2, UTC('2026-11-17', '11:05')), 1, 'next banking day');
});
test('schedule: weekends, legal holidays and Good Friday ask nothing; the next banking day does', async () => {
  const ctx = sched(memory(), { reply: GOOD('2026-11-13') });
  stored(ctx, '2026-11-13');
  for (const t of ['2026-11-14T11:05', '2026-11-14T20:00', '2026-11-15T11:05', '2026-11-15T23:00']) {
    const [d, h] = t.split('T');
    assert.equal(await asks(ctx, UTC(d, h)), 0, 'weekend ' + t);
  }
  // 30 Nov (St Andrew) and 1 Dec (National Day) are legal holidays: last banking day Friday 27 Nov.
  const h = sched(memory(), { reply: GOOD('2026-12-02') });
  stored(h, '2026-11-27');
  for (const t of [['2026-11-30', '11:05'], ['2026-11-30', '12:05'], ['2026-12-01', '11:05'], ['2026-12-01', '16:00']])
    assert.equal(await asks(h, UTC(t[0], t[1])), 0, 'holiday ' + t.join(' '));
  assert.equal(await asks(h, UTC('2026-12-02', '11:05')), 1, 'Wednesday 2 Dec');
  // Good Friday 2026-04-10 and Easter Monday 2026-04-13 (Orthodox Easter 12 April): summer time (13:05 = 10:05 UTC).
  const e = sched(memory(), { reply: GOOD('2026-04-14') });
  stored(e, '2026-04-09');
  for (const t of [['2026-04-10', '10:05'], ['2026-04-10', '15:00'], ['2026-04-13', '10:05'], ['2026-04-13', '11:05']])
    assert.equal(await asks(e, UTC(t[0], t[1])), 0, 'Easter ' + t.join(' '));
  assert.equal(await asks(e, UTC('2026-04-14', '10:04')), 0);
  assert.equal(await asks(e, UTC('2026-04-14', '10:05')), 1, 'Tuesday after Easter, EEST slot');
});
test('schedule: summer (EEST) and winter (EET) slot instants in UTC', async () => {
  const su = sched(memory(), { reply: GOOD('2026-06-15') });
  stored(su, '2026-06-12');
  assert.equal(await asks(su, UTC('2026-06-15', '10:04')), 0, 'summer 13:04 = 10:04 UTC');
  assert.equal(await asks(su, UTC('2026-06-15', '10:05')), 1, 'summer 13:05 = 10:05 UTC');
  const wi = sched(memory(), { reply: GOOD('2026-01-12') });
  stored(wi, '2026-01-09');
  assert.equal(await asks(wi, UTC('2026-01-12', '11:04')), 0, 'winter 13:04 = 11:04 UTC');
  assert.equal(await asks(wi, UTC('2026-01-12', '11:05')), 1, 'winter 13:05 = 11:05 UTC');
  // The Monday after the October change (EET again from Sunday 25 Oct 01:00 UTC).
  const oct = sched(memory(), { reply: GOOD('2026-10-26') });
  stored(oct, '2026-10-23');
  assert.equal(await asks(oct, UTC('2026-10-26', '10:05')), 0, 'EEST instant is not the slot any more');
  assert.equal(await asks(oct, UTC('2026-10-26', '11:05')), 1);
});
test('schedule: the TV timezone does not matter (UTC clock + the EU rule)', async () => {
  const old = process.env.TZ;
  try {
    for (const tz of ['America/Los_Angeles', 'Asia/Tokyo', 'Europe/Bucharest', 'UTC']) {
      process.env.TZ = tz;
      const ctx = sched(memory(), { reply: GOOD('2026-11-16') });
      stored(ctx, '2026-11-13');
      assert.equal(await asks(ctx, UTC('2026-11-16', '11:04')), 0, tz + ' 11:04 UTC');
      assert.equal(await asks(ctx, UTC('2026-11-16', '11:05')), 1, tz + ' 11:05 UTC');
    }
  } finally {
    if (old === undefined) delete process.env.TZ;
    else process.env.TZ = old;
  }
});
test('schedule: a TV switched on at 18:00 makes one catch-up request; first run with no data asks too', async () => {
  const ctx = sched(memory(), { reply: GOOD('2026-11-16') });
  stored(ctx, '2026-11-13');
  assert.equal(await asks(ctx, UTC('2026-11-16', '16:00')), 1, '18:00 local, catch-up');
  assert.equal(await asks(ctx, UTC('2026-11-16', '16:01')), 0);
  assert.equal(await asks(ctx, UTC('2026-11-16', '19:00')), 0);
  const first = sched(memory(), { reply: GOOD('2026-11-13') });
  assert.equal(first.HomeInfo.finance.get().current, null);
  assert.equal(await asks(first, UTC('2026-11-14', '12:00')), 1, 'no data at all, even on a Saturday');
  assert.equal(first.HomeInfo.finance.get().current.date, '2026-11-13');
  assert.equal(await asks(first, UTC('2026-11-14', '12:05')), 0);
});
test('schedule: errors do not use up a slot: retry after 10 minutes, at most 3 tries per slot, tries reset per slot', async () => {
  const replies = { reply: NET },
    ctx = sched(memory(), replies);
  stored(ctx, '2026-11-13');
  assert.equal(await asks(ctx, UTC('2026-11-16', '11:05')), 1, 'try 1');
  assert.equal(ctx.HomeInfo.finance.get().current.date, '2026-11-13', 'stored rates stay');
  assert.equal(await asks(ctx, UTC('2026-11-16', '11:09')), 0, 'under 10 min');
  assert.equal(await asks(ctx, UTC('2026-11-16', '11:15')), 1, 'try 2');
  assert.equal(await asks(ctx, UTC('2026-11-16', '11:20')), 0);
  assert.equal(await asks(ctx, UTC('2026-11-16', '11:25')), 1, 'try 3');
  for (const t of ['11:35', '11:50', '12:04'])
    assert.equal(await asks(ctx, UTC('2026-11-16', t)), 0, 'three tries done: ' + t);
  assert.equal(await asks(ctx, UTC('2026-11-16', '12:05')), 1, 'slot 2: fresh tries');
  replies.reply = GOOD('2026-11-16');
  assert.equal(await asks(ctx, UTC('2026-11-16', '12:15')), 1, 'try 2 of slot 2 succeeds');
  assert.equal(await asks(ctx, UTC('2026-11-16', '12:30')), 0);
  // Service missing (update required) counts as no answer too.
  const svc = sched(memory(), { reply: JSON.stringify({ returnValue: false, errorCode: -1 }) });
  stored(svc, '2026-11-13');
  assert.equal(await asks(svc, UTC('2026-11-16', '11:05')), 1);
  assert.equal(await asks(svc, UTC('2026-11-16', '11:06')), 0);
});
test('schedule: corrupt persisted state means never asked; a future answer time never blocks', async () => {
  for (const raw of ['{bad', 'null', '"x"', '{"answeredAt":"a","tries":-4,"slot":{},"tryAt":null}', '[]']) {
    const mem = memory({ 'tvhome.bnr.sched.v1': raw }),
      ctx = sched(mem, { reply: GOOD('2026-11-16') });
    stored(ctx, '2026-11-13');
    assert.equal(await asks(ctx, UTC('2026-11-16', '11:05')), 1, raw);
  }
  const fut = sched(memory({ 'tvhome.bnr.sched.v1': JSON.stringify({ answeredAt: UTC('2030-01-01', '00:00'), slot: 0, tries: 0, tryAt: 0 }) }), { reply: GOOD('2026-11-16') });
  stored(fut, '2026-11-13');
  assert.equal(await asks(fut, UTC('2026-11-16', '11:05')), 1);
});
test('schedule: scope off asks nothing (and no timer is needed); forced refresh is only a test seam', async () => {
  const mem = memory(),
    calls = [];
  function Bridge() {}
  Bridge.prototype.call = function () {
    calls.push(1);
    const self = this;
    Promise.resolve().then(() => self.onservicecallback(GOOD('2026-11-16')));
  };
  Bridge.prototype.cancel = function () {};
  const off = context(mem, { PalmServiceBridge: Bridge, setTimeout, clearTimeout });
  off.HomeInfoFinance.setClock(() => UTC('2026-11-16', '11:05'));
  assert.equal((await off.HomeInfoFinance.refreshIfDue()).skipped, true);
  assert.equal(calls.length, 0, 'scope off: no request');
  assert.equal((await off.HomeInfoFinance.refresh()).state, 'ok');
  assert.equal(calls.length, 1, 'forced refresh still works');
});
(async () => {
  for (const [name, fn] of tests) {
    await fn();
    console.log('ok - ' + name);
  }
})().catch((e) => {
  console.error('not ok - ' + e.stack);
  process.exit(1);
});
