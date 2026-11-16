'use strict';
// BNR reference rates: the caller can choose nothing, host, path and TLS policy are fixed here.
// curs.bnr.ro, not www.bnr.ro (that one redirects to the home page).
function createRequest(https) {
  https = https || require('https');
  return function (done) {
    var finished = false,
      request,
      response,
      timer;
    function finish(code, xml) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (code) {
        if (response && response.destroy) response.destroy();
        if (request) request.destroy();
      }
      done(code, xml);
    }
    timer = setTimeout(function () {
      finish('bnr-timeout');
    }, 12000);
    try {
      // Legacy Node reads one certificate per entry in the ca option.
      var ca = require('fs').readFileSync(__dirname + '/ca-bundle.crt', 'utf8');
      request = https.request(
        {
          hostname: 'curs.bnr.ro',
          port: 443,
          method: 'GET',
          path: '/nbrfxrates.xml',
          rejectUnauthorized: true,
          agent: false,
          ca:
            ca.match(
              /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g
            ) || [],
          headers: {
            Accept: 'application/xml',
            'User-Agent':
              'CleanYourTV (https://github.com/Razdva122/clean-your-tv-lg-webos)'
          }
        },
        function (res) {
          response = res;
          var chunks = [],
            size = 0;
          res.on('error', function () {
            finish('bnr-network-error');
          });
          res.on('aborted', function () {
            finish('bnr-network-error');
          });
          res.on('close', function () {
            finish('bnr-network-error');
          });
          if (finished) {
            if (res.destroy) res.destroy();
            return;
          }
          if (res.statusCode !== 200) {
            finish('bnr-http-status');
            return;
          }
          res.on('data', function (chunk) {
            if (finished) return;
            if (!Buffer.isBuffer(chunk)) chunk = new Buffer(chunk);
            size += chunk.length;
            if (size > 262144) {
              finish('bnr-response-too-large');
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', function () {
            if (finished) return;
            var body = Buffer.concat(chunks).toString('utf8');
            if (body.indexOf('<DataSet') < 0) {
              finish('bnr-invalid-response');
              return;
            }
            finish(null, body);
          });
        }
      );
      request.on('error', function () {
        finish('bnr-network-error');
      });
      request.end();
    } catch (_) {
      finish('bnr-network-error');
    }
  };
}
function valid(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    return false;
  return (
    Object.keys(payload).join(',') === 'id' &&
    typeof payload.id === 'string' &&
    /^[a-zA-Z0-9-]{1,64}$/.test(payload.id)
  );
}
function register(service, options) {
  var pending = Object.create(null),
    count = 0;
  var request = createRequest(options.https);
  function respond(message, code, xml) {
    message.respond(
      code
        ? { returnValue: false, errorCode: code }
        : { returnValue: true, xml: xml }
    );
  }
  function authorized(message) {
    try {
      var id = message.ls2Message.applicationID();
      return typeof id === 'string' && id.split(' ')[0] === options.appId;
    } catch (_) {
      return false;
    }
  }
  service.register('bnrRates', function (message) {
    if (!authorized(message)) {
      respond(message, 'caller-not-authorized');
      return;
    }
    var payload = message.payload;
    if (!valid(payload)) {
      respond(message, 'invalid-request');
      return;
    }
    var id = payload.id;
    if (count >= 2 || pending[id]) {
      respond(message, 'bnr-busy');
      return;
    }
    var release = options.hold ? options.hold() : null,
      ended = false;
    pending[id] = true;
    count++;
    request(function (code, xml) {
      if (ended) return;
      ended = true;
      delete pending[id];
      count--;
      if (release) release();
      respond(message, code, xml);
    });
  });
}
module.exports = register;
