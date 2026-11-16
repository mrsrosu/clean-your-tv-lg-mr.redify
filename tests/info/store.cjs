const strict = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm');
// Objects built inside vm have another realm's prototypes; compare by value.
const assert = Object.assign(
  (v, m) => strict(v, m),
  strict,
  { deepEqual: (a, b) => strict.deepEqual(JSON.parse(JSON.stringify(a)), b) }
);
function context(storage) {
  const listeners = {},
    surface = {
      classes: {},
      classList: {
        add(c) {
          surface.classes[c] = true;
        },
        remove(c) {
          delete surface.classes[c];
        },
        contains(c) {
          return !!surface.classes[c];
        }
      }
    },
    document = {
      getElementById: (id) => (id === 'homeSurface' ? surface : null),
      createEvent: (type) => {
        assert.equal(type, 'Event', 'old engine: createEvent("Event")');
        return {
          initEvent(name) {
            this.type = name;
          }
        };
      },
      addEventListener(name, cb) {
        (listeners[name] = listeners[name] || []).push(cb);
      },
      dispatchEvent(ev) {
        (listeners[ev.type] || []).forEach((cb) => cb(ev));
      }
    },
    ctx = { document, localStorage: storage, surface };
  ctx.window = ctx;
  vm.runInNewContext(fs.readFileSync('launcher/info-store.js', 'utf8'), ctx);
  return ctx;
}
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
const defaults = { enabled: true, timeoutMin: 5 },
  sanitize = (raw) => {
    const out = {};
    if (typeof raw.enabled === 'boolean') out.enabled = raw.enabled;
    if ([5, 10, 15].indexOf(raw.timeoutMin) >= 0) out.timeoutMin = raw.timeoutMin;
    return out;
  };
function test(name, fn) {
  fn();
  console.log('ok - ' + name);
}

test('get() returns defaults on empty storage', () => {
  const s = context(memory()).HomeInfo.createStore('k', defaults, sanitize);
  assert.deepEqual(s.get(), defaults);
});
test('set merges patch and runs sanitize', () => {
  const mem = memory(),
    s = context(mem).HomeInfo.createStore('k', defaults, sanitize);
  assert.deepEqual(s.set({ timeoutMin: 10 }), { enabled: true, timeoutMin: 10 });
  assert.deepEqual(s.set({ timeoutMin: 7, enabled: false }), {
    enabled: false,
    timeoutMin: 10
  });
  assert.deepEqual(JSON.parse(mem.data.k), { enabled: false, timeoutMin: 10 });
  assert.deepEqual(s.reset(), defaults);
  assert.deepEqual(s.get(), defaults);
});
test('corrupt JSON resets to defaults without throwing', () => {
  const mem = memory();
  mem.data.k = '{not json';
  const s = context(mem).HomeInfo.createStore('k', defaults, sanitize);
  assert.deepEqual(s.get(), defaults);
  assert.deepEqual(s.set({ timeoutMin: 15 }), { enabled: true, timeoutMin: 15 });
});
test('get() sanitizes a corrupt stored object instead of trusting it', () => {
  const mem = memory();
  mem.data.k = '{"timeoutMin":"abc","enabled":"yes","extra":1}';
  const s = context(mem).HomeInfo.createStore('k', defaults, sanitize);
  assert.deepEqual(s.get(), defaults);
  mem.data.k = '{"timeoutMin":15,"enabled":false}';
  assert.deepEqual(s.get(), { enabled: false, timeoutMin: 15 });
});
test('throwing localStorage does not throw and get() returns defaults', () => {
  const boom = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      }
    },
    s = context(boom).HomeInfo.createStore('k', defaults, sanitize);
  assert.deepEqual(s.get(), defaults);
  assert.doesNotThrow(() => s.set({ timeoutMin: 10 }));
  assert.doesNotThrow(() => s.reset());
  const none = context(undefined).HomeInfo.createStore('k', defaults, sanitize);
  assert.deepEqual(none.get(), defaults);
});
test('onScopeChange callback receives true then false when the ctv-scope event fires after the surface class changes', () => {
  const ctx = context(memory()),
    seen = [];
  assert.equal(ctx.HomeInfo.isMrRedify(), false);
  ctx.HomeInfo.onScopeChange((active) => seen.push(active));
  function fire() {
    const ev = ctx.document.createEvent('Event');
    ev.initEvent('ctv-scope', false, false);
    ctx.document.dispatchEvent(ev);
  }
  ctx.surface.classList.add('ctv-mr-redify');
  fire();
  assert.equal(ctx.HomeInfo.isMrRedify(), true);
  ctx.surface.classList.remove('ctv-mr-redify');
  fire();
  assert.equal(ctx.HomeInfo.isMrRedify(), false);
  assert.deepEqual(seen, [true, false]);
});
test('tabs() sorts by the optional order field, registration order otherwise (M13)', () => {
  const info = context(memory()).HomeInfo,
    build = () => {};
  info.registerTab({ id: 'f', label: 'F', build, order: 40 });
  info.registerTab({ id: 'x', label: 'X', build });
  info.registerTab({ id: 'c', label: 'C', build, order: 30 });
  info.registerTab({ id: 'i', label: 'I', build, order: 10 });
  info.registerTab({ id: 'y', label: 'Y', build });
  assert.deepEqual(
    info.tabs().map((t) => t.id),
    ['i', 'c', 'f', 'x', 'y']
  );
});
test('registerTab keeps registration order, replaces a same-id spec and ignores invalid specs', () => {
  const info = context(memory()).HomeInfo,
    build = () => {};
  info.registerTab({ id: 'idle', label: 'A', build });
  info.registerTab({ id: 'calendar', label: 'B', build });
  info.registerTab({ id: 'idle', label: 'C', build });
  info.registerTab({ id: 'daily', label: 'no build' });
  info.registerTab(null);
  assert.deepEqual(
    info.tabs().map((t) => t.id + ':' + t.label),
    ['idle:C', 'calendar:B']
  );
  info.tabs().pop();
  assert.equal(info.tabs().length, 2);
});
