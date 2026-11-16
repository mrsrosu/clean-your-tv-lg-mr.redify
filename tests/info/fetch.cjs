const strict = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm');
const assert = Object.assign((v, m) => strict(v, m), strict, {
  deepEqual: (a, b) => strict.deepEqual(JSON.parse(JSON.stringify(a)), b)
});
function memory() {
  const data = {};
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem(k, v) {
      data[k] = String(v);
    }
  };
}
// Fake XHR: each instance is queued in xhrs; tests drive it by hand.
function context(storage) {
  const xhrs = [];
  function FakeXHR() {
    this.readyState = 0;
    xhrs.push(this);
  }
  FakeXHR.prototype.open = function (method, url) {
    this.method = method;
    this.url = url;
  };
  FakeXHR.prototype.send = function () {};
  const ctx = { localStorage: storage, XMLHttpRequest: FakeXHR, Promise, xhrs };
  ctx.window = ctx;
  vm.runInNewContext(fs.readFileSync('launcher/info-fetch.js', 'utf8'), ctx);
  return ctx;
}
const tests = [];
function test(name, fn) {
  tests.push([name, fn]);
}
const KEY = 'tvhome.cache.v1.k';
function seed(mem, value, fetchedAt) {
  mem.data[KEY] = JSON.stringify({ value, fetchedAt });
}

test('fresh cache returns without calling loader', async () => {
  const mem = memory(),
    f = context(mem).HomeInfoFetch;
  seed(mem, { a: 1 }, 1000);
  let calls = 0;
  const r = await f.cached('k', 500, () => (calls++, Promise.resolve(1)), { now: () => 1400 });
  assert.equal(calls, 0);
  assert.deepEqual(r, { value: { a: 1 }, fetchedAt: 1000, stale: false });
});
test('an entry written with a future fetchedAt is stale: loader is called (M6)', async () => {
  const mem = memory(),
    f = context(mem).HomeInfoFetch;
  seed(mem, 'future', 5000);
  let calls = 0;
  const r = await f.cached('k', 500, () => (calls++, Promise.resolve('new')), { now: () => 1000 });
  assert.equal(calls, 1, 'clock went backwards: not fresh');
  assert.deepEqual(r, { value: 'new', fetchedAt: 1000, stale: false });
  // The loader failing keeps the future entry as the stale fallback.
  seed(mem, 'future', 5000);
  const r2 = await f.cached('k', 500, () => Promise.reject(new Error('x')), { now: () => 1000 });
  assert.deepEqual(r2, { value: 'future', fetchedAt: 5000, stale: true });
});
test('expired cache calls loader and stores the new value', async () => {
  const mem = memory(),
    f = context(mem).HomeInfoFetch;
  seed(mem, 'old', 1000);
  let calls = 0;
  const r = await f.cached('k', 500, () => (calls++, Promise.resolve('new')), { now: () => 2000 });
  assert.equal(calls, 1);
  assert.deepEqual(r, { value: 'new', fetchedAt: 2000, stale: false });
  assert.deepEqual(JSON.parse(mem.data[KEY]), { value: 'new', fetchedAt: 2000 });
});
test('loader failure with a cached value resolves stale:true', async () => {
  const mem = memory(),
    f = context(mem).HomeInfoFetch;
  seed(mem, 'old', 1000);
  const r = await f.cached('k', 500, () => Promise.reject(new Error('offline')), {
    now: () => 2000
  });
  assert.deepEqual(r, { value: 'old', fetchedAt: 1000, stale: true });
});
test('loader failure without cache rejects', async () => {
  const f = context(memory()).HomeInfoFetch;
  await assert.rejects(f.cached('k', 500, () => Promise.reject(new Error('offline'))));
});
test('loader that throws synchronously is a failure, not a throw', async () => {
  const f = context(memory()).HomeInfoFetch;
  await assert.rejects(
    f.cached('k', 500, () => {
      throw new Error('boom');
    })
  );
});
test('two concurrent calls for the same key call loader once', async () => {
  const f = context(memory()).HomeInfoFetch;
  let calls = 0;
  const loader = () => (calls++, Promise.resolve('v')),
    a = f.cached('k', 500, loader),
    b = f.cached('k', 500, loader),
    r = await Promise.all([a, b]);
  assert.equal(calls, 1);
  assert.equal(r[0].value, 'v');
  assert.equal(r[1].value, 'v');
  await f.cached('k', 0, loader);
  assert.equal(calls, 2, 'in-flight entry is released after settling');
});
test('corrupt cache entries are treated as no cache', async () => {
  for (const raw of ['{not json', '"str"', '{"value":1}', '{"fetchedAt":"x","value":1}', 'null']) {
    const mem = memory();
    mem.data[KEY] = raw;
    const f = context(mem).HomeInfoFetch;
    let calls = 0;
    const r = await f.cached('k', 500, () => (calls++, Promise.resolve('n')), { now: () => 9 });
    assert.equal(calls, 1, raw);
    assert.equal(r.value, 'n');
  }
});
test('throwing or missing localStorage does not break cached()', async () => {
  const boom = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('quota');
    }
  };
  for (const st of [boom, undefined]) {
    const f = context(st).HomeInfoFetch,
      r = await f.cached('k', 500, () => Promise.resolve('v'));
    assert.equal(r.value, 'v');
    assert.equal(r.stale, false);
  }
});
test('http resolves with the response text on 2xx', async () => {
  const ctx = context(memory()),
    p = ctx.HomeInfoFetch.http('https://x/y');
  const x = ctx.xhrs[0];
  assert.equal(x.method, 'GET');
  assert.equal(x.url, 'https://x/y');
  assert.equal(x.timeout, 12000);
  x.readyState = 4;
  x.status = 200;
  x.responseText = 'ok';
  x.onload();
  assert.equal(await p, 'ok');
});
test('http rejects on non-2xx status without retry', async () => {
  const ctx = context(memory()),
    p = ctx.HomeInfoFetch.http('https://x/y');
  const x = ctx.xhrs[0];
  x.status = 500;
  x.responseText = '';
  x.onload();
  await assert.rejects(p);
  assert.equal(ctx.xhrs.length, 1);
});
test('http timeout rejects (custom timeoutMs applied)', async () => {
  const ctx = context(memory()),
    p = ctx.HomeInfoFetch.http('https://x/y', { timeoutMs: 3000 });
  assert.equal(ctx.xhrs[0].timeout, 3000);
  ctx.xhrs[0].ontimeout();
  await assert.rejects(p);
  assert.equal(ctx.xhrs.length, 1, 'timeout is not retried');
});
test('http retries once on network error, then succeeds', async () => {
  const ctx = context(memory()),
    p = ctx.HomeInfoFetch.http('https://x/y');
  ctx.xhrs[0].onerror();
  const x = ctx.xhrs[1];
  assert.ok(x, 'second request issued');
  x.status = 200;
  x.responseText = 'second';
  x.onload();
  assert.equal(await p, 'second');
});
test('http retries once on network error, then rejects', async () => {
  const ctx = context(memory()),
    p = ctx.HomeInfoFetch.http('https://x/y');
  ctx.xhrs[0].onerror();
  ctx.xhrs[1].onerror();
  await assert.rejects(p);
  assert.equal(ctx.xhrs.length, 2);
});

(async () => {
  for (const t of tests) {
    await t[1]();
    console.log('ok - ' + t[0]);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
