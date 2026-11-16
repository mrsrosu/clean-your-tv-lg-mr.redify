'use strict';
// Idle screen: controller (fake clock) and settings sanitizing, in a bare context (no DOM).
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm');
const module_ = { exports: {} },
  ctx = { module: module_, console };
ctx.window = ctx;
vm.runInNewContext(fs.readFileSync('launcher/idle-screen.js', 'utf8'), ctx);
const { createIdleController, sanitize, DEFAULTS } = module_.exports;

// Fake clock: timers fire in due order when time is advanced.
function fake() {
  const f = { t: 1000, timers: [], seq: 0, idle: 0, wake: 0, cancelled: 0 };
  f.now = () => f.t;
  f.schedule = (fn, ms) => {
    f.timers.push({ id: ++f.seq, at: f.t + ms, fn });
    return f.seq;
  };
  f.cancel = (id) => {
    f.cancelled++;
    f.timers = f.timers.filter((x) => x.id !== id);
  };
  f.advance = (ms) => {
    const end = f.t + ms;
    for (;;) {
      f.timers.sort((a, b) => a.at - b.at);
      const next = f.timers[0];
      if (!next || next.at > end) break;
      f.timers.shift();
      f.t = next.at;
      next.fn();
    }
    f.t = end;
  };
  f.make = (extra) =>
    createIdleController(
      Object.assign(
        {
          timeoutMs: 10000,
          onIdle: () => f.idle++,
          onWake: () => f.wake++,
          now: f.now,
          schedule: f.schedule,
          cancel: f.cancel
        },
        extra
      )
    );
  return f;
}
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('idle fires once after timeoutMs without activity', () => {
  const f = fake(),
    c = f.make();
  c.start();
  f.advance(9999);
  assert.equal(f.idle, 0);
  assert.equal(c.isIdle(), false);
  f.advance(1);
  assert.equal(f.idle, 1);
  assert.equal(c.isIdle(), true);
  f.advance(60000);
  assert.equal(f.idle, 1, 'fires once');
});
test('activity before the timeout restarts it', () => {
  const f = fake(),
    c = f.make();
  c.start();
  f.advance(6000);
  c.activity();
  f.advance(6000);
  assert.equal(f.idle, 0, '12 s since start but 6 s since activity');
  f.advance(4000);
  assert.equal(f.idle, 1);
});
test('activity while idle wakes and restarts the timer', () => {
  const f = fake(),
    c = f.make();
  c.start();
  f.advance(10000);
  c.activity();
  assert.equal(f.wake, 1);
  assert.equal(c.isIdle(), false);
  f.advance(10000);
  assert.equal(f.idle, 2, 'idle again after another quiet period');
});
test('stop cancels the timer and wakes an idle controller', () => {
  const f = fake(),
    c = f.make();
  c.start();
  c.stop();
  assert.equal(f.timers.length, 0, 'no timer left');
  f.advance(60000);
  assert.equal(f.idle, 0);
  c.start();
  f.advance(10000);
  assert.equal(c.isIdle(), true);
  c.stop();
  assert.equal(c.isIdle(), false);
  assert.equal(f.timers.length, 0);
});
test('timeoutMs 0 never starts', () => {
  const f = fake(),
    c = f.make({ timeoutMs: 0 });
  c.start();
  assert.equal(f.timers.length, 0);
  f.advance(3600000);
  assert.equal(f.idle, 0);
});
test('blocked() postpones idle without firing', () => {
  const f = fake();
  let blocked = true;
  const c = f.make({ blocked: () => blocked });
  c.start();
  f.advance(10000);
  assert.equal(f.idle, 0);
  assert.equal(c.isIdle(), false);
  blocked = false;
  f.advance(10000);
  assert.equal(f.idle, 1);
});
test('start twice does not double the timers', () => {
  const f = fake(),
    c = f.make();
  c.start();
  c.start();
  assert.equal(f.timers.length, 1);
});
test('sanitize: defaults', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(DEFAULTS)), {
    enabled: true,
    style: 'clock',
    timeoutMin: 10,
    dim: 60,
    seconds: false,
    blocks: { date: true, rates: false, football: false }
  });
});
test('sanitize: enabled is boolean-only (default true), absent when not given', () => {
  assert.equal(DEFAULTS.enabled, true);
  assert.equal(sanitize({}).enabled, undefined);
  assert.equal(sanitize({ enabled: false }).enabled, false);
  assert.equal(sanitize({ enabled: true }).enabled, true);
  ['no', 0, null, 'false', {}].forEach((v) =>
    assert.equal(sanitize({ enabled: v }).enabled, true)
  );
  assert.equal(sanitize({ timeoutMin: 0 }).timeoutMin, 0, 'timeoutMin 0 keeps its old meaning');
});
test('sanitize: invalid timeoutMin -> 10, valid kept', () => {
  assert.equal(sanitize({ timeoutMin: 'abc' }).timeoutMin, 10);
  assert.equal(sanitize({ timeoutMin: 7 }).timeoutMin, 10);
  assert.equal(sanitize({ timeoutMin: null }).timeoutMin, 10);
  for (const v of [0, 5, 10, 30])
    assert.equal(sanitize({ timeoutMin: v }).timeoutMin, v);
});
test('sanitize: dim clamped, style/blocks/seconds checked', () => {
  assert.equal(sanitize({ dim: 400 }).dim, 100);
  assert.equal(sanitize({ dim: -5 }).dim, 0);
  assert.equal(sanitize({ dim: 'x' }).dim, 60);
  assert.equal(sanitize({ dim: 42.6 }).dim, 43);
  assert.equal(sanitize({ style: 'panel' }).style, 'panel');
  assert.equal(sanitize({ style: 'weird' }).style, 'clock');
  assert.equal(sanitize({ seconds: true }).seconds, true);
  assert.equal(sanitize({ seconds: 'yes' }).seconds, false);
  const b = sanitize({
    blocks: { rates: true, football: 'x', other: 1 }
  }).blocks;
  assert.deepEqual(JSON.parse(JSON.stringify(b)), {
    date: true,
    rates: true,
    football: false
  });
  // Only the given fields come back (the store keeps the previous value of the rest).
  assert.deepEqual(JSON.parse(JSON.stringify(sanitize(null))), {});
  assert.deepEqual(JSON.parse(JSON.stringify(sanitize({ dim: 10 }))), {
    dim: 10
  });
});
test('stored corrupt value goes through sanitize in get() (store + idle)', () => {
  const data = {},
    surface = { classList: { contains: () => false } },
    sctx = {
      document: {
        getElementById: () => surface,
        addEventListener() {}
      },
      localStorage: {
        getItem: (k) => (k in data ? data[k] : null),
        setItem(k, v) {
          data[k] = String(v);
        }
      }
    };
  sctx.window = sctx;
  vm.runInNewContext(fs.readFileSync('launcher/info-store.js', 'utf8'), sctx);
  const store = sctx.HomeInfo.createStore('tvhome.idle.v1', DEFAULTS, sanitize);
  data['tvhome.idle.v1'] = '{"timeoutMin":"abc","dim":400}';
  const got = store.get();
  assert.equal(got.timeoutMin, 10);
  assert.equal(got.dim, 100);
  assert.equal(got.style, 'clock');
});
let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log('ok - ' + name);
  } catch (e) {
    failed++;
    console.log('not ok - ' + name + '\n' + e.message);
  }
}
process.exit(failed ? 1 : 0);
