/*
 * Boucan — stockage (IndexedDB), moteur audio (Web Audio), import/export.
 * ES5 uniquement : doit tourner sur de vieilles WebView Android.
 */
(function (B) {
  'use strict';

  B.VERSION = '1.0';
  B.COLORS = ['#E53935', '#FB8C00', '#FDD835', '#43A047', '#00ACC1', '#1E88E5', '#8E24AA', '#EC407A', '#ECEFF1', '#546E7A'];
  B.MAX_PAGES = 8;
  B.SLOTS = 8;
  B.KEEP_SEC = 30;   // au-delà, on ne garde que la partie recadrée
  B.MAX_SEC = 600;   // durée max d'un son importé
  B.MAX_BYTES = 60 * 1024 * 1024;
  B.FX = [['reverb', 'REVERB'], ['echo', 'ÉCHO'], ['filter', 'FILTRE'], ['mega', 'MÉGAPHONE']];
  B.cfg = null;

  var uidN = 0;
  B.uid = function (p) {
    uidN++;
    return p + Date.now().toString(36) + uidN.toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  };

  // ====================== IndexedDB ======================
  var db = null;
  var D = B.db = {};

  // Si IndexedDB est indisponible, l'app tourne quand même : tout reste en
  // mémoire (B.volatile) et sera perdu à la fermeture.
  var mem = null;
  function useMem(res) { mem = { kv: {}, samples: {} }; B.volatile = true; res(); }

  D.open = function () {
    return new Promise(function (res) {
      var rq;
      try { rq = window.indexedDB.open('boucan', 1); } catch (e) { useMem(res); return; }
      rq.onupgradeneeded = function () {
        var d = rq.result;
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
        if (!d.objectStoreNames.contains('samples')) d.createObjectStore('samples');
      };
      rq.onsuccess = function () { db = rq.result; res(); };
      rq.onerror = function (ev) { if (ev && ev.preventDefault) ev.preventDefault(); useMem(res); };
      rq.onblocked = function () { useMem(res); };
    });
  };
  function tx(store, mode, fn) {
    return new Promise(function (res, rej) {
      var t, rq;
      try { t = db.transaction(store, mode); rq = fn(t.objectStore(store)); } catch (e) { rej(e); return; }
      t.oncomplete = function () { res(rq ? rq.result : undefined); };
      t.onerror = t.onabort = function () { rej(t.error || new Error('idb')); };
    });
  }
  D.get = function (store, key) {
    if (mem) return Promise.resolve(mem[store][key]);
    return tx(store, 'readonly', function (s) { return s.get(key); });
  };
  D.put = function (store, key, val) {
    if (mem) { mem[store][key] = val; return Promise.resolve(); }
    return tx(store, 'readwrite', function (s) { return s.put(val, key); });
  };
  D.del = function (store, key) {
    if (mem) { delete mem[store][key]; return Promise.resolve(); }
    return tx(store, 'readwrite', function (s) { return s['delete'](key); });
  };
  D.clear = function (store) {
    if (mem) { mem[store] = {}; return Promise.resolve(); }
    return tx(store, 'readwrite', function (s) { return s.clear(); });
  };
  D.keys = function (store) {
    if (mem) return Promise.resolve(Object.keys(mem[store]));
    return new Promise(function (res, rej) {
      var out = [], s = db.transaction(store, 'readonly').objectStore(store), rq;
      if (s.getAllKeys) {
        rq = s.getAllKeys();
        rq.onsuccess = function () { res(rq.result); };
      } else {
        rq = s.openKeyCursor ? s.openKeyCursor() : s.openCursor();
        rq.onsuccess = function () {
          var c = rq.result;
          if (c) { out.push(c.key); c['continue'](); } else res(out);
        };
      }
      rq.onerror = function () { rej(rq.error); };
    });
  };

  var saveT = null;
  B.save = function () {
    if (saveT) clearTimeout(saveT);
    saveT = setTimeout(B.saveNow, 250);
  };
  B.saveNow = function () {
    if (saveT) { clearTimeout(saveT); saveT = null; }
    return D.put('kv', 'config', B.cfg)['catch'](function (e) { if (B.onError) B.onError('Sauvegarde impossible', e); });
  };

  function eachPad(cfg, fn) {
    cfg.pages.forEach(function (pg, pi) {
      pg.pads.forEach(function (p, i) { if (p) fn(p, pi, i); });
    });
  }
  B.eachPad = function (fn) { eachPad(B.cfg, fn); };

  // Supprime les sons qui ne sont plus utilisés par aucune case.
  B.gc = function () {
    var used = {};
    eachPad(B.cfg, function (p) { used[p.sample] = 1; });
    return D.keys('samples').then(function (keys) {
      return keys.reduce(function (ch, k) {
        if (used[k]) return ch;
        delete A.buffers[k];
        return ch.then(function () { return D.del('samples', k); });
      }, Promise.resolve());
    })['catch'](function () {});
  };

  // ====================== WAV ======================
  var LE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

  B.encodeWav = function (chans, sr) {
    var nch = chans.length, n = chans[0].length, size = 44 + n * nch * 2;
    var ab = new ArrayBuffer(size), dv = new DataView(ab), i, c;
    function str(o, s) { for (var k = 0; k < s.length; k++) dv.setUint8(o + k, s.charCodeAt(k)); }
    str(0, 'RIFF'); dv.setUint32(4, size - 8, true); str(8, 'WAVE'); str(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, nch, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * nch * 2, true);
    dv.setUint16(32, nch * 2, true); dv.setUint16(34, 16, true);
    str(36, 'data'); dv.setUint32(40, n * nch * 2, true);
    var o = 44, x;
    if (LE) { // chemin rapide (DataView est lent sur les vieux moteurs)
      var i16 = new Int16Array(ab, 44, n * nch);
      for (c = 0; c < nch; c++) {
        var src = chans[c];
        for (i = 0, o = c; i < n; i++, o += nch) {
          x = src[i];
          i16[o] = x <= -1 ? -32768 : x >= 1 ? 32767 : x < 0 ? x * 32768 : x * 32767;
        }
      }
      return ab;
    }
    for (i = 0; i < n; i++) {
      for (c = 0; c < nch; c++) {
        x = chans[c][i];
        x = x < -1 ? -1 : x > 1 ? 1 : x;
        dv.setInt16(o, x < 0 ? x * 32768 : x * 32767, true);
        o += 2;
      }
    }
    return ab;
  };

  B.wavToBuffer = function (ab) {
    var dv = new DataView(ab), p = 12, nch = 1, sr = 44100, off = 44, len = ab.byteLength - 44;
    while (p + 8 <= ab.byteLength) {
      var id = String.fromCharCode(dv.getUint8(p), dv.getUint8(p + 1), dv.getUint8(p + 2), dv.getUint8(p + 3));
      var sz = dv.getUint32(p + 4, true);
      if (id === 'fmt ') { nch = dv.getUint16(p + 10, true); sr = dv.getUint32(p + 12, true); }
      else if (id === 'data') { off = p + 8; len = Math.min(sz, ab.byteLength - off); break; }
      p += 8 + sz + (sz & 1);
    }
    var n = Math.floor(len / (2 * nch)), buf = A.ctx.createBuffer(nch, Math.max(1, n), sr), c, i;
    var fast = LE && off % 2 === 0 ? new Int16Array(ab, off, n * nch) : null;
    for (c = 0; c < nch; c++) {
      var ch = buf.getChannelData(c), q;
      if (fast) for (i = 0, q = c; i < n; i++, q += nch) ch[i] = fast[q] / 32768;
      else for (i = 0, q = off + c * 2; i < n; i++, q += nch * 2) ch[i] = dv.getInt16(q, true) / 32768;
    }
    return buf;
  };

  // AudioBuffer (ou tranche) -> WAV 16 bits, 2 canaux max.
  B.bufferToWav = function (buf, from, to) {
    var sr = buf.sampleRate, a = Math.max(0, Math.floor((from || 0) * sr));
    var b = Math.min(buf.length, Math.ceil((to === undefined ? buf.duration : to) * sr));
    var nch = Math.min(2, buf.numberOfChannels), chans = [], c;
    for (c = 0; c < nch; c++) chans.push(buf.getChannelData(c).subarray(a, b));
    return B.encodeWav(chans, sr);
  };

  // ====================== Moteur audio ======================
  var A = B.audio = { ctx: null, voices: {}, buffers: {}, onChange: null };

  function impulse(ctx, sec) {
    var sr = ctx.sampleRate, n = Math.floor(sec * sr), ir = ctx.createBuffer(2, n, sr), c, i;
    for (c = 0; c < 2; c++) {
      var d = ir.getChannelData(c);
      for (i = 0; i < n; i++) {
        var t = i / n;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3) * (i < 200 ? i / 200 : 1);
      }
    }
    return ir;
  }
  function driveCurve(k) {
    var n = 1024, c = new Float32Array(n), i;
    for (i = 0; i < n; i++) { var x = i * 2 / (n - 1) - 1; c[i] = Math.tanh(x * k) * 0.8; }
    return c;
  }

  A.init = function () {
    var AC = window.AudioContext || window.webkitAudioContext, ctx;
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
    A.ctx = ctx;

    var bus = A.bus = ctx.createGain();
    var lp = A.lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 20000; lp.Q.value = 0.7;

    var clean = A.clean = ctx.createGain();
    var mHp = ctx.createBiquadFilter(); mHp.type = 'highpass'; mHp.frequency.value = 600;
    var mLp = ctx.createBiquadFilter(); mLp.type = 'lowpass'; mLp.frequency.value = 2800;
    var shaper = ctx.createWaveShaper(); shaper.curve = driveCurve(6);
    var mega = A.mega = ctx.createGain(); mega.gain.value = 0;
    var mix = ctx.createGain();
    var kill = A.kill = ctx.createGain();

    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.knee.value = 10; comp.ratio.value = 12;
    comp.attack.value = 0.002; comp.release.value = 0.2;

    var revSend = A.revSend = ctx.createGain(); revSend.gain.value = 0;
    var conv = ctx.createConvolver(); conv.buffer = impulse(ctx, 2.4);

    var dSend = A.dSend = ctx.createGain(); dSend.gain.value = 0;
    var delay = ctx.createDelay(1); delay.delayTime.value = 0.32;
    var dLp = ctx.createBiquadFilter(); dLp.type = 'lowpass'; dLp.frequency.value = 3500;
    var fb = A.fb = ctx.createGain(); fb.gain.value = 0.3;

    bus.connect(lp);
    lp.connect(clean); clean.connect(mix);
    lp.connect(mHp); mHp.connect(mLp); mLp.connect(shaper); shaper.connect(mega); mega.connect(mix);
    mix.connect(kill);
    mix.connect(revSend); revSend.connect(conv); conv.connect(kill);
    mix.connect(dSend); dSend.connect(delay); delay.connect(dLp); dLp.connect(fb); fb.connect(delay); dLp.connect(kill);
    kill.connect(comp); comp.connect(ctx.destination);
  };

  A.resume = function () {
    var ctx = A.ctx;
    if (ctx && ctx.state && ctx.state !== 'running' && ctx.resume) {
      try { var p = ctx.resume(); if (p && p['catch']) p['catch'](function () {}); } catch (e) {}
    }
  };

  // Un seul effet actif à la fois ; a = dosage 0..1.
  A.setFx = function (type, a) {
    var t = A.ctx.currentTime, tc = 0.03;
    var rev = type === 'reverb' ? a : 0, ech = type === 'echo' ? a : 0;
    var fil = type === 'filter' ? a : 0, meg = type === 'mega' ? a : 0;
    A.fxEcho = ech;
    A.revSend.gain.setTargetAtTime(rev * 1.4, t, tc);
    A.dSend.gain.setTargetAtTime(ech * 0.9, t, tc);
    if (!A.killed) A.fb.gain.setTargetAtTime(0.3 + 0.45 * ech, t, tc);
    A.lp.frequency.setTargetAtTime(20000 * Math.pow(0.011, fil), t, tc);
    A.lp.Q.setTargetAtTime(0.7 + 5 * fil, t, tc);
    A.mega.gain.setTargetAtTime(meg * 1.3, t, tc);
    A.clean.gain.setTargetAtTime(1 - meg, t, tc);
  };

  function unkill() {
    if (!A.killed) return;
    A.killed = false;
    if (A.killT) { clearTimeout(A.killT); A.killT = null; }
    var t = A.ctx.currentTime;
    A.kill.gain.cancelScheduledValues(t);
    A.kill.gain.setTargetAtTime(1, t, 0.004);
    A.fb.gain.setTargetAtTime(0.3 + 0.45 * (A.fxEcho || 0), t, 0.01);
  }

  A.range = function (pad, buf) {
    var d = buf.duration, s = Math.max(0, Math.min(pad.start || 0, d - 0.02));
    var e = Math.max(s + 0.02, Math.min(pad.end === undefined || pad.end === null ? d : pad.end, d));
    return [s, e];
  };

  A.play = function (pad) {
    var buf = A.buffers[pad.sample];
    if (!buf) return null;
    A.resume();
    unkill();
    if (A.voices[pad.id]) A.stop(pad.id, true);
    var ctx = A.ctx, now = ctx.currentTime, src = ctx.createBufferSource(), g = ctx.createGain();
    var rg = A.range(pad, buf), start = rg[0], end = rg[1], dur = end - start;
    var vol = pad.vol === undefined ? 1 : pad.vol;
    src.buffer = buf; src.connect(g); g.connect(A.bus);
    if (start > 0.001) { g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(vol, now + 0.004); }
    else g.gain.setValueAtTime(vol, now);
    if (pad.loop) {
      src.loop = true; src.loopStart = start; src.loopEnd = end;
      src.start(now, start);
    } else {
      if (end < buf.duration - 0.001 && dur > 0.03) {
        g.gain.setValueAtTime(vol, now + dur - 0.008);
        g.gain.linearRampToValueAtTime(0, now + dur);
      }
      src.start(now, start, dur);
    }
    var v = { id: pad.id, src: src, g: g, t0: now, dur: dur, loop: !!pad.loop };
    A.voices[pad.id] = v;
    src.onended = function () {
      try { g.disconnect(); } catch (e) {}
      if (A.voices[pad.id] === v) {
        delete A.voices[pad.id];
        if (A.onChange) A.onChange(pad.id);
      }
    };
    if (A.onChange) A.onChange(pad.id);
    return v;
  };

  A.stop = function (id, quiet) {
    var v = A.voices[id];
    if (!v) return;
    delete A.voices[id];
    var now = A.ctx.currentTime;
    try {
      v.g.gain.cancelScheduledValues(now);
      v.g.gain.setTargetAtTime(0, now, 0.008);
      v.src.stop(now + 0.05);
    } catch (e) {}
    if (!quiet && A.onChange) A.onChange(id);
  };

  // Bouton STOP : coupe toutes les voix et les queues de reverb/écho.
  A.stopAll = function () {
    var ids = Object.keys(A.voices), t = A.ctx.currentTime;
    ids.forEach(function (id) { A.stop(id); });
    A.killed = true;
    A.kill.gain.cancelScheduledValues(t);
    A.kill.gain.setTargetAtTime(0, t, 0.008);
    A.fb.gain.cancelScheduledValues(t);
    A.fb.gain.setValueAtTime(0, t);
    if (A.killT) clearTimeout(A.killT);
    A.killT = setTimeout(function () { A.killT = null; unkill(); }, 2600);
  };

  A.load = function (id) {
    if (A.buffers[id]) return Promise.resolve(A.buffers[id]);
    return D.get('samples', id).then(function (ab) {
      if (!ab) return null;
      var b = B.wavToBuffer(ab);
      A.buffers[id] = b;
      return b;
    });
  };

  // Décode un fichier importé et l'enregistre en WAV. Renvoie {id, buffer}.
  A.importAudio = function (arrayBuffer) {
    return new Promise(function (res, rej) {
      var done = false;
      function ok(buf) { if (!done) { done = true; res(buf); } }
      function ko(e) { if (!done) { done = true; rej(e || new Error('decode')); } }
      try {
        var p = A.ctx.decodeAudioData(arrayBuffer, ok, ko);
        if (p && p.then) p.then(ok, ko);
      } catch (e) { ko(e); }
    }).then(function (buf) {
      if (!buf || !buf.length) throw new Error('vide');
      if (buf.duration > B.MAX_SEC) { var e = new Error('long'); e.tooLong = true; throw e; }
      return A.storeBuffer(buf);
    });
  };

  A.storeBuffer = function (buf, from, to) {
    var id = B.uid('s'), wav = B.bufferToWav(buf, from, to);
    return D.put('samples', id, wav).then(function () {
      // On relit le WAV : ce qu'on joue est exactement ce qui est stocké.
      A.buffers[id] = B.wavToBuffer(wav);
      return { id: id, buffer: A.buffers[id] };
    });
  };

  // Début/fin du signal utile (saute les silences d'en-tête des MP3).
  A.autoTrim = function (buf) {
    var d = buf.getChannelData(0), n = d.length, a = 0, b = n - 1;
    while (a < n && Math.abs(d[a]) < 0.012) a++;
    while (b > a && Math.abs(d[b]) < 0.004) b--;
    if (a >= n - 1) return [0, buf.duration];
    var sr = buf.sampleRate;
    return [Math.max(0, a / sr - 0.003), Math.min(buf.duration, b / sr + 0.02)];
  };

  // ====================== Config ======================
  function blankPads() { var a = [], i; for (i = 0; i < B.SLOTS; i++) a.push(null); return a; }
  B.newPage = function (n) {
    return { name: String(n), color: B.COLORS[(n - 1) % B.COLORS.length], pads: blankPads() };
  };

  // Sons d'origine : synthétisés puis stockés (premier lancement / remise à zéro).
  B.buildFactory = function (onProgress) {
    var defs = B.FACTORY, i = 0;
    var cfg = { v: 1, fx: { type: 'reverb', amt: 0 }, vibrate: true, cur: 0, pages: [] };
    B.FACTORY_PAGES.forEach(function (pg) { cfg.pages.push({ name: pg.name, color: pg.color, pads: blankPads() }); });
    return new Promise(function (res, rej) {
      (function next() {
        if (i >= defs.length) { res(cfg); return; }
        var d = defs[i], pcm, id = B.uid('s');
        try { pcm = d.make(); } catch (e) { rej(e); return; }
        D.put('samples', id, B.encodeWav([pcm], B.SR)).then(function () {
          cfg.pages[Math.floor(i / B.SLOTS)].pads[i % B.SLOTS] = {
            id: B.uid('p'), name: d.name, color: d.color, mode: d.mode, loop: !!d.loop,
            vol: 1, sample: id, start: 0, end: pcm.length / B.SR
          };
          i++;
          if (onProgress) onProgress(i, defs.length);
          setTimeout(next, 0);
        }, rej);
      })();
    });
  };

  function str(v, def, max) { return typeof v === 'string' ? v.substr(0, max) : def; }
  function num(v, def, lo, hi) { return typeof v === 'number' && v === v ? Math.max(lo, Math.min(hi, v)) : def; }
  function color(v, def) { return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : def; }

  // Remet d'aplomb une config lue (import, ancienne version, données abîmées).
  B.sanitize = function (raw, hasSample) {
    var cfg = { v: 1, fx: { type: 'reverb', amt: 0 }, vibrate: true, cur: 0, pages: [] };
    if (!raw || typeof raw !== 'object') raw = {};
    if (raw.fx && typeof raw.fx === 'object') {
      B.FX.forEach(function (f) { if (f[0] === raw.fx.type) cfg.fx.type = f[0]; });
      cfg.fx.amt = num(raw.fx.amt, 0, 0, 1);
    }
    cfg.vibrate = raw.vibrate !== false;
    (raw.pages instanceof Array ? raw.pages : []).slice(0, B.MAX_PAGES).forEach(function (pg, k) {
      var page = B.newPage(k + 1);
      if (pg && typeof pg === 'object') {
        page.name = str(pg.name, page.name, 12);
        page.color = color(pg.color, page.color);
        (pg.pads instanceof Array ? pg.pads : []).slice(0, B.SLOTS).forEach(function (p, i) {
          if (!p || typeof p !== 'object' || typeof p.sample !== 'string') return;
          if (hasSample && !hasSample(p.sample)) return;
          page.pads[i] = {
            id: B.uid('p'), name: str(p.name, '', 24), color: color(p.color, B.COLORS[i % B.COLORS.length]),
            mode: p.mode === 'toggle' || p.mode === 'gate' ? p.mode : 'oneshot', loop: !!p.loop,
            vol: num(p.vol, 1, 0, 2), sample: p.sample, start: num(p.start, 0, 0, 1e5),
            end: typeof p.end === 'number' ? num(p.end, 0, 0, 1e5) : null
          };
        });
      }
      cfg.pages.push(page);
    });
    if (!cfg.pages.length) cfg.pages.push(B.newPage(1));
    cfg.cur = Math.floor(num(raw.cur, 0, 0, cfg.pages.length - 1));
    return cfg;
  };

  // ====================== Export / import ======================
  // Fichier .boucan : "BOUCAN01" + uint32 (taille de l'en-tête) + en-tête JSON
  // UTF-8 (config + table des sons) + les WAV bout à bout.
  var MAGIC = 'BOUCAN01';

  function utf8(s) {
    var b = unescape(encodeURIComponent(s)), u = new Uint8Array(b.length), i;
    for (i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
    return u;
  }
  function unutf8(u) {
    var s = '', i, K = 8000;
    for (i = 0; i < u.length; i += K) s += String.fromCharCode.apply(null, u.subarray(i, i + K));
    return decodeURIComponent(escape(s));
  }
  function two(n) { return n < 10 ? '0' + n : '' + n; }

  B.exportParts = function () {
    var ids = [], seen = {}, blobs = [];
    eachPad(B.cfg, function (p) { if (!seen[p.sample]) { seen[p.sample] = 1; ids.push(p.sample); } });
    return ids.reduce(function (ch, id) {
      return ch.then(function () { return D.get('samples', id); }).then(function (ab) { blobs.push(ab || new ArrayBuffer(0)); });
    }, Promise.resolve()).then(function () {
      var d = new Date(), size = 0;
      var head = utf8(JSON.stringify({
        app: 'boucan', format: 1, version: B.VERSION, date: d.toISOString(), config: B.cfg,
        samples: ids.map(function (id, k) { return { id: id, size: blobs[k].byteLength }; })
      }));
      var pre = new Uint8Array(12 + head.length), i;
      for (i = 0; i < 8; i++) pre[i] = MAGIC.charCodeAt(i);
      new DataView(pre.buffer).setUint32(8, head.length, true);
      pre.set(head, 12);
      var parts = [pre.buffer].concat(blobs);
      parts.forEach(function (p) { size += p.byteLength; });
      return {
        name: 'boucan-' + d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) + '-' + two(d.getHours()) + two(d.getMinutes()) + '.boucan',
        parts: parts, size: size
      };
    });
  };

  B.parseExport = function (ab) {
    var u = new Uint8Array(ab), i;
    if (u.length < 12) throw new Error('format');
    for (i = 0; i < 8; i++) if (u[i] !== MAGIC.charCodeAt(i)) throw new Error('format');
    var hl = new DataView(ab).getUint32(8, true);
    if (12 + hl > u.length) throw new Error('format');
    var head = JSON.parse(unutf8(u.subarray(12, 12 + hl)));
    if (!head || head.app !== 'boucan' || !(head.samples instanceof Array)) throw new Error('format');
    var off = 12 + hl, samples = [];
    head.samples.forEach(function (s) {
      if (typeof s.id !== 'string' || typeof s.size !== 'number' || s.size < 0 || off + s.size > u.length) throw new Error('format');
      samples.push({ id: s.id, data: ab.slice(off, off + s.size) });
      off += s.size;
    });
    return { config: head.config, samples: samples };
  };

  // Remplace toute la config par celle du fichier.
  B.applyImport = function (parsed) {
    var have = {};
    parsed.samples.forEach(function (s) { if (s.data.byteLength > 44) have[s.id] = 1; });
    var cfg = B.sanitize(parsed.config, function (id) { return !!have[id]; });
    A.stopAll();
    A.buffers = {};
    return D.clear('samples').then(function () {
      return parsed.samples.reduce(function (ch, s) {
        if (!have[s.id]) return ch;
        return ch.then(function () { return D.put('samples', s.id, s.data); });
      }, Promise.resolve());
    }).then(function () {
      B.cfg = cfg;
      return B.saveNow();
    });
  };

  function b64(u8) {
    var s = '', i, K = 8190;
    for (i = 0; i < u8.length; i += K) s += String.fromCharCode.apply(null, u8.subarray(i, i + K));
    return window.btoa(s);
  }

  // Android : le fichier passe au natif par morceaux base64, qui l'enregistre
  // (action "save") ou ouvre le partage (action "share").
  B.nativeExport = function (action) {
    return B.exportParts().then(function (ex) {
      var Nv = window.BoucanNative, CH = 196608;
      Nv.exportBegin(ex.name);
      ex.parts.forEach(function (ab) {
        var u = new Uint8Array(ab), o;
        for (o = 0; o < u.length; o += CH) Nv.exportChunk(b64(u.subarray(o, o + CH)));
      });
      Nv.exportEnd(action);
      return ex;
    });
  };

  // Navigateur : téléchargement classique.
  B.webExport = function () {
    return B.exportParts().then(function (ex) {
      var blob = new Blob(ex.parts, { type: 'application/octet-stream' });
      var url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = ex.name;
      document.body.appendChild(a); a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 2000);
      return ex;
    });
  };
})(window.Boucan = window.Boucan || {});
