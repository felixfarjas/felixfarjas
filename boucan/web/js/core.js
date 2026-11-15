/*
 * Boucan — stockage (IndexedDB), moteur audio (Web Audio), import/export.
 * ES5 uniquement : doit tourner sur de vieilles WebView Android.
 */
(function (B) {
  'use strict';

  if (!Math.tanh) {
    Math.tanh = function (x) {
      var e = Math.exp(2 * x);
      return e === Infinity ? 1 : (e - 1) / (e + 1);
    };
  }

  B.VERSION = '1.9';
  B.COLORS = ['#E53935', '#FB8C00', '#FDD835', '#43A047', '#00ACC1', '#1E88E5', '#8E24AA', '#EC407A', '#ECEFF1', '#546E7A'];
  B.MAX_PAGES = 8;
  B.SLOTS = 8;
  B.KEEP_SEC = 30;   // au-delà, on ne garde que la partie recadrée
  B.MAX_SEC = 600;   // durée max d'un son importé
  B.MAX_BYTES = 60 * 1024 * 1024;
  B.FX = ['reverb', 'echo', 'highcut', 'lowcut', 'mega', 'disto', 'flanger', 'gate'];
  B.FX_DEFAULT = ['reverb', 'echo', 'highcut', 'lowcut'];
  B.FADES = [0, 0.1, 0.5, 2];
  // effets DJ des cases FX (appliqués à tout ce qui joue)
  B.PAD_FX = ['brake', 'reverb', 'echo', 'highcut', 'lowcut', 'gate', 'loop', 'pitch', 'cut'];
  // Réglages de chaque effet de case (curseurs 0..1) et leurs valeurs de départ.
  B.PAD_FX_PAR = {
    brake: ['brakeTime'], reverb: ['amount'], echo: ['echoTime', 'repeats'], highcut: ['amount', 'sweep'],
    lowcut: ['amount', 'sweep'], gate: ['rate', 'depth'], loop: ['loopLen'], pitch: ['pitchSt'], cut: ['fade']
  };
  B.PAD_FX_DEF = { brake: [0.55], reverb: [1], echo: [0.6, 0.8], highcut: [1, 0.26], lowcut: [1, 0.26], gate: [0.54, 1], loop: [0.35], pitch: [0.75], cut: [0] };
  B.TARGETS = ['all', 'pads', 'music'];
  B.DUCKS = ['none', 'duck', 'pause'];
  // Cases larges (toute la largeur) et leur hauteur en rangées : le widget
  // Spotify et le lecteur de fichiers.
  B.ROWS = { player: 1, deck: 3 };
  // Renvoie la case d'ancrage du widget qui recouvre la case i, ou -1.
  B.cover = function (pg, i) {
    for (var a = 0; a < i; a += 2) {
      var p = pg.pads[a], r = p && B.ROWS[p.type];
      if (r && i < a + 2 * r) return a;
    }
    return -1;
  };
  // Valeurs réelles d'une case FX, d'après ses curseurs.
  B.padFxVal = function (pad) {
    var d = B.PAD_FX_DEF[pad.fx] || [0, 0], f = pad.fx;
    var p1 = typeof pad.p1 === 'number' ? pad.p1 : d[0], p2 = typeof pad.p2 === 'number' ? pad.p2 : (d[1] || 0);
    var v = { type: f, amt: 1 };
    if (f === 'brake') v.time = 0.2 * Math.pow(15, p1);
    else if (f === 'reverb') v.amt = 0.3 + 0.7 * p1;
    else if (f === 'echo') { v.time = 0.08 * Math.pow(10, p1); v.fb = 0.2 + 0.7 * p2; }
    else if (f === 'highcut' || f === 'lowcut') { v.amt = 0.3 + 0.7 * p1; v.sweep = 0.02 + 1.5 * p2 * p2; }
    else if (f === 'gate') { v.hz = 2 * Math.pow(10, p1); v.amt = 0.3 + 0.7 * p2; }
    else if (f === 'loop') v.len = 0.5 * Math.pow(0.012, p1); // 500 ms -> 6 ms
    else if (f === 'pitch') v.st = Math.round((p1 - 0.5) * 24); // -12 à +12 demi-tons
    else if (f === 'cut') v.sweep = 0.004 + 0.5 * p1 * p1;
    return v;
  };
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
      pg.pads.forEach(function (p, i) {
        if (!p) return;
        fn(p, pi, i);
        // un hub contient jusqu'à 4 petites cases
        if (p.type === 'hub') p.subs.forEach(function (q) { if (q) fn(q, pi, i); });
      });
    });
  }
  B.eachPad = function (fn) { eachPad(B.cfg, fn); };
  // Tous les sons stockés dont une config a besoin (son joué + prise micro brute).
  function sampleIds(cfg) {
    var ids = [], seen = {};
    eachPad(cfg, function (p) {
      [p.sample, p.rawSample].forEach(function (id) { if (id && !seen[id]) { seen[id] = 1; ids.push(id); } });
    });
    return ids;
  }

  // Supprime les sons qui ne sont plus utilisés par aucune case.
  B.gc = function () {
    var used = {};
    sampleIds(B.cfg).forEach(function (id) { used[id] = 1; });
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

  // Fondu « naturel » : la courbe ralentit vers le silence, pour que la fin
  // ne semble pas coupée net comme avec une rampe droite.
  var HOLD = typeof AudioParam !== 'undefined' && !!AudioParam.prototype.cancelAndHoldAtTime;
  A.fade = function (p, from, to, t0, dur) {
    if (!(dur > 0.003)) { p.setValueAtTime(to, t0); return; }
    if (!HOLD) { p.setValueAtTime(from, t0); p.linearRampToValueAtTime(to, t0 + dur); return; }
    var n = 24, c = new Float32Array(n), i, x;
    for (i = 0; i < n; i++) {
      x = i / (n - 1);
      c[i] = to < from ? to + (from - to) * (1 - x) * (1 - x) : from + (to - from) * x * x;
    }
    p.setValueCurveAtTime(c, t0, dur);
  };
  // Fige un paramètre à sa valeur du moment (même en plein fondu) et la renvoie.
  A.freeze = function (p, t) {
    if (HOLD) p.cancelAndHoldAtTime(t); else p.cancelScheduledValues(t);
    return p.value;
  };

  function impulse(ctx, sec) {
    var sr = ctx.sampleRate, n = Math.floor(sec * sr), ir = ctx.createBuffer(2, n, sr), c, i;
    for (c = 0; c < 2; c++) {
      var d = ir.getChannelData(c);
      for (i = 0; i < n; i++) {
        var t = i / n;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.5) * (i < 200 ? i / 200 : 1);
      }
    }
    return ir;
  }
  function driveCurve(k, out) {
    var n = 1024, c = new Float32Array(n), i;
    for (i = 0; i < n; i++) { var x = i * 2 / (n - 1) - 1; c[i] = Math.tanh(x * k) * out; }
    return c;
  }

  /*
   * Chaîne : voix et micro -> bus -> cut -> coupe-bas -> coupe-haut -> [net | mégaphone | disto] -> mix
   *   mix -> direct -> hachoir -> sortie        mix -> flanger -> hachoir
   *   mix -> reverb -> sortie                   mix -> écho -> sortie
   * sortie -> coupure (STOP) -> limiteur -> haut-parleur
   */
  B.LATS = ['low', 'mid', 'high'];
  B.RATES = [0, 44100, 32000, 22050];
  B.audioPrefs = function () {
    var p = {};
    try { p = JSON.parse(window.localStorage.getItem('boucan.audio') || '{}') || {}; } catch (e) {}
    return { lat: B.LATS.indexOf(p.lat) >= 0 ? p.lat : 'low', sr: B.RATES.indexOf(p.sr) >= 0 ? p.sr : 0 };
  };
  B.setAudioPrefs = function (p) {
    try { window.localStorage.setItem('boucan.audio', JSON.stringify(p)); return true; } catch (e) { return false; }
  };

  A.init = function () {
    var AC = window.AudioContext || window.webkitAudioContext, ctx;
    // Réglages audio de ce téléphone (menu) : taille du tampon et fréquence
    // d'échantillonnage. Un tampon plus grand ou une fréquence plus basse
    // évitent les craquements sur un téléphone lent, au prix de la réactivité.
    var pf = B.audioPrefs(), opt = { latencyHint: pf.lat === 'high' ? 'playback' : pf.lat === 'mid' ? 0.07 : 'interactive' };
    if (pf.sr) opt.sampleRate = pf.sr;
    try { ctx = new AC(opt); } catch (e) {
      try { ctx = new AC({ latencyHint: opt.latencyHint }); } catch (e2) { ctx = new AC(); }
    }
    A.ctx = ctx;
    function gain(v) { var g = ctx.createGain(); g.gain.value = v; return g; }
    function filter(type, f, q) {
      var b = ctx.createBiquadFilter();
      b.type = type; b.frequency.value = f; b.Q.value = q || 0.7;
      return b;
    }

    // bus : entrée des sons de la soundboard (cases, micro) ; fxIn : entrée de la chaîne d'effets
    var bus = A.bus = gain(1), fxIn = A.fxIn = gain(1), cutG = A.cutG = gain(1);
    var hp = A.hp = filter('highpass', 20), lp = A.lp = filter('lowpass', 20000);
    var clean = A.clean = gain(1), mix = gain(1), dry = A.dry = gain(1);
    var mHp = filter('highpass', 600), mLp = filter('lowpass', 2800);
    var mSh = ctx.createWaveShaper(); mSh.curve = driveCurve(6, 0.8);
    var mega = A.mega = gain(0);
    var dSh = ctx.createWaveShaper(); dSh.curve = driveCurve(25, 0.45);
    var disto = A.disto = gain(0);
    var trem = A.trem = gain(1), kill = A.kill = gain(1);

    var comp = A.comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.knee.value = 10; comp.ratio.value = 12;
    comp.attack.value = 0.002; comp.release.value = 0.2;

    var revSend = A.revSend = gain(0), conv = ctx.createConvolver();
    conv.buffer = impulse(ctx, 3.2);
    var eSend = A.eSend = gain(0), delay = A.delay = ctx.createDelay(1), eLp = filter('lowpass', 3500), fb = A.fb = gain(0.35);
    delay.delayTime.value = 0.32;
    var fl = ctx.createDelay(0.05), flWet = A.flWet = gain(0), flFb = A.flFb = gain(0.3);
    fl.delayTime.value = 0.004;

    // Boucle (LOOP) : tout passe en permanence dans une ligne à retard ; à
    // l'enclenchement on ferme son entrée et on la reboucle sur elle-même :
    // la dernière tranche de son tourne en rond.
    var pre = gain(1), lDry = A.lDry = gain(1), lGate = A.lGate = gain(1), lDel = A.lDel = ctx.createDelay(1);
    var lFb = A.lFb = gain(0), lWet = A.lWet = gain(0);
    lDel.delayTime.value = 0.1;
    pre.connect(lDry); lDry.connect(kill);
    pre.connect(lGate); lGate.connect(lDel); lDel.connect(lWet); lWet.connect(kill); lDel.connect(lFb); lFb.connect(lDel);

    fxIn.connect(cutG); cutG.connect(hp); hp.connect(lp);
    lp.connect(clean); clean.connect(mix);
    // Reverb, mégaphone et disto coûtent cher : ils ne sont branchés que
    // lorsqu'ils servent (voir link), sinon ils tourneraient pour rien.
    A.links = { rev: [revSend, conv, 6000], mega: [lp, mHp, 300], disto: [lp, dSh, 300] };
    mHp.connect(mLp); mLp.connect(mSh); mSh.connect(mega); mega.connect(mix);
    dSh.connect(disto); disto.connect(mix);
    mix.connect(dry); dry.connect(trem);
    mix.connect(fl); fl.connect(flWet); flWet.connect(trem); fl.connect(flFb); flFb.connect(fl);
    trem.connect(pre);
    mix.connect(revSend); conv.connect(pre);
    mix.connect(eSend); eSend.connect(delay); delay.connect(eLp); eLp.connect(fb); fb.connect(delay); eLp.connect(pre);
    kill.connect(comp); comp.connect(ctx.destination);

    // Oscillateurs lents : balayage du flanger, hachoir.
    A.tremDepth = gain(0);
    try {
      var lfo = ctx.createOscillator(), lfoG = gain(0.0025);
      lfo.frequency.value = 0.3; lfo.connect(lfoG); lfoG.connect(fl.delayTime); lfo.start(0);
      var chop = A.chop = ctx.createOscillator();
      chop.type = 'square'; chop.frequency.value = 7;
      // le carré est arrondi (2 ms de fondu) : plus de clic à chaque hachure
      var chopLp = filter('lowpass', 180, 0.5);
      chop.connect(chopLp); chopLp.connect(A.tremDepth); A.tremDepth.connect(trem.gain); chop.start(0);
    } catch (e) {}
    A.route();
  };

  // Cible des effets : 'all' (tout), 'pads' (soundboard seule) ou 'music'
  // (lecteur de musique seul). Ce qui n'est pas visé contourne la chaîne.
  A.target = 'all';
  A.pitchK = 1;
  A.route = function () {
    try { A.bus.disconnect(); } catch (e) {}
    A.bus.connect(A.target === 'music' ? A.comp : A.fxIn);
    if (B.deck) B.deck.route();
  };
  function padRate() { return A.target === 'music' ? 1 : A.pitchK; }
  // Hauteur (effet PITCH) : comme sur une platine, vitesse et hauteur vont ensemble.
  function retune() {
    var t = A.ctx.currentTime, id;
    if (B.deck) B.deck.setRate(A.target === 'pads' ? 1 : A.pitchK);
    if (A.braked) return;
    for (id in A.voices) {
      try {
        var r = A.voices[id].src.playbackRate;
        r.cancelScheduledValues(t);
        r.setTargetAtTime(padRate(), t, 0.03);
      } catch (e) {}
    }
  }
  A.setTarget = function (tg) {
    if (A.braked) brake(false);
    A.target = B.TARGETS.indexOf(tg) >= 0 ? tg : 'all';
    A.route();
    retune();
  };

  A.resume = function () {
    var ctx = A.ctx;
    if (ctx && ctx.state && ctx.state !== 'running' && ctx.resume) {
      try { var p = ctx.resume(); if (p && p['catch']) p['catch'](function () {}); } catch (e) {}
    }
  };

  // Deux sources d'effet se cumulent : le curseur (un effet, dosage 0..1) et
  // les cases FX tenues ou enclenchées (réglées par leurs curseurs). À fond,
  // l'effet est radical, comme sur une table de DJ.
  A.fx = { type: 'reverb', amt: 0 };
  A.fxPads = {}; // id de case -> valeurs de l'effet (B.padFxVal)

  // Branche un étage coûteux quand il sert, le débranche une fois sa queue éteinte.
  function link(key, on) {
    var L = A.links[key];
    if (on) {
      if (L.t) { clearTimeout(L.t); L.t = null; }
      if (!L.on) { L[0].connect(L[1]); L.on = true; }
    } else if (L.on && !L.t) {
      L.t = setTimeout(function () {
        L.t = null;
        try { L[0].disconnect(L[1]); L.on = false; } catch (e) {} // vieux moteurs : on laisse branché
      }, L[2]);
    }
  }

  // tc : temps de réponse général ; ftc : celui des filtres et du cut.
  function applyFx(tc, ftc) {
    var t = A.ctx.currentTime, amt = {}, P = {}, id;
    if (ftc === undefined) ftc = tc;
    amt[A.fx.type] = A.fx.amt;
    for (id in A.fxPads) {
      var f = A.fxPads[id];
      amt[f.type] = Math.max(amt[f.type] || 0, f.amt);
      P[f.type] = f;
    }
    function on(k) { return amt[k] || 0; }
    function set(p, v, c) { p.setTargetAtTime(v, t, c || tc); }
    var rev = on('reverb'), ech = on('echo'), hc = on('highcut'), lc = on('lowcut');
    var meg = on('mega'), dis = on('disto'), fla = on('flanger'), gat = on('gate'), cut = on('cut') ? 1 : 0;
    var hz = P.gate ? P.gate.hz : 7, lop = on('loop') ? 1 : 0;
    var pk = P.pitch ? Math.pow(2, P.pitch.st / 12) : 1;
    if (pk !== A.pitchK) { A.pitchK = pk; retune(); }

    link('rev', rev > 0.001); link('mega', meg > 0.001); link('disto', dis > 0.001);
    A.fxEcho = ech;
    A.fxFb = P.echo ? P.echo.fb : 0.35 + 0.5 * ech;
    // reverb : le son direct s'efface et s'assourdit, il ne reste presque que la queue
    set(A.revSend.gain, 3.2 * Math.pow(rev, 0.8));
    set(A.dry.gain, Math.max(0, 1 - 0.88 * rev - 0.5 * ech));
    set(A.eSend.gain, 1.2 * ech);
    set(A.delay.delayTime, P.echo ? P.echo.time : 0.32, 0.05);
    if (!A.killed) set(A.fb.gain, A.fxFb);
    set(A.lp.frequency, 20000 * Math.pow(0.006, hc) * Math.pow(0.18, rev), ftc);
    set(A.lp.Q, 0.7 + 7 * hc, ftc);
    set(A.hp.frequency, 20 * Math.pow(400, lc), ftc);
    set(A.hp.Q, 0.7 + 7 * lc, ftc);
    set(A.mega.gain, 1.3 * meg);
    set(A.disto.gain, dis);
    set(A.clean.gain, Math.max(0, 1 - meg - dis));
    set(A.flWet.gain, fla);
    set(A.flFb.gain, 0.3 + 0.6 * fla);
    if (A.chop) set(A.chop.frequency, hz, 0.01);
    set(A.trem.gain, 1 - gat / 2);
    set(A.tremDepth.gain, gat / 2);
    if (P.loop) set(A.lDel.delayTime, P.loop.len, 0.004);
    set(A.lGate.gain, 1 - lop, 0.003); set(A.lFb.gain, lop, 0.003);
    set(A.lDry.gain, 1 - lop, 0.003); set(A.lWet.gain, lop, 0.003);
    A.cutG.gain.setTargetAtTime(cut ? 0 : 1, t, P.cut ? P.cut.sweep : Math.min(ftc, 0.004));
  }

  A.setFx = function (type, a) {
    A.fx = { type: type, amt: a };
    applyFx(0.03);
  };

  // Vinyl stop : toutes les voix ralentissent jusqu'à l'arrêt, puis repartent.
  function brake(on, time) {
    var t = A.ctx.currentTime, id;
    A.braked = on;
    if (B.deck && A.target !== 'pads') B.deck.brake(on, time);
    if (A.target === 'music') return;
    for (id in A.voices) {
      var r = A.voices[id].src.playbackRate;
      try {
        r.cancelScheduledValues(t);
        r.setValueAtTime(r.value, t);
        r.linearRampToValueAtTime(on ? 0.001 : padRate(), t + (on ? time || 0.9 : 0.35));
      } catch (e) {}
    }
  }

  // Case FX : enclenche ou relâche un effet DJ sur tout ce qui joue.
  A.padFx = function (pad, on) {
    var id = pad.id, had = A.fxPads[id];
    if (!on && !had) return;
    if (on) { unkill(); A.fxPads[id] = B.padFxVal(pad); } else delete A.fxPads[id];
    var k, braking = null;
    for (k in A.fxPads) if (A.fxPads[k].type === 'brake') braking = A.fxPads[k];
    if (!!braking !== !!A.braked) brake(!!braking, braking && braking.time);
    // les filtres balaient, le reste claque
    var f = on ? A.fxPads[id] : had;
    applyFx(0.03, f.sweep || 0.03);
    if (A.onChange) A.onChange(id);
  };

  // Les réglages d'une case FX enclenchée ont changé (glissé en direct).
  A.padFxUpdate = function (pad) {
    if (!A.fxPads[pad.id]) return;
    A.fxPads[pad.id] = B.padFxVal(pad);
    applyFx(0.03, 0.04);
  };

  function unkill() {
    if (!A.killed) return;
    A.killed = false;
    if (A.killT) { clearTimeout(A.killT); A.killT = null; }
    var t = A.ctx.currentTime;
    A.kill.gain.cancelScheduledValues(t);
    A.kill.gain.setTargetAtTime(1, t, 0.004);
    A.fb.gain.setTargetAtTime(A.fxFb || 0.35, t, 0.01);
  }

  A.unkill = unkill;

  A.range = function (pad, buf) {
    var d = buf.duration, s = Math.max(0, Math.min(pad.start || 0, d - 0.02));
    var e = Math.max(s + 0.02, Math.min(pad.end === undefined || pad.end === null ? d : pad.end, d));
    return [s, e];
  };

  // from (optionnel) : position de départ dans le son, pour reprendre après une pause.
  // buf (optionnel) : joue ce son-là plutôt que celui de la case (prise micro).
  A.play = function (pad, from, buf) {
    buf = buf || A.buffers[pad.sample];
    if (!buf) return null;
    A.resume();
    unkill();
    if (A.voices[pad.id]) A.stop(pad.id, true, true);
    var ctx = A.ctx, now = ctx.currentTime, src = ctx.createBufferSource(), g = ctx.createGain();
    var rg = A.range(pad, buf), start = rg[0], end = rg[1], dur = end - start;
    var at = typeof from === 'number' && from > start && from < end - 0.02 ? from : start, left = end - at;
    var vol = pad.vol === undefined ? 1 : pad.vol, fi = pad.fadeIn || 0, fo = pad.fadeOut || 0;
    src.buffer = buf; src.connect(g); g.connect(A.bus);
    if (padRate() !== 1) src.playbackRate.value = padRate();
    if (!pad.loop) { fi = Math.min(fi, left / 2 - 0.005); fo = Math.min(fo, left / 2 - 0.005); }
    if (fi > 0) { g.gain.setValueAtTime(0, now); A.fade(g.gain, 0, vol, now, fi); }
    else if (at > 0.001) { g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(vol, now + 0.004); }
    else g.gain.setValueAtTime(vol, now);
    if (pad.loop) {
      src.loop = true; src.loopStart = start; src.loopEnd = end;
      src.start(now, at);
    } else {
      if (fo > 0) {
        A.fade(g.gain, vol, 0, now + left - fo, fo);
      } else if (end < buf.duration - 0.001 && left > 0.03) {
        g.gain.setValueAtTime(vol, now + left - 0.008);
        g.gain.linearRampToValueAtTime(0, now + left);
      }
      src.start(now, at, left);
    }
    var v = { id: pad.id, src: src, g: g, t0: now - (at - start), start: start, dur: dur, loop: !!pad.loop, rel: pad.fadeOut || 0 };
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

  // Position de lecture d'une voix, en secondes dans le son.
  A.pos = function (v) {
    var gone = Math.max(0, A.ctx.currentTime - v.t0);
    return v.start + (v.loop ? gone % v.dur : Math.min(gone, v.dur));
  };

  // fast : coupe net (STOP, relance) ; sinon le fondu de sortie de la case s'applique.
  A.stop = function (id, quiet, fast) {
    var v = A.voices[id];
    if (!v) return;
    delete A.voices[id];
    var now = A.ctx.currentTime, rel = fast || !v.rel ? 0.03 : v.rel;
    try {
      var cur = A.freeze(v.g.gain, now);
      if (rel > 0.05) A.fade(v.g.gain, cur, 0, now, rel); else v.g.gain.setTargetAtTime(0, now, rel / 4);
      v.src.stop(now + rel + 0.03);
    } catch (e) {}
    if (!quiet && A.onChange) A.onChange(id);
  };

  // Bouton STOP : coupe toutes les voix et les queues de reverb/écho.
  A.stopAll = function () {
    var ids = Object.keys(A.voices), t = A.ctx.currentTime;
    ids.forEach(function (id) { A.stop(id, false, true); });
    var fxIds = Object.keys(A.fxPads);
    A.fxPads = {};
    if (A.braked) brake(false);
    if (fxIds.length) { applyFx(0.03); fxIds.forEach(function (id) { if (A.onChange) A.onChange(id); }); }
    if (B.mic && B.mic.on) B.mic.stop(true);
    if (B.deck) B.deck.pause();
    A.killed = true;
    A.kill.gain.cancelScheduledValues(t);
    A.kill.gain.setTargetAtTime(0, t, 0.008);
    A.fb.gain.cancelScheduledValues(t);
    A.fb.gain.setValueAtTime(0, t);
    if (A.killT) clearTimeout(A.killT);
    A.killT = setTimeout(function () { A.killT = null; unkill(); }, 3400);
  };

  // Échantillons bruts (mono) -> AudioBuffer.
  A.pcmBuffer = function (pcm, sr) {
    var b = A.ctx.createBuffer(1, Math.max(1, pcm.length), sr || A.ctx.sampleRate);
    b.getChannelData(0).set(pcm);
    return b;
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

  function tool(type, a, fr, en, color) {
    return { type: type, micMode: a, fx: a, name: [fr, en], color: color };
  }
  // Pages d'origine : les sons synthétisés (js/synth.js) et, mêlés à eux, le
  // micro et les effets DJ. Une chaîne désigne un son de B.FACTORY.
  B.FACTORY_LAYOUT = [
    { name: ['AMBIANCE', 'CROWD'], color: '#E53935', pads: ['airhorn', 'siren', 'whistle', 'vuvuzela', 'clapStade', 'batucada',
      tool('mic', 'live', 'MÉGAPHONE', 'MEGAPHONE', '#FB8C00'), tool('fx', 'highcut', 'COUPE-HAUT', 'HIGH CUT', '#1E88E5')] },
    { name: ['RÉFS', 'TUNES'], color: '#1E88E5', pads: ['bellaCiao', 'cancan', 'toreador', 'walkyries', 'cucaracha', 'marcheFunebre',
      tool('fx', 'brake', 'VINYL STOP', 'VINYL STOP', '#FDD835'), tool('fx', 'reverb', 'REVERB', 'REVERB', '#43A047')] },
    { name: ['MIX', 'MIX'], color: '#8E24AA', pads: ['techno', 'drop', 'badumtss', 'tromboneTriste',
      tool('mic', 'after', 'MICRO', 'MIC', '#E53935'), tool('fx', 'echo', 'ÉCHO', 'ECHO', '#00ACC1'),
      tool('fx', 'gate', 'HACHOIR', 'CHOPPER', '#8E24AA'), tool('fx', 'cut', 'CUT', 'CUT', '#EC407A')] },
    { name: ['MUSIQUE', 'MUSIC'], color: '#43A047', pads: [tool('deck', '', 'LECTEUR', 'PLAYER', '#37474F'), null, null, null, null, null, tool('player', '', 'PHONE CONTROL', 'PHONE CONTROL', '#2E7D32')] }
  ];

  // Premier lancement / remise à zéro : synthétise les sons et les stocke
  // comme n'importe quel son importé.
  B.buildFactory = function (onProgress) {
    var en = B.lang === 'en' ? 1 : 0, jobs = [], i = 0;
    var cfg = { v: 1, fx: { type: 'reverb', amt: 0 }, fxList: B.FX_DEFAULT.slice(), duck: 'duck', duckFade: 0.3, swipe: true, editHold: false, fxTarget: 'all', deck: { root: '', sub: '', vol: 0.8, brake: 0.5, colors: {} },
      lang: B.lang, vibrate: true, cur: 0, pages: [] };
    B.FACTORY_LAYOUT.forEach(function (pg) {
      var page = { name: pg.name[en], color: pg.color, pads: blankPads() };
      pg.pads.forEach(function (d, k) {
        if (!d) return;
        if (typeof d === 'string') { jobs.push({ page: page, k: k, def: B.FACTORY[d] }); return; }
        var p = page.pads[k] = { id: B.uid('p'), type: d.type, name: d.name[en], color: d.color };
        if (d.type === 'mic') { p.micMode = d.micMode; p.denoise = 0.5; p.vol = 1; }
        else if (d.type === 'fx') { p.fx = d.fx; p.mode = 'gate'; }
      });
      cfg.pages.push(page);
    });
    return new Promise(function (res, rej) {
      (function next() {
        if (i >= jobs.length) { res(cfg); return; }
        var j = jobs[i], d = j.def, pcm, id = B.uid('s');
        try { pcm = d.make(); } catch (e) { rej(e); return; }
        D.put('samples', id, B.encodeWav([pcm], B.SR)).then(function () {
          j.page.pads[j.k] = {
            id: B.uid('p'), type: 'sample', name: d.name[en], color: d.color, mode: d.mode, loop: !!d.loop,
            vol: 1, sample: id, start: 0, end: pcm.length / B.SR, fadeIn: 0, fadeOut: 0
          };
          i++;
          if (onProgress) onProgress(i, jobs.length);
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
    // sub : petite case d'un hub (sample ou FX uniquement)
    function cleanPad(p, i, sub) {
      if (!p || typeof p !== 'object') return null;
      var base = { id: B.uid('p'), type: 'sample', name: str(p.name, '', 24), color: color(p.color, B.COLORS[i % B.COLORS.length]) };
      if (p.type === 'hub') {
        if (sub) return null;
        base.type = 'hub';
        base.subs = [0, 1, 2, 3].map(function (k) { return cleanPad(p.subs instanceof Array ? p.subs[k] : null, i + k, true); });
        if (!base.subs.some(function (q) { return !!q; })) return null;
      } else if (B.ROWS[p.type]) {
        if (sub || i % 2 || i + 2 * B.ROWS[p.type] > B.SLOTS) return null;
        base.type = p.type;
      } else if (p.type === 'mic') {
        if (sub) return null;
        base.type = 'mic';
        base.micMode = p.micMode === 'live' ? 'live' : 'after';
        base.denoise = num(p.denoise, 0.5, 0, 1);
        base.vol = num(p.vol, 1, 0, 1.5);
      } else if (p.type === 'fx') {
        base.type = 'fx';
        base.fx = B.PAD_FX.indexOf(p.fx) >= 0 ? p.fx : 'brake';
        base.mode = p.mode === 'toggle' ? 'toggle' : 'gate';
        base.live = !!p.live;
        if (typeof p.p1 === 'number') base.p1 = num(p.p1, 0, 0, 1);
        if (typeof p.p2 === 'number') base.p2 = num(p.p2, 0, 0, 1);
      } else {
        if (typeof p.sample !== 'string' || (hasSample && !hasSample(p.sample))) return null;
        base.mode = p.mode === 'toggle' || p.mode === 'gate' ? p.mode : 'oneshot';
        base.loop = !!p.loop;
        base.vol = num(p.vol, 1, 0, 1.5);
        base.sample = p.sample;
        base.start = num(p.start, 0, 0, 1e5);
        base.end = typeof p.end === 'number' ? num(p.end, 0, 0, 1e5) : null;
        base.fadeIn = num(p.fadeIn, 0, 0, 5);
        base.fadeOut = num(p.fadeOut, 0, 0, 5);
        // prise micro brute, pour pouvoir régler le débruiteur après coup
        if (typeof p.rawSample === 'string' && (!hasSample || hasSample(p.rawSample))) {
          base.rawSample = p.rawSample;
          base.denoise = num(p.denoise, 0.5, 0, 1);
        }
      }
      return base;
    }
    var cfg = { v: 1, fx: { type: 'reverb', amt: 0 }, fxList: [], lang: B.lang, vibrate: true, cur: 0, pages: [] };
    if (!raw || typeof raw !== 'object') raw = {};
    if (raw.lang === 'fr' || raw.lang === 'en') cfg.lang = raw.lang;
    // effets proposés par le bouton FX (toujours dans l'ordre de B.FX, jamais vide)
    var want = raw.fxList instanceof Array ? raw.fxList : B.FX_DEFAULT;
    B.FX.forEach(function (f) { if (want.indexOf(f) >= 0) cfg.fxList.push(f); });
    if (!cfg.fxList.length) cfg.fxList = B.FX_DEFAULT.slice();
    cfg.fx.type = cfg.fxList[0];
    if (raw.fx && typeof raw.fx === 'object') {
      var ty = raw.fx.type === 'filter' ? 'highcut' : raw.fx.type; // nom de la version 1.0
      if (cfg.fxList.indexOf(ty) >= 0) { cfg.fx.type = ty; cfg.fx.amt = num(raw.fx.amt, 0, 0, 1); }
    }
    cfg.vibrate = raw.vibrate !== false;
    cfg.duck = B.DUCKS.indexOf(raw.duck) >= 0 ? raw.duck : 'duck';
    cfg.swipe = raw.swipe !== false;
    cfg.editHold = raw.editHold === true;
    cfg.duckFade = num(raw.duckFade, 0.3, 0, 3);
    var dk = raw.deck && typeof raw.deck === 'object' ? raw.deck : {};
    cfg.deck = { root: str(dk.root, '', 500), sub: str(dk.sub, '', 500), vol: num(dk.vol, 0.8, 0, 1), brake: num(dk.brake, 0.5, 0, 3), colors: {} };
    // couleurs données aux morceaux (par identifiant)
    var cols = dk.colors && typeof dk.colors === 'object' ? dk.colors : {}, nc = 0, ck;
    for (ck in cols) if (nc < 3000 && color(cols[ck], '')) { cfg.deck.colors[ck] = cols[ck]; nc++; }
    cfg.fxTarget = B.TARGETS.indexOf(raw.fxTarget) >= 0 ? raw.fxTarget : dk.fx === false ? 'pads' : 'all';
    (raw.pages instanceof Array ? raw.pages : []).slice(0, B.MAX_PAGES).forEach(function (pg, k) {
      var page = B.newPage(k + 1);
      if (pg && typeof pg === 'object') {
        page.name = str(pg.name, page.name, 12);
        page.color = color(pg.color, page.color);
        (pg.pads instanceof Array ? pg.pads : []).slice(0, B.SLOTS).forEach(function (p, i) {
          var c = cleanPad(p, i, false);
          if (c) page.pads[i] = c;
        });
        // un widget recouvre plusieurs cases
        page.pads.forEach(function (p, i) { if (p && B.cover(page, i) >= 0) page.pads[i] = null; });
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

  // music (optionnel) : morceaux du lecteur à joindre [{id, dir, name, size, c}].
  // Ils sont décrits dans l'en-tête ; leurs octets suivent ceux des samples.
  B.exportParts = function (music) {
    var ids = sampleIds(B.cfg), blobs = [];
    music = music || [];
    return ids.reduce(function (ch, id) {
      return ch.then(function () { return D.get('samples', id); }).then(function (ab) { blobs.push(ab || new ArrayBuffer(0)); });
    }, Promise.resolve()).then(function () {
      var d = new Date(), size = 0;
      var head = utf8(JSON.stringify({
        app: 'boucan', format: 1, version: B.VERSION, date: d.toISOString(), config: B.cfg,
        samples: ids.map(function (id, k) { return { id: id, size: blobs[k].byteLength }; }),
        music: music.map(function (m) { return { dir: m.dir, name: m.name, size: m.size, c: m.c || '' }; })
      }));
      var pre = new Uint8Array(12 + head.length), i;
      for (i = 0; i < 8; i++) pre[i] = MAGIC.charCodeAt(i);
      new DataView(pre.buffer).setUint32(8, head.length, true);
      pre.set(head, 12);
      var parts = [pre.buffer].concat(blobs);
      parts.forEach(function (p) { size += p.byteLength; });
      music.forEach(function (m) { size += m.size; });
      return {
        name: 'boucan-' + d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) + '-' + two(d.getHours()) + two(d.getMinutes()) + '.boucan',
        parts: parts, size: size
      };
    });
  };

  function readSlice(blob) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.onerror = function () { rej(fr.error || new Error('lecture')); };
      fr.readAsArrayBuffer(blob);
    });
  }
  // Lit un fichier .boucan par tranches (il peut peser très lourd avec les
  // musiques) : la config et les samples en mémoire, les musiques restent
  // des tranches du fichier, lues plus tard une par une.
  B.readExport = function (f) {
    var head, off, samples = [], music = [];
    return readSlice(f.slice(0, 12)).then(function (ab) {
      var u = new Uint8Array(ab), i;
      if (u.length < 12) throw new Error('format');
      for (i = 0; i < 8; i++) if (u[i] !== MAGIC.charCodeAt(i)) throw new Error('format');
      off = 12 + new DataView(ab).getUint32(8, true);
      if (off > f.size) throw new Error('format');
      return readSlice(f.slice(12, off));
    }).then(function (hb) {
      head = JSON.parse(unutf8(new Uint8Array(hb)));
      if (!head || head.app !== 'boucan' || !(head.samples instanceof Array)) throw new Error('format');
      return head.samples.reduce(function (ch, s) {
        return ch.then(function () {
          if (typeof s.id !== 'string' || typeof s.size !== 'number' || s.size < 0 || off + s.size > f.size) throw new Error('format');
          var at = off;
          off += s.size;
          return readSlice(f.slice(at, at + s.size)).then(function (data) { samples.push({ id: s.id, data: data }); });
        });
      }, Promise.resolve());
    }).then(function () {
      (head.music instanceof Array ? head.music : []).forEach(function (m) {
        if (!m || typeof m.name !== 'string' || typeof m.size !== 'number' || m.size <= 0 || off + m.size > f.size) throw new Error('format');
        music.push({ dir: String(m.dir || ''), name: m.name, size: m.size, c: m.c || '', blob: f.slice(off, off + m.size) });
        off += m.size;
      });
      return { config: head.config, samples: samples, music: music };
    });
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
  B.nativeExport = function (action, music, onProgress) {
    music = music || [];
    return B.exportParts(music).then(function (ex) {
      var Nv = window.BoucanNative, CH = 196608;
      function send(u) { for (var o = 0; o < u.length; o += CH) Nv.exportChunk(b64(u.subarray(o, o + CH))); }
      Nv.exportBegin(ex.name);
      ex.parts.forEach(function (ab) { send(new Uint8Array(ab)); });
      // les musiques passent une par une, sans jamais être toutes en mémoire
      return music.reduce(function (ch, m, k) {
        return ch.then(function () {
          if (onProgress) onProgress(k + 1, music.length);
          return new Promise(function (res, rej) {
            var x = new XMLHttpRequest();
            x.open('GET', B.deck.base + 't/' + m.id, true);
            x.responseType = 'arraybuffer';
            x.onerror = function () { rej(new Error(m.name)); };
            x.onload = function () {
              if (x.status >= 400 || !x.response) { rej(new Error(m.name)); return; }
              // la taille annoncée dans l'en-tête fait foi
              var got = new Uint8Array(x.response), u = got;
              if (got.length !== m.size) { u = new Uint8Array(m.size); u.set(got.subarray(0, m.size)); }
              send(u);
              res();
            };
            x.send();
          });
        });
      }, Promise.resolve()).then(function () {
        Nv.exportEnd(action);
        return ex;
      });
    });
  };

  // Recopie dans le téléphone (dossier Music/Boucan) les musiques d'un fichier
  // importé. Renvoie le nombre de morceaux écrits.
  B.importMusic = function (music, onProgress) {
    var Nv = window.BoucanNative, CH = 1048576 + 524288, done = 0;
    if (!Nv || !Nv.musicImportBegin || !music.length) return Promise.resolve(0);
    return music.reduce(function (ch, m, k) {
      return ch.then(function () {
        if (onProgress) onProgress(k + 1, music.length);
        if (B.deck.has(m) || !Nv.musicImportBegin(m.dir, m.name)) return null;
        var o = 0;
        function next() {
          if (o >= m.size) { if (Nv.musicImportEnd()) done++; return null; }
          var part = m.blob.slice(o, o + CH);
          o += CH;
          return readSlice(part).then(function (ab) { Nv.musicImportChunk(b64(new Uint8Array(ab))); return next(); });
        }
        return next();
      });
    }, Promise.resolve()).then(function () { return done; });
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
