/*
 * Boucan — lecteur de musique intégré (case LECTEUR).
 * Lit les fichiers audio du téléphone : le natif en donne la liste et sert
 * chaque fichier à l'adresse https://boucan.music/t/<id> (rien ne sort du
 * téléphone). Le son passe par le moteur de Boucan : volume propre, effets.
 * ES5 uniquement : doit tourner sur de vieilles WebView Android.
 */
(function (B) {
  'use strict';

  var A = B.audio;
  // state : 'none' (pas de natif), 'perm' (autorisation à donner), 'ok'
  var D = B.deck = { base: 'https://boucan.music/', state: 'none', tracks: [], queue: [], track: null, rev: 0, wave: null, common: '', onChange: null };
  var au = null, gain = null, duckK = 1, rateT = null, errs = 0, want = false;
  var WAVE_N = 240, WAVE_MAX = 60 * 1024 * 1024;

  function nat() { return window.BoucanNative; }
  function cfg() { return B.cfg.deck; }
  function emit() { if (D.onChange) D.onChange(); }
  function low(s) { return String(s || '').toLowerCase(); }
  function cmp(x, y) { return x < y ? -1 : x > y ? 1 : 0; }
  function under(t, path) { return !path || t.p === path || t.p.indexOf(path + '/') === 0; }
  D.leaf = function (path) { return path ? path.substr(path.lastIndexOf('/') + 1) : ''; };

  D.load = function () {
    var N = nat(), r;
    if (!N || !N.musicList) { D.state = 'none'; emit(); return; }
    try { r = N.musicList(); } catch (e) { r = '[]'; }
    if (r === 'PERM') { D.state = 'perm'; D.tracks = []; }
    else {
      try { D.tracks = JSON.parse(r); } catch (e2) { D.tracks = []; }
      D.tracks.forEach(function (t) { t.p = t.p || ''; });
      D.state = 'ok';
    }
    // plus long dossier commun à tous les morceaux
    var com = null;
    D.tracks.forEach(function (t) {
      if (com === null) { com = t.p; return; }
      while (com && !under(t, com)) com = com.substr(0, com.lastIndexOf('/'));
    });
    D.common = com || '';
    D.queue = D.pick();
    D.rev++;
    emit();
  };
  D.ask = function () { try { nat().musicAsk(); } catch (e) {} };
  // appelé par le natif après la réponse à la demande d'autorisation
  B.deckPerm = function () { if (B.cfg) D.load(); };

  // Dossier source choisi dans les réglages (par défaut : là où sont toutes les musiques).
  D.root = function () { return cfg().root || D.common; };
  // Tous les dossiers qui contiennent de la musique (eux-mêmes ou plus bas) : candidats au dossier source.
  D.roots = function () {
    var m = {}, out = [], k;
    D.tracks.forEach(function (t) {
      var p = t.p;
      while (p && p.length >= D.common.length) { m[p] = (m[p] || 0) + 1; p = p.substr(0, p.lastIndexOf('/')); }
    });
    for (k in m) out.push({ key: k, n: m[k] });
    out.sort(function (x, y) { return cmp(low(x.key), low(y.key)); });
    return out;
  };
  // Sous-dossiers directs du dossier source ; '.' : les morceaux posés directement dedans.
  D.subs = function () {
    var root = D.root(), m = {}, out = [], here = 0, k;
    D.tracks.forEach(function (t) {
      if (!under(t, root)) return;
      if (t.p === root) { here++; return; }
      var rest = t.p.substr(root.length + 1), s = root + '/' + rest.split('/')[0];
      m[s] = (m[s] || 0) + 1;
    });
    for (k in m) out.push({ key: k, n: m[k] });
    out.sort(function (x, y) { return cmp(low(x.key), low(y.key)); });
    if (here && out.length) out.unshift({ key: '.', n: here });
    return out;
  };
  D.count = function () { var r = D.root(); return D.tracks.filter(function (t) { return under(t, r); }).length; };
  D.pick = function () {
    var root = D.root(), sub = cfg().sub;
    var q = D.tracks.filter(function (t) { return sub === '.' ? t.p === root : under(t, sub || root); });
    // par dossier, puis dans l'ordre des pistes, puis par titre
    q.sort(function (x, y) { return cmp(low(x.p), low(y.p)) || x.n - y.n || cmp(low(x.t), low(y.t)); });
    return q;
  };
  function relist() { D.queue = D.pick(); D.rev++; B.save(); emit(); }
  D.setSub = function (sub) { cfg().sub = sub; relist(); };
  D.setRoot = function (root) { cfg().root = root; cfg().sub = ''; relist(); };
  D.listName = function () { var s = cfg().sub; return s && s !== '.' ? D.leaf(s) : D.leaf(cfg().root); };

  function vol() { var v = cfg().vol; return v * v * duckK; }
  function ensure() {
    if (au) return;
    au = new Audio();
    au.crossOrigin = 'anonymous';
    au.preload = 'auto';
    try { au.preservesPitch = false; au.webkitPreservesPitch = false; } catch (e) {}
    gain = A.ctx.createGain();
    gain.gain.value = vol();
    A.ctx.createMediaElementSource(au).connect(gain);
    D.route();
    au.addEventListener('ended', function () { D.next(true); }, false);
    au.addEventListener('playing', function () { errs = 0; emit(); }, false);
    au.addEventListener('pause', emit, false);
    au.addEventListener('error', function () {
      // fichier illisible : on passe au suivant, sans boucler sans fin
      if (want && ++errs <= 3) D.next(true); else { want = false; emit(); }
    }, false);
  }
  // Avec ou sans les effets de Boucan.
  D.route = function () {
    if (!gain) return;
    try { gain.disconnect(); } catch (e) {}
    gain.connect(cfg().fx ? A.bus : A.comp);
  };
  D.setVol = function (v) {
    cfg().vol = v;
    if (gain) gain.gain.setTargetAtTime(vol(), A.ctx.currentTime, 0.03);
    B.save();
  };

  function index() { return D.track ? D.queue.indexOf(D.track) : -1; }
  D.playing = function () { return !!au && !au.paused && !au.ended; };
  D.progress = function () { return au && au.duration > 0 ? Math.min(1, au.currentTime / au.duration) : 0; };
  // Avance ou recule dans le morceau (0..1).
  D.seek = function (f) {
    if (!au || !D.track || !(au.duration > 0)) return;
    try { au.currentTime = Math.max(0, Math.min(0.999, f)) * au.duration; } catch (e) {}
  };

  // Forme d'onde du morceau entier : calculée une fois (le fichier est décodé
  // en arrière-plan), puis gardée dans la base. 240 valeurs de 0 à 255.
  var waveBusy = false;
  function waveKey(t) { return 'wave:' + t.id; }
  function loadWave(t) {
    D.wave = null;
    B.db.get('kv', waveKey(t)).then(function (w) {
      if (D.track !== t) return;
      if (w && w.length === WAVE_N) { D.wave = w; emit(); return; }
      if (waveBusy) return;
      waveBusy = true;
      var x = new XMLHttpRequest();
      x.open('GET', D.base + 't/' + t.id, true);
      x.responseType = 'arraybuffer';
      x.onerror = function () { waveBusy = false; };
      x.onload = function () {
        var ab = x.response;
        function fail() { waveBusy = false; }
        if (!ab || !ab.byteLength || ab.byteLength > WAVE_MAX) { fail(); return; }
        function ok(buf) {
          var d = buf.getChannelData(0), n = d.length, per = n / WAVE_N, out = new Uint8Array(WAVE_N), top = 0, pk = [], i, k;
          for (k = 0; k < WAVE_N; k++) {
            var a = Math.floor(k * per), b = Math.floor((k + 1) * per), step = Math.max(1, Math.floor((b - a) / 400)), m = 0;
            for (i = a; i < b; i += step) { var v = d[i] < 0 ? -d[i] : d[i]; if (v > m) m = v; }
            pk.push(m);
            if (m > top) top = m;
          }
          for (k = 0; k < WAVE_N; k++) out[k] = Math.round(255 * pk[k] / (top || 1));
          waveBusy = false;
          B.db.put('kv', waveKey(t), out)['catch'](function () {});
          if (D.track === t) { D.wave = out; emit(); } else if (D.track) loadWave(D.track);
        }
        try {
          var p = A.ctx.decodeAudioData(ab, ok, fail);
          if (p && p['catch']) p['catch'](function () {});
        } catch (e) { fail(); }
      };
      x.send();
    })['catch'](function () {});
  }

  D.play = function (t) {
    if (!t) return;
    ensure();
    A.resume(); A.unkill();
    stopRate();
    D.track = t;
    want = true;
    au.src = D.base + 't/' + t.id;
    au.playbackRate = 1;
    var p = au.play();
    if (p && p['catch']) p['catch'](function () {});
    // la lecture démarre d'abord, l'onde se calcule ensuite
    setTimeout(function () { if (D.track === t) loadWave(t); }, 600);
    D.wave = null;
    emit();
  };
  D.toggle = function () {
    if (!D.track) { D.play(D.queue[0]); return; }
    A.resume(); A.unkill();
    stopRate();
    if (au.paused) { want = true; au.playbackRate = 1; var p = au.play(); if (p && p['catch']) p['catch'](function () {}); }
    else { want = false; au.pause(); }
  };
  D.pause = function () { want = false; stopRate(); if (au && !au.paused) au.pause(); };
  D.next = function (auto) {
    var i = index();
    if (i + 1 < D.queue.length) D.play(D.queue[i + 1]);
    else if (auto) { want = false; emit(); }
  };
  D.prev = function () {
    var i = index();
    if (au && au.currentTime > 3 || i <= 0) { if (au && D.track) { try { au.currentTime = 0; } catch (e) {} } }
    else D.play(D.queue[i - 1]);
  };

  // Micro tenu : 0 rien, 1 la musique baisse, 2 elle se met en pause.
  var ducked = 0, resume = false;
  D.duck = function (mode) {
    if (mode === ducked) return;
    if (ducked === 2 && resume && au) { var p = au.play(); if (p && p['catch']) p['catch'](function () {}); }
    resume = false;
    ducked = mode;
    duckK = mode === 1 ? 0.2 : 1;
    if (mode === 2 && D.playing()) { resume = true; au.pause(); }
    if (gain) gain.gain.setTargetAtTime(vol(), A.ctx.currentTime, 0.08);
  };

  // Vinyl stop : la musique ralentit jusqu'à l'arrêt, puis repart.
  var braked = false;
  function stopRate() { if (rateT) { clearInterval(rateT); rateT = null; } braked = false; }
  D.brake = function (on, time) {
    if (!au || !cfg().fx) return;
    if (on && !D.playing()) return;
    if (!on && !braked) return;
    if (rateT) clearInterval(rateT);
    var t0 = Date.now(), from = au.playbackRate, dur = (on ? time || 0.9 : 0.35) * 1000;
    if (!on) { braked = false; var p = au.play(); if (p && p['catch']) p['catch'](function () {}); }
    else braked = true;
    rateT = setInterval(function () {
      var k = Math.min(1, (Date.now() - t0) / dur), r = from + ((on ? 0.07 : 1) - from) * k;
      try { au.playbackRate = Math.max(0.07, r); } catch (e) {}
      if (k >= 1) { clearInterval(rateT); rateT = null; if (on) au.pause(); }
    }, 30);
  };
})(window.Boucan);
