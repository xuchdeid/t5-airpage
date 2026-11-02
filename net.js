/*
 * WiFi transport for the editor.
 *
 * Same job as the BLE path in app.js -- push a 4000-byte frame or an ES5
 * script -- but over HTTP on the LAN. The device exposes:
 *
 *   GET  /api/ping              unauthenticated, for scanning
 *   GET  /api/info              id required
 *   POST /api/image   (4000 B)  id required
 *   POST /api/script  (<=4096)  id required
 *   POST /api/run               id required
 *   GET  /api/screen?v=net|image|qr
 *
 * Auth follows the convention the AirPage editor already uses: the QR code on
 * the e-paper carries ?id=<16 chars>, and that id is both identity and secret.
 * It travels as the X-T5-Id header so it never lands in a server log.
 *
 * Why a scan and not mDNS: a web page cannot do mDNS or UDP, and it cannot
 * enumerate a subnet either. What it *can* do is probe. So a "scan" here
 * means: take the /24 this page is served from (or the one in ?host=), fetch
 * /api/ping on every address with a short timeout, and keep the ones that
 * answer like a T5. That only works when the editor itself is served over
 * plain http from the same LAN -- an https page cannot fetch http://192.168.x.x
 * (mixed content). The UI says so instead of failing silently.
 */
(function () {
  'use strict';

  var PING_TIMEOUT = 700;
  var REQ_TIMEOUT = 6000;
  var CONCURRENCY = 24;

  function baseUrl(host) {
    return 'http://' + host;
  }

  function withTimeout(ms) {
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, ms);
    return { signal: ctl.signal, done: function () { clearTimeout(timer); } };
  }

  /* Probe one address. Resolves to a device object or null. */
  function probe(host) {
    var t = withTimeout(PING_TIMEOUT);
    return fetch(baseUrl(host) + '/api/ping', { signal: t.signal, cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        t.done();
        if (!j || j.magic !== 'T5AP') return null;
        return { host: host, name: j.device || 'T5', w: j.w, h: j.h, stride: j.stride };
      })
      .catch(function () { t.done(); return null; });
  }

  /* Subnet base from an address: "192.168.31.44" -> "192.168.31". */
  function subnetOf(host) {
    var m = String(host || '').match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/);
    return m ? m[1] : null;
  }

  function localBase(knownHost) {
    if (location.protocol !== 'http:') return null;
    /* Served from localhost (python -m http.server on this machine) the page
       host says nothing about the LAN, so fall back to a device we already
       know the address of. */
    var b = subnetOf(location.hostname);
    if (b) return b;
    return knownHost ? subnetOf(knownHost) : null;
  }

  /*
   * scan({base, known}) -> Promise<device[]>
   *   base  "192.168.31" (optional; defaults to the page's own /24)
   *   known [{host}] previously seen devices, probed first
   */
  /* https pages *can* reach a LAN IP in current Chrome (Local Network Access
     replaced the old blanket mixed-content rule), so nothing here refuses
     based on protocol; a failure is reported as it happens instead. */
  function protocolHint() {
    return location.protocol === 'https:'
      ? '（注意：这个页面是 https。Chrome 允许它访问局域网地址，但 Safari / 旧版 Firefox 会拦。若失败，换用局域网 http 打开这个编辑器。）'
      : '';
  }

  function scan(opts) {
    opts = opts || {};
    var knownList = opts.known || [];
    var base = opts.base || localBase(knownList[0] && knownList[0].host);
    var known = (opts.known || []).map(function (d) { return d.host; });
    if (!base && known.length === 0) {
      return Promise.resolve({
        error: '看不出本机网段（页面是从 localhost 或 https 打开的），请在下面直接填设备地址。'
      });
    }

    var hosts = known.slice();
    var seen = {};
    hosts.forEach(function (h) { seen[h] = 1; });
    if (base) {
      for (var i = 1; i <= 254; i++) {
        var h = base + '.' + i;
        if (!seen[h]) { seen[h] = 1; hosts.push(h); }
      }
    }

    var out = [];
    var idx = 0;
    function worker() {
      if (idx >= hosts.length) return Promise.resolve();
      var host = hosts[idx++];
      return probe(host).then(function (dev) {
        if (dev) out.push(dev);
        return worker();
      });
    }
    var workers = [];
    for (var k = 0; k < CONCURRENCY; k++) workers.push(worker());
    return Promise.all(workers).then(function () {
      out.sort(function (a, b) {
        var ai = known.indexOf(a.host), bi = known.indexOf(b.host);
        if (ai !== bi) return (ai < 0 ? 1e9 : ai) - (bi < 0 ? 1e9 : bi);
        return a.host.localeCompare(b.host, undefined, { numeric: true });
      });
      return { devices: out };
    });
  }

  function req(host, id, path, opts) {
    opts = opts || {};
    var headers = { 'X-T5-Id': id };
    var t = withTimeout(REQ_TIMEOUT);
    var request;
    /* No Content-Type for FormData: the browser must set the boundary. */
    if (opts.form) {
      request = fetch(baseUrl(host) + path, {
        method: opts.method || 'POST', headers: headers, body: opts.form,
        cache: 'no-store', signal: t.signal
      });
    } else {
      request = fetch(baseUrl(host) + path, {
        method: opts.method || 'GET', headers: headers, body: opts.body,
        cache: 'no-store', signal: t.signal
      });
    }
    return request.then(handle).then(
      function (j) { t.done(); return j; },
      function (e) {
        t.done();
        if (e && (e.name === 'AbortError' || /aborted/i.test(String(e.message)))) {
          throw new Error('timeout');
        }
        throw e;
      }
    );

    function handle(r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.err || ('HTTP ' + r.status));
        return j;
      });
    }
  }

  function info(host, id) { return req(host, id, '/api/info'); }

  function sendImage(host, id, bytes) {
    if (!bytes || bytes.length !== 4000) {
      return Promise.reject(new Error('位图必须是 4000 字节，实际 ' + (bytes ? bytes.length : 0)));
    }
    /* multipart, not a raw body: the device's WebServer only exposes binary
       uploads through the multipart parser, and a raw body would also be
       NUL-trimmed on the way in. */
    var fd = new FormData();
    fd.append('image', new Blob([bytes], { type: 'application/octet-stream' }), 'frame.bin');
    return req(host, id, '/api/image', { method: 'POST', form: fd });
  }

  function pushScript(host, id, source) {
    if (!source || source.length === 0) return Promise.reject(new Error('脚本为空'));
    if (source.length > 4096) {
      return Promise.reject(new Error('脚本 ' + source.length + ' B，超过 4096 B 上限'));
    }
    var fd = new FormData();
    fd.append('script', new Blob([source], { type: 'text/plain' }), 'device.js');
    return req(host, id, '/api/script', { method: 'POST', form: fd });
  }

  function runStored(host, id) { return req(host, id, '/api/run', { method: 'POST' }); }

  function setScreen(host, id, v) {
    return req(host, id, '/api/screen?v=' + encodeURIComponent(v));
  }

  /* ?host=192.168.31.44&id=<16>&w=122&h=250&mode=1bit — the QR payload. */
  function fromUrl(search) {
    var q = new URLSearchParams(search || location.search);
    var host = q.get('host') || q.get('h_host') || '';
    var id = q.get('id') || '';
    var w = parseInt(q.get('w') || '0', 10);
    var h = parseInt(q.get('h') || '0', 10);
    if (!host || !/^[A-Za-z0-9][A-Za-z0-9.\-]{2,60}$/.test(host)) return null;
    if (!/^[A-Za-z0-9_-]{16}$/.test(id)) return null;
    return { host: host, id: id, w: w || 122, h: h || 250 };
  }

  window.T5Net = {
    probe: probe,
    scan: scan,
    info: info,
    sendImage: sendImage,
    pushScript: pushScript,
    runStored: runStored,
    setScreen: setScreen,
    fromUrl: fromUrl,
    protocolHint: protocolHint,
    localBase: localBase,
    subnetOf: subnetOf
  };
})();
