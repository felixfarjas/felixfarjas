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
  var au = null, gain = null, duckK = 1, errs = 0, want = false, rateK = 1;
  var WAVE_N = 240, WAVE_MAX = 80 * 1024 * 1024, WAVE_AHEAD = 400;
  var BUF_MAX_MS = 12 * 60000;   // au-delà, un morceau ne tient pas en mémoire : lecture en flux
  var WAVE_MAX_MS = 25 * 60000;  // au-delà, on ne le décode même pas pour son onde

  function nat() { return window.BoucanNative; }
  function cfg() { return B.cfg.deck; }
  function emit() { if (D.onChange) D.onChange(); }
  function low(s) { return String(s || '').toLowerCase(); }
  function cmp(x, y) { return x < y ? -1 : x > y ? 1 : 0; }
  function under(t, path) { return !path || t.p === path || t.p.indexOf(path + '/') === 0; }
  // Couleurs et commentaires sont rattachés au nom du fichier : ils suivent la
  // config sur un autre téléphone qui a les mêmes fichiers.
  D.key = function (t) { return t.f || String(t.id); };
  D.leaf = function (path) { return path ? path.substr(path.lastIndexOf('/') + 1) : ''; };

  D.load = function () {
    var N = nat(), r;
    if (!N || !N.musicList) { D.state = 'none'; emit(); return; }
    try { r = N.musicList(); } catch (e) { r = '[]'; }
    if (r === 'PERM') { D.state = 'perm'; D.tracks = []; }
    else {
      try { D.tracks = JSON.parse(r); } catch (e2) { D.tracks = []; }
      D.tracks.forEach(function (t) {
        t.p = t.p || '';
        // anciennes configs : couleurs rangées par numéro de morceau
        var c = cfg().colors[t.id];
        if (c && t.f) { cfg().colors[t.f] = c; delete cfg().colors[t.id]; }
      });
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
      if (under(t, root) && t.f && t.z > 0) out.push({ id: t.id, dir: top + t.p.substr(root.length), name: t.f, size: t.z, c: '' });
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
    music.forEach(function (m) {
      var t = imported(m), top = '/Boucan/' + m.dir.split('/')[0];
      if (t && !root) root = t.p.substr(0, t.p.indexOf(top) + top.length);
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
  function out() {
    if (gain) return;
    gain = A.ctx.createGain();
    gain.gain.value = vol();
    D.route();
  }
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

  /*
   * Deux moteurs de lecture, branchés sur le même volume :
   *  - « mémoire » : le morceau entier est décodé, puis joué depuis la
   *    mémoire. Les positions sont exactes (l'onde et le son coïncident,
   *    on saute où on veut) et la reprise après une pause marche toujours.
   *  - « flux » : le fichier est lu au fil de l'eau. Il démarre tout de suite,
   *    mais ses positions ne sont qu'estimées. Il sert le temps du décodage,
   *    et pour les fichiers trop longs pour tenir en mémoire.
   * Un morceau démarre en flux et passe en mémoire dès qu'il est décodé.
   */
  var mode = null, cur = null;            // moteur du morceau en cours ('buf' | 'stream'), son tampon
  var bufs = {};                          // morceaux décodés gardés : celui en cours et le suivant
  var bsrc = null, bpos = 0, bLast = 0, bOn = false, bTick = null;
  var rampT = null, rampI = null, braked = false;

  function bSync() {
    var now = A.ctx.currentTime;
    if (bOn && bsrc && cur) bpos = Math.min(cur.duration, bpos + (now - bLast) * bsrc.playbackRate.value);
    bLast = now;
  }
  function bStop() {
    if (bTick) { clearInterval(bTick); bTick = null; }
    if (bsrc) {
      bSync();
      var s = bsrc;
      bsrc = null;
      s.onended = null;
      try { s.stop(0); } catch (e) {}
      try { s.disconnect(); } catch (e2) {}
    }
    bOn = false;
  }
  function bStart(rate) {
    bStop();
    if (bpos >= cur.duration - 0.05) bpos = 0;
    var s = A.ctx.createBufferSource();
    s.buffer = cur;
    s.playbackRate.value = rate;
    s.connect(gain);
    s.onended = function () {
      if (bsrc !== s) return;
      bSync();
      var end = bpos >= cur.duration - 0.3;
      bStop();
      if (end && want) D.next(true); else emit();
    };
    s.start(0, bpos);
    bsrc = s; bOn = true; bLast = A.ctx.currentTime;
    bTick = setInterval(bSync, 50);
  }

  function auPlay() { var p = au.play(); if (p && p['catch']) p['catch'](function () {}); }
  function ensureAu() {
    if (au) return;
    au = new Audio();
    au.crossOrigin = 'anonymous';
    au.preload = 'auto';
    try { au.preservesPitch = false; au.webkitPreservesPitch = false; } catch (e) {}
    A.ctx.createMediaElementSource(au).connect(gain);
    au.addEventListener('ended', function () { if (mode === 'stream') D.next(true); }, false);
    au.addEventListener('playing', function () { errs = 0; emit(); }, false);
    au.addEventListener('pause', emit, false);
    au.addEventListener('error', function () {
      if (mode !== 'stream') return;
      // fichier illisible : on passe au suivant, sans boucler sans fin
      if (want && ++errs <= 3) D.next(true); else { want = false; emit(); }
    }, false);
  }
  // Flux qui ne repart pas (appli revenue de l'arrière-plan) : on le recharge à la même position.
  var dogT = null;
  function watchdog() {
    if (dogT) clearTimeout(dogT);
    var at = au.currentTime;
    dogT = setTimeout(function () {
      dogT = null;
      if (mode !== 'stream' || !want || !D.track || au.paused || au.currentTime !== at) return;
      au.src = D.base + 't/' + D.track.id;
      var once = function () {
        au.removeEventListener('loadedmetadata', once, false);
        try { au.currentTime = at; } catch (e) {}
        auPlay();
      };
      au.addEventListener('loadedmetadata', once, false);
      au.load();
    }, 1500);
  }

  function ePlaying() { return mode === 'buf' ? bOn : mode === 'stream' && !!au && !au.paused && !au.ended; }
  function ePos() { if (mode === 'buf') { bSync(); return bpos; } return mode === 'stream' && au ? au.currentTime || 0 : 0; }
  function eDur() {
    if (mode === 'buf') return cur.duration;
    if (mode === 'stream' && au && au.duration > 0 && au.duration < 1e6) return au.duration;
    return D.track && D.track.ms ? D.track.ms / 1000 : 0;
  }
  function ePlay(rate) {
    if (mode === 'buf') bStart(rate);
    else if (mode === 'stream') { try { au.playbackRate = Math.max(0.07, rate); } catch (e) {} auPlay(); watchdog(); }
  }
  function ePause() {
    if (mode === 'buf') bStop();
    else if (mode === 'stream' && au) au.pause();
  }
  function clearRamp() {
    if (rampT) { clearTimeout(rampT); rampT = null; }
    if (rampI) { clearInterval(rampI); rampI = null; }
  }
  // Fait glisser la vitesse de lecture vers "to" en sec secondes, puis appelle done.
  function eRamp(to, sec, done) {
    clearRamp();
    if (mode === 'buf' && bsrc) {
      var p = bsrc.playbackRate, now = A.ctx.currentTime;
      try {
        p.cancelScheduledValues(now);
        p.setValueAtTime(p.value, now);
        p.linearRampToValueAtTime(Math.max(0.001, to), now + sec);
      } catch (e) {}
      rampT = setTimeout(function () { rampT = null; done(); }, sec * 1000);
    } else if (mode === 'stream' && au) {
      var t0 = Date.now(), from = au.playbackRate;
      rampI = setInterval(function () {
        var k = Math.min(1, (Date.now() - t0) / (sec * 1000));
        try { au.playbackRate = Math.max(0.07, from + (to - from) * k); } catch (e2) {}
        if (k >= 1) { clearInterval(rampI); rampI = null; done(); }
      }, 30);
    } else done();
  }
  // Un freinage ou un redémarrage en cours est mené à son terme d'un coup.
  function settle() {
    if (!rampT && !rampI) return;
    clearRamp();
    if (braked) { braked = false; ePause(); glide(0); }
    else if (mode === 'buf' && bsrc) { try { bsrc.playbackRate.cancelScheduledValues(0); bsrc.playbackRate.value = rateK; } catch (e) {} }
    else if (mode === 'stream' && au) { try { au.playbackRate = rateK; } catch (e2) {} }
  }

  // Effet PITCH : vitesse (et hauteur) de la musique.
  D.setRate = function (k) {
    rateK = k;
    if (rampT || rampI) return;
    if (mode === 'buf' && bsrc) { try { bsrc.playbackRate.setTargetAtTime(k, A.ctx.currentTime, 0.03); } catch (e) {} }
    else if (mode === 'stream' && au) { try { au.playbackRate = k; } catch (e2) {} }
  };

  function index() { return D.track ? D.queue.indexOf(D.track) : -1; }
  function after() { var i = index(); return i >= 0 ? D.queue[i + 1] || null : null; }
  D.playing = ePlaying;
  D.exact = function () { return mode === 'buf'; };
  D.progress = function () { var d = eDur(); return d > 0 ? Math.min(1, ePos() / d) : 0; };
  // Avance ou recule dans le morceau (0..1).
  D.seek = function (f) {
    var d = eDur();
    if (!D.track || !(d > 0)) return;
    settle();
    var sec = Math.max(0, Math.min(0.999, f)) * d;
    if (mode === 'buf') { var on = bOn; bStop(); bpos = sec; if (on) bStart(rateK); }
    else if (au) { try { au.currentTime = sec; } catch (e) {} }
    emit();
  };

  // Le morceau en cours vient d'être décodé : la lecture passe du flux à la
  // mémoire, à la même position.
  function adopt() {
    if (mode !== 'stream' || !D.track || !bufs[D.track.id] || rampT || rampI) return;
    var on = ePlaying(), pos = au ? au.currentTime || 0 : 0;
    if (dogT) { clearTimeout(dogT); dogT = null; }
    mode = 'buf';
    cur = bufs[D.track.id];
    bpos = Math.min(pos, cur.duration - 0.05);
    if (on) bStart(rateK);
    try { au.pause(); } catch (e) {}
    emit();
  }

  // Décodage : il sert à la fois à la lecture exacte et à la forme d'onde
  // (240 valeurs de 0 à 255, gardée dans la base). Les ondes de la liste en
  // cours sont préparées d'avance, une par une, quand rien ne joue.
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
  function fits(t) { return !t.ms || t.ms <= BUF_MAX_MS; }
  function wanted(t) { return t === D.track || t === after(); }
  // Ne garde en mémoire que le morceau en cours et le suivant.
  function trim() {
    var keep = {}, k;
    if (D.track) keep[D.track.id] = 1;
    if (after()) keep[after().id] = 1;
    for (k in bufs) if (!keep[k]) delete bufs[k];
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
        if (wanted(t) && fits(t)) bufs[t.id] = buf;
        done(out);
      }
      try {
        var p = A.ctx.decodeAudioData(ab, ok, fail);
        if (p && p['catch']) p['catch'](fail);
      } catch (e) { fail(); }
    };
    x.send();
  }
  // Prochain décodage : le morceau en cours, puis le suivant (pour enchaîner
  // sans attente), puis les ondes de la liste quand rien ne joue.
  function pump() {
    if (waveT || waveBusy || D.state !== 'ok') return;
    waveT = setTimeout(function () {
      waveT = null;
      known(function () {
        if (waveBusy || document.hidden) return;
        var t = null, k, nx = after();
        function ok(x) { return x && !bad[x.id] && (!x.ms || x.ms <= WAVE_MAX_MS); }
        function needBuf(x) { return ok(x) && fits(x) && !bufs[x.id]; }
        function needWave(x) { return ok(x) && !have[waveKey(x)]; }
        if (needBuf(D.track) || needWave(D.track)) t = D.track;
        else if (needBuf(nx)) t = nx;
        // les ondes d'avance attendent le silence : décoder pendant la lecture fait craquer un téléphone lent
        else if (!ePlaying() && !Object.keys(A.voices).length) {
          for (k = 0; !t && k < D.queue.length && k < WAVE_AHEAD; k++) if (needWave(D.queue[k])) t = D.queue[k];
        }
        if (!t) return;
        waveBusy = true;
        compute(t, function (out) {
          waveBusy = false;
          if (!out) bad[t.id] = 1;
          else if (D.track === t) { D.wave = out; adopt(); emit(); }
          trim();
          pump();
        });
      });
    }, 300);
  }
  D.pump = function () { adopt(); pump(); };
  function showWave(t) {
    D.wave = null;
    B.db.get('kv', waveKey(t)).then(function (w) {
      if (D.track !== t) return;
      if (w && w.length === WAVE_N) { D.wave = w; emit(); }
    })['catch'](function () {});
  }

  D.play = function (t) {
    if (!t) return;
    out();
    A.resume(); A.unkill();
    clearRamp(); braked = false;
    bStop();
    if (au) { try { au.pause(); } catch (e) {} }
    if (dogT) { clearTimeout(dogT); dogT = null; }
    D.track = t;
    want = true;
    trim();
    glide(0);
    if (bufs[t.id]) {
      // déjà décodé (c'était le « suivant ») : départ immédiat et exact
      mode = 'buf'; cur = bufs[t.id]; bpos = 0;
      bStart(rateK);
    } else {
      mode = 'stream'; cur = null;
      ensureAu();
      au.src = D.base + 't/' + t.id;
      try { au.playbackRate = rateK; } catch (e2) {}
      auPlay();
    }
    showWave(t);
    emit();
    pump();
  };
  // Lecture / pause : la musique freine ou repart comme un vinyle (durée
  // réglable, 0 = net).
  D.toggle = function () {
    if (!D.track) { D.play(D.queue[0]); return; }
    A.resume(); A.unkill();
    var sec = cfg().brake;
    if (!ePlaying() || braked) { want = true; spin(true, sec * 0.6); }
    else { want = false; spin(false, sec); }
  };
  D.pause = function () {
    want = false;
    clearRamp(); braked = false;
    ePause();
    glide(0);
  };
  D.next = function (auto) {
    var nx = after();
    if (nx) D.play(nx);
    else if (auto) { want = false; emit(); }
  };
  D.prev = function () {
    if (!D.track) return;
    if (ePos() > 3 || index() <= 0) D.seek(0);
    else D.play(D.queue[index() - 1]);
  };

  // Micro tenu : 0 rien, 1 la musique baisse, 2 elle s'éteint puis se met en
  // pause. Le fondu dure B.cfg.duckFade secondes.
  var ducked = 0, resume = false, duckT = null;
  D.duck = function (mode2) {
    if (mode2 === ducked) return;
    var dur = B.cfg.duckFade;
    if (duckT) { clearTimeout(duckT); duckT = null; }
    if (ducked === 2 && resume && !ePlaying()) ePlay(rateK);
    if (mode2 !== 2) resume = false;
    ducked = mode2;
    duckK = mode2 === 1 ? 0.2 : mode2 === 2 ? 0 : 1;
    if (mode2 === 2 && (ePlaying() || resume)) {
      resume = true;
      duckT = setTimeout(function () { duckT = null; if (ducked === 2) ePause(); }, dur * 1000 + 30);
    }
    glide(dur);
  };

  // Vinyl stop : la musique ralentit jusqu'à l'arrêt (up faux) ou repart, en sec secondes.
  function spin(up, sec) {
    clearRamp();
    if (!mode) return;
    if (sec < 0.05) {
      braked = false;
      if (up) ePlay(rateK); else ePause();
      glide(0.02);
      emit();
      return;
    }
    var on = ePlaying();
    braked = !up;
    // le volume accompagne le mouvement : il s'éteint sur la fin du freinage
    // (pas d'arrêt abrupt) et revient en douceur au redémarrage
    try {
      var now = A.ctx.currentTime, lv = A.freeze(gain.gain, now);
      if (up) A.fade(gain.gain, on ? lv : 0, vol(), now, Math.min(0.2, sec));
      else A.fade(gain.gain, lv, 0, now + sec * 0.45, sec * 0.55);
    } catch (e) {}
    if (up && !on) ePlay(0.07);
    eRamp(up ? rateK : 0.05, sec, function () {
      if (!up) { ePause(); braked = false; glide(0); }
      adopt();
      emit();
    });
    emit();
  }
  // Case FX « vinyl stop ».
  D.brake = function (on, time) {
    if (!mode) return;
    if (on && !ePlaying()) return;
    if (!on && !want) return;
    spin(!on, on ? time || 0.9 : 0.35);
  };
  // Vrai tant que la musique est censée jouer (même en plein freinage d'une case FX).
  D.wanted = function () { return want; };
})(window.Boucan);
