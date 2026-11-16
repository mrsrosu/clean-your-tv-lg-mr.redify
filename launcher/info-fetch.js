/* Home info features: XHR GET helper and expiring cache with stale fallback. */
(function (root) {
  'use strict';
  const PREFIX = 'tvhome.cache.v1.',
    inflight = {};
  // One retry on a network error; timeouts and bad statuses reject at once.
  function http(url, opts) {
    const timeoutMs = (opts && opts.timeoutMs) || 12000;
    function attempt(retry) {
      return new Promise(function (resolve, reject) {
        const xhr = new root.XMLHttpRequest();
        let settled = false;
        function finish(error, value) {
          if (settled) return;
          settled = true;
          error ? reject(error) : resolve(value);
        }
        try {
          xhr.open('GET', url, true);
          xhr.timeout = timeoutMs;
          xhr.onload = function () {
            if (xhr.status < 200 || xhr.status >= 300) finish(Error('info-http-status'));
            else finish(null, xhr.responseText);
          };
          xhr.ontimeout = function () {
            finish(Error('info-http-timeout'));
          };
          xhr.onerror = function () {
            if (settled) return;
            settled = true;
            if (retry) attempt(false).then(resolve, reject);
            else reject(Error('info-http-network'));
          };
          xhr.send();
        } catch (e) {
          finish(e);
        }
      });
    }
    return attempt(true);
  }
  function readEntry(key) {
    try {
      const raw = JSON.parse(root.localStorage.getItem(PREFIX + key));
      if (
        raw &&
        typeof raw === 'object' &&
        typeof raw.fetchedAt === 'number' &&
        Object.prototype.hasOwnProperty.call(raw, 'value')
      )
        return raw;
    } catch (_) {}
    return null;
  }
  function writeEntry(key, value, fetchedAt) {
    try {
      root.localStorage.setItem(PREFIX + key, JSON.stringify({ value: value, fetchedAt: fetchedAt }));
    } catch (_) {}
  }
  function cached(key, ttlMs, loader, opts) {
    const now = (opts && opts.now) || Date.now,
      entry = readEntry(key);
    // A fetchedAt in the future (TV clock was wrong when it was written) is not fresh.
    const age = entry ? now() - entry.fetchedAt : -1;
    if (entry && age >= 0 && age < ttlMs)
      return Promise.resolve({ value: entry.value, fetchedAt: entry.fetchedAt, stale: false });
    if (inflight[key]) return inflight[key];
    let started;
    try {
      started = Promise.resolve(loader());
    } catch (e) {
      started = Promise.reject(e);
    }
    const promise = started.then(
      function (value) {
        const at = now();
        writeEntry(key, value, at);
        delete inflight[key];
        return { value: value, fetchedAt: at, stale: false };
      },
      function (error) {
        delete inflight[key];
        if (entry) return { value: entry.value, fetchedAt: entry.fetchedAt, stale: true };
        throw error;
      }
    );
    inflight[key] = promise;
    return promise;
  }
  // Team logos: only https URLs on the hosts of the two football providers; anything else is dropped (''). The URL
  // string is all that is ever stored; images are never cached by us.
  const LOGO_HOSTS = [
    'a.espncdn.com',
    'a1.espncdn.com',
    'www.thesportsdb.com',
    'r2.thesportsdb.com'
  ];
  function logoUrl(value) {
    if (typeof value !== 'string' || value.length > 300) return '';
    const m = /^https:\/\/([a-z0-9.-]+)\/[^\s"'<>\\]*$/.exec(value);
    return m && LOGO_HOSTS.indexOf(m[1]) >= 0 ? value : '';
  }
  root.HomeInfoFetch = { http: http, cached: cached, logoUrl: logoUrl };
})(window);
