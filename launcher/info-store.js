/* Home info features: scope signal (mr.redify theme) and per-feature settings store. */
(function (root) {
  'use strict';
  const doc = root.document,
    info = root.HomeInfo || (root.HomeInfo = {}),
    listeners = [];
  function isMrRedify() {
    const surface = doc.getElementById('homeSurface');
    return !!(surface && surface.classList.contains('ctv-mr-redify'));
  }
  function onScopeChange(cb) {
    listeners.push(cb);
  }
  // theme-runtime.js fires `ctv-scope` after toggling the class; only listen here.
  doc.addEventListener('ctv-scope', function () {
    const active = isMrRedify();
    listeners.slice().forEach(function (cb) {
      try {
        cb(active);
      } catch (_) {}
    });
  });
  function copy(a, b) {
    const out = {};
    let key;
    for (key in a) if (Object.prototype.hasOwnProperty.call(a, key)) out[key] = a[key];
    if (b) for (key in b) if (Object.prototype.hasOwnProperty.call(b, key)) out[key] = b[key];
    return out;
  }
  // sanitize(raw) returns only the valid fields; rejected ones keep the previous value.
  function createStore(key, defaults, sanitize) {
    function load() {
      try {
        const raw = JSON.parse(root.localStorage.getItem(key));
        if (raw && typeof raw === 'object') return copy(defaults, sanitize(raw));
      } catch (_) {}
      return copy(defaults);
    }
    function save(value) {
      try {
        root.localStorage.setItem(key, JSON.stringify(value));
      } catch (_) {}
      return value;
    }
    return {
      get: load,
      set: function (patch) {
        return save(copy(load(), sanitize(patch || {})));
      },
      reset: function () {
        return save(copy(defaults));
      }
    };
  }
  info.isMrRedify = isMrRedify;
  info.onScopeChange = onScopeChange;
  info.createStore = createStore;
})(window);
