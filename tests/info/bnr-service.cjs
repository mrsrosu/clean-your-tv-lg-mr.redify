'use strict';
// BNR rates service method: fixed destination, caller check, bounded response.
const assert = require('assert'),
  fs = require('fs'),
  vm = require('vm'),
  path = require('path'),
  EventEmitter = require('events').EventEmitter;
const file = 'renewal-service/bnr.js',
  appId = 'com.gathin.tvhome';
const xml = fs.readFileSync('tests/info/fixtures/nbrfxrates.xml', 'utf8');
function setup(throwing) {
  const methods = {},
    calls = [],
    timers = [],
    held = { n: 0, released: 0 },
    https = {
      request: function (options, callback) {
        if (throwing) throw new Error('private synchronous exception');
        const req = new EventEmitter();
        req.destroy = function () {
          req.destroyed = true;
        };
        req.end = function () {};
        calls.push({ options: options, callback: callback, req: req });
        return req;
      }
    },
    service = {
      register: function (name, fn) {
        methods[name] = fn;
      }
    },
    module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(file, 'utf8'),
    {
      module: module,
      exports: module.exports,
      Buffer: Buffer,
      __dirname: path.dirname(path.resolve(file)),
      require: function (name) {
        return name === 'https' ? https : require(name);
      },
      setTimeout: function (fn, ms) {
        assert.equal(ms, 12000);
        const t = { fn: fn };
        timers.push(t);
        return t;
      },
      clearTimeout: function (t) {
        if (t) t.cleared = true;
      }
    },
    { filename: file, displayErrors: false }
  );
  module.exports(service, {
    appId: appId,
    https: https,
    hold: function () {
      held.n++;
      return function () {
        held.released++;
      };
    }
  });
  function invoke(payload, caller) {
    const replies = [];
    methods.bnrRates({
      payload: payload,
      ls2Message: {
        applicationID: function () {
          return caller === undefined ? appId + ' session' : caller;
        }
      },
      respond: function (r) {
        replies.push(r);
      }
    });
    return replies;
  }
  function answer(call, text, status) {
    const res = new EventEmitter();
    res.statusCode = status === undefined ? 200 : status;
    res.destroy = function () {
      res.destroyed = true;
    };
    call.callback(res);
    if (text !== undefined) {
      res.emit('data', Buffer.from ? Buffer.from(text) : new Buffer(text));
      res.emit('end');
    }
    return res;
  }
  return {
    methods: methods,
    calls: calls,
    timers: timers,
    held: held,
    invoke: invoke,
    answer: answer
  };
}

let s = setup();
assert.equal(typeof s.methods.bnrRates, 'function');
// Rejected before any socket or hold.
[
  ['foreign', { id: 'a' }],
  ['', { id: 'a' }],
  [appId, { id: 'a', url: 'https://evil/' }],
  [appId, { id: 'a', host: 'x' }],
  [appId, {}],
  [appId, { id: '' }],
  [appId, { id: 12 }],
  [appId, { id: '../x' }],
  [appId, { id: new Array(66).join('a') }]
].forEach(function (c) {
  const r = s.invoke(c[1], c[0]);
  assert.equal(r[0].returnValue, false);
  assert.equal(
    r[0].errorCode,
    c[0] === appId ? 'invalid-request' : 'caller-not-authorized'
  );
});
assert.equal(s.invoke(null)[0].errorCode, 'invalid-request');
assert.equal(s.calls.length, 0);
assert.equal(s.held.n, 0);

// Good request: fixed destination, bundled CA.
let good = s.invoke({ id: 'ok' });
let call = s.calls[0];
assert.equal(call.options.hostname, 'curs.bnr.ro');
assert.equal(call.options.path, '/nbrfxrates.xml');
assert.equal(call.options.port, 443);
assert.equal(call.options.method, 'GET');
assert.equal(call.options.rejectUnauthorized, true);
assert.equal(call.options.agent, false);
const certs = fs
  .readFileSync('renewal-service/ca-bundle.crt', 'utf8')
  .match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
assert.strictEqual(JSON.stringify(call.options.ca), JSON.stringify(certs));
s.answer(call, xml);
assert.equal(good[0].returnValue, true);
assert.equal(good[0].xml, xml);
assert.equal(s.held.released, s.held.n);
// Late events after completion do nothing.
call.req.emit('error', new Error('private'));
assert.equal(good.length, 1);

// Busy guard: a second call with the same id while pending.
good = s.invoke({ id: 'p' });
assert.equal(s.invoke({ id: 'p' })[0].errorCode, 'bnr-busy');
s.answer(s.calls[s.calls.length - 1], xml);
assert.equal(good[0].returnValue, true);

// Error codes.
[
  ['status', xml, 302, 'bnr-http-status'],
  ['large', new Array(262146).join('x'), 200, 'bnr-response-too-large'],
  ['text', 'hello', 200, 'bnr-invalid-response'],
  ['json', '{"a":1}', 200, 'bnr-invalid-response'],
  ['empty', '', 200, 'bnr-invalid-response']
].forEach(function (c) {
  const r = s.invoke({ id: c[0] });
  s.answer(s.calls[s.calls.length - 1], c[1], c[2]);
  assert.equal(r[0].returnValue, false);
  assert.equal(r[0].errorCode, c[3], c[0]);
  assert.equal(s.held.released, s.held.n);
});
['error', 'aborted', 'close'].forEach(function (event) {
  const r = s.invoke({ id: 'res-' + event }),
    res = s.answer(s.calls[s.calls.length - 1]);
  res.emit(event, new Error('private response'));
  assert.equal(r[0].errorCode, 'bnr-network-error');
});
let r = s.invoke({ id: 'req-error' });
s.calls[s.calls.length - 1].req.emit('error', new Error('private URL'));
assert.equal(
  JSON.stringify(r),
  '[{"returnValue":false,"errorCode":"bnr-network-error"}]'
);
r = s.invoke({ id: 'slow' });
s.timers[s.timers.length - 1].fn();
assert.equal(r[0].errorCode, 'bnr-timeout');
assert(s.calls[s.calls.length - 1].req.destroyed);
assert.equal(s.held.released, s.held.n);

// Synchronous exception while starting.
s = setup(true);
assert.equal(s.invoke({ id: 'throw' })[0].errorCode, 'bnr-network-error');
assert.equal(s.held.released, s.held.n);
console.log('PASS bnr service');
