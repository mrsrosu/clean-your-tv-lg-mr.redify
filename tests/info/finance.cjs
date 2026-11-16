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
  const surface = { classList: { contains: () => false } },
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
  for (const f of ['info-store', 'info-fetch', 'finance'])
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
    previous: null
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
  assert.equal(lines[0], 'EUR ' + fixtureEur.toFixed(4));
  ctx.HomeInfo.finance.set({ currencies: ['HUF', 'XXX'] });
  assert.deepEqual(F.idleLines(), ['100 HUF 1.4662']);
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
  await ctx.HomeInfoFinance.refresh(); // fresh cache: no second call
  assert.equal(ctx.calls.length, 1);
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
(async () => {
  for (const [name, fn] of tests) {
    await fn();
    console.log('ok - ' + name);
  }
})().catch((e) => {
  console.error('not ok - ' + e.stack);
  process.exit(1);
});
