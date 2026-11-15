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
  var au = null, gain = null, duckK = 1, rateT = null, errs = 0, want = false, rateK = 1;
  var WAVE_N = 240, WAVE_MAX = 60 * 1024 * 1024, WAVE_AHEAD = 400;

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
    // dossier source introuvable (config venue d'un autre téléphone) : on repart de tout
    if (D.state === 'ok' && D.tracks.length && cfg().root && !D.tracks.some(function (t) { return under(t, cfg().root); })) { cfg().root = ''; cfg().sub = ''; }
    D.queue = D.pick();
    D.rev++;
    emit();
    pump();
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
  function relist() { D.queue = D.pick(); D.rev++; B.save(); emit(); pump(); }
  // Recherche par titre ou artiste dans le dossier source.
  D.search = function (text, max) {
    var q = low(text).replace(/^\s+|\s+$/g, ''), root = D.root(), out = [], k, t;
    if (!q) return out;
    for (k = 0; k < D.tracks.length && out.length < max; k++) {
      t = D.tracks[k];
      if (under(t, root) && (low(t.t).indexOf(q) >= 0 || low(t.a).indexOf(q) >= 0)) out.push(t);
    }
    return out;
  };
  // Morceaux du dossier source, pour les joindre à un export. dir : dossier
  // relatif recréé sur l'autre téléphone (sous Music/Boucan).
  D.exportList = function () {
    var root = D.root(), top = D.leaf(root), out = [];
    if (!top || /^\d+$/.test(top)) top = 'Musique';
    D.tracks.forEach(function (t) {
      if (under(t, root) && t.f && t.z > 0) out.push({ id: t.id, dir: top + t.p.substr(root.length), name: t.f, size: t.z, c: cfg().colors[t.id] || '' });
    });
    return out;
  };
  function ends(s, tail) { return s.length >= tail.length && s.substr(s.length - tail.length) === tail; }
  function imported(m) {
    for (var k = 0; k < D.tracks.length; k++) {
      var t = D.tracks[k];
      if (t.f === m.name && t.z === m.size && ends(t.p, '/Boucan/' + m.dir)) return t;
    }
    return null;
  }
  D.has = function (m) { return !!imported(m); };
  // Après un import avec musiques : le dossier source devient celui qui vient
  // d'être recopié, et les couleurs retrouvent leurs morceaux.
  D.afterImport = function (music) {
    D.load();
    var root = '';
    cfg().colors = {};
    music.forEach(function (m) {
      var t = imported(m), top = '/Boucan/' + m.dir.split('/')[0];
      if (!t) return;
      if (m.c) cfg().colors[t.id] = m.c;
      if (!root) root = t.p.substr(0, t.p.indexOf(top) + top.length);
    });
    D.setRoot(root);
  };
  D.setSub = function (sub) { cfg().sub = sub; relist(); };
  D.setRoot = function (root) { cfg().root = root; cfg().sub = ''; relist(); };
  D.listName = function () { var s = cfg().sub; return s && s !== '.' ? D.leaf(s) : D.leaf(cfg().root); };

  function vol() { var v = cfg().vol; return v * v * duckK; }
  // Amène le volume à sa valeur voulue, en fondu de dur secondes.
  function glide(dur) {
    if (!gain) return;
    var t = A.ctx.currentTime;
    try { A.fade(gain.gain, A.freeze(gain.gain, t), vol(), t, dur); } catch (e) { gain.gain.value = vol(); }
  }
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
  // Effet PITCH : vitesse (et hauteur) de la musique.
  D.setRate = function (k) {
    rateK = k;
    if (au && !rateT) { try { au.playbackRate = k; } catch (e) {} }
  };
  // Avec ou sans les effets de Boucan.
  D.route = function () {
    if (!gain) return;
    try { gain.disconnect(); } catch (e) {}
    gain.connect(A.target !== 'pads' ? A.fxIn : A.comp);
  };
  D.setVol = function (v) {
    cfg().vol = v;
    glide(0.03);
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

  // Forme d'onde du morceau entier (240 valeurs de 0 à 255). Elle se calcule
  // en décodant le fichier, une seule fois, puis reste dans la base. Les ondes
  // de la liste en cours sont préparées d'avance, une par une, en tâche de fond.
  var have = null, bad = {}, waveBusy = false, waveT = null;
  function waveKey(t) { return 'wave:' + t.id; }
  function known(cb) {
    if (have) { cb(); return; }
    B.db.keys('kv').then(function (ks) {
      have = {};
      ks.forEach(function (k) { if (String(k).indexOf('wave:') === 0) have[k] = 1; });
      cb();
    }, function () { have = {}; cb(); });
  }
  function compute(t, done) {
    var x = new XMLHttpRequest();
    x.open('GET', D.base + 't/' + t.id, true);
    x.responseType = 'arraybuffer';
    x.onerror = function () { done(null); };
    x.onload = function () {
      var ab = x.response, over = false;
      function fail() { if (!over) { over = true; done(null); } }
      if (x.status >= 400 || !ab || !ab.byteLength || ab.byteLength > WAVE_MAX) { fail(); return; }
      function ok(buf) {
        if (over) return;
        over = true;
        var d = buf.getChannelData(0), n = d.length, per = n / WAVE_N, out = new Uint8Array(WAVE_N), top = 0, pk = [], i, k;
        for (k = 0; k < WAVE_N; k++) {
          var a = Math.floor(k * per), b = Math.floor((k + 1) * per), step = Math.max(1, Math.floor((b - a) / 400)), m = 0;
          for (i = a; i < b; i += step) { var v = d[i] < 0 ? -d[i] : d[i]; if (v > m) m = v; }
          pk.push(m);
          if (m > top) top = m;
        }
        for (k = 0; k < WAVE_N; k++) out[k] = Math.round(255 * pk[k] / (top || 1));
        have[waveKey(t)] = 1;
        B.db.put('kv', waveKey(t), out)['catch'](function () {});
        done(out);
      }
      try {
        var p = A.ctx.decodeAudioData(ab, ok, fail);
        if (p && p['catch']) p['catch'](fail);
      } catch (e) { fail(); }
    };
    x.send();
  }
  // Prépare l'onde suivante : d'abord celle du morceau en cours, puis celles de la liste.
  function pump() {
    if (waveT || waveBusy || D.state !== 'ok') return;
    waveT = setTimeout(function () {
      waveT = null;
      known(function () {
        if (waveBusy || document.hidden) return;
        var t = null, k;
        function todo(x) { return x && !have[waveKey(x)] && !bad[x.id]; }
        if (todo(D.track)) t = D.track;
        for (k = 0; !t && k < D.queue.length && k < WAVE_AHEAD; k++) if (todo(D.queue[k])) t = D.queue[k];
        if (!t) return;
        waveBusy = true;
        compute(t, function (out) {
          waveBusy = false;
          if (!out) bad[t.id] = 1;
          else if (D.track === t) { D.wave = out; emit(); }
          pump();
        });
      });
    }, 500);
  }
  D.pump = pump;
  function showWave(t) {
    D.wave = null;
    B.db.get('kv', waveKey(t)).then(function (w) {
      if (D.track !== t) return;
      if (w && w.length === WAVE_N) { D.wave = w; emit(); } else pump();
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
    au.playbackRate = rateK;
    var p = au.play();
    if (p && p['catch']) p['catch'](function () {});
    showWave(t);
    emit();
  };
  // Lecture / pause : la musique freine ou repart comme un vinyle (durée
  // réglable, 0 = net).
  D.toggle = function () {
    if (!D.track) { D.play(D.queue[0]); return; }
    A.resume(); A.unkill();
    var sec = cfg().brake;
    if (au.paused || braked) { want = true; spin(true, sec * 0.6); }
    else { want = false; spin(false, sec); }
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

  // Micro tenu : 0 rien, 1 la musique baisse, 2 elle s'éteint puis se met en
  // pause. Le fondu dure B.cfg.duckFade secondes.
  var ducked = 0, resume = false, duckT = null;
  D.duck = function (mode) {
    if (mode === ducked) return;
    var dur = B.cfg.duckFade, p;
    if (duckT) { clearTimeout(duckT); duckT = null; }
    if (ducked === 2 && resume && au && au.paused) { p = au.play(); if (p && p['catch']) p['catch'](function () {}); }
    if (mode !== 2) resume = false;
    ducked = mode;
    duckK = mode === 1 ? 0.2 : mode === 2 ? 0 : 1;
    if (mode === 2 && (D.playing() || resume)) {
      resume = true;
      duckT = setTimeout(function () { duckT = null; if (ducked === 2 && au) au.pause(); }, dur * 1000 + 30);
    }
    glide(dur);
  };

  // Vinyl stop : la musique ralentit jusqu'à l'arrêt, ou repart.
  var braked = false;
  function stopRate() { if (rateT) { clearInterval(rateT); rateT = null; } braked = false; }
  // up : repart (true) ou freine (false), en sec secondes.
  function spin(up, sec) {
    if (rateT) { clearInterval(rateT); rateT = null; }
    var p;
    if (sec < 0.05) {
      braked = false;
      try { au.playbackRate = rateK; } catch (e) {}
      if (up) { p = au.play(); if (p && p['catch']) p['catch'](function () {}); } else au.pause();
      return;
    }
    if (up && au.paused) { try { au.playbackRate = 0.07; } catch (e2) {} }
    braked = !up;
    if (up) { p = au.play(); if (p && p['catch']) p['catch'](function () {}); }
    var t0 = Date.now(), from = au.playbackRate, dur = sec * 1000;
    rateT = setInterval(function () {
      var k = Math.min(1, (Date.now() - t0) / dur), r = from + ((up ? rateK : 0.07) - from) * k;
      try { au.playbackRate = Math.max(0.07, r); } catch (e3) {}
      if (k >= 1) { clearInterval(rateT); rateT = null; if (!up) { au.pause(); braked = false; emit(); } }
    }, 30);
    emit();
  }
  // Case FX « vinyl stop ».
  D.brake = function (on, time) {
    if (!au) return;
    if (on && !D.playing()) return;
    if (!on && !want) return;
    spin(!on, on ? time || 0.9 : 0.35);
  };
  // Vrai tant que la musique est censée jouer (même en plein freinage d'une case FX).
  D.wanted = function () { return want; };
})(window.Boucan);
