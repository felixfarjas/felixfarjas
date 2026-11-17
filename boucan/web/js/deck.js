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
  var XFADE = 0.4;
  var BUF_MAX_MS = 12 * 60000;   // au-delà, un morceau ne tient pas en mémoire : lecture en flux
  var WAVE_MAX_MS = 25 * 60000;  // au-delà, on ne le décode même pas pour son onde

  function nat() { return window.BoucanNative; }
  function cfg() { return B.cfg.deck; }
  function emit() { if (D.onChange) D.onChange(); tell(); }
  // Prévient Android du morceau en cours : il l'affiche dans les notifications avec ses commandes.
  var tellT = null;
  function tell() {
    if (tellT) return;
    tellT = setTimeout(function () {
      tellT = null;
      var N = nat(), t = D.track;
      if (!N || !N.nowPlaying) return;
      try {
        N.nowPlaying(JSON.stringify({ active: !!t, id: t ? t.id : 0, t: t ? t.t : '', a: t ? t.a : '', playing: !!t && want,
          pos: Math.round(ePos() * 1000), dur: Math.round(eDur() * 1000) }));
      } catch (e) {}
    }, 200);
  }
  // Commande venue des notifications.
  B.deckCmd = function (cmd, arg) {
    // sans morceau en cours, lecture lance le premier de la liste (widget)
    if (!B.cfg || (!D.track && cmd !== 'toggle' && cmd !== 'play')) return;
    if (cmd === 'toggle' || (cmd === 'play' && !want) || (cmd === 'pause' && want)) D.toggle();
    else if (cmd === 'next') D.next();
    else if (cmd === 'prev') D.prev();
    else if (cmd === 'seek' && eDur() > 0) D.seek(arg / 1000 / eDur());
  };
  function low(s) { return String(s || '').toLowerCase(); }
  function cmp(x, y) { return x < y ? -1 : x > y ? 1 : 0; }
  function under(t, path) { return !path || t.p === path || t.p.indexOf(path + '/') === 0; }
  // Couleurs et commentaires sont rattachés au nom du fichier : ils suivent la
  // config sur un autre téléphone qui a les mêmes fichiers.
  D.key = function (t) { return t.f || String(t.id); };
  // Point de départ réglé pour ce morceau : { s: seconde, f: fondu d'entrée }.
  D.cue = function (t) { return cfg().cues[D.key(t)] || { s: 0, f: 0 }; };
  D.waveOf = function (t) { return B.db.get('kv', 'wave:' + t.id); };
  D.leaf = function (path) { return path ? path.substr(path.lastIndexOf('/') + 1) : ''; };

  D.load = function () {
    var N = nat(), r;
    if (!N || !N.musicList) { D.state = 'none'; emit(); return; }
    try { r = N.musicList(); } catch (e) { r = '[]'; }
    if (r === 'PERM') { D.state = 'perm'; D.tracks = []; D.all = []; }
    else {
      try { D.all = JSON.parse(r); } catch (e2) { D.all = []; }
      // les morceaux « retirés » ne sont plus montrés (leur fichier reste sur le téléphone)
      D.tracks = D.all.filter(function (t) { return !cfg().hidden[t.f || String(t.id)]; });
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
  // Retire un morceau de l'app, ou le rétablit ; le fichier n'est jamais touché.
  D.hide = function (t, on) {
    if (on) cfg().hidden[D.key(t)] = 1; else delete cfg().hidden[D.key(t)];
    B.save();
    D.load();
  };
  D.hiddenList = function () { return (D.all || []).filter(function (t) { return cfg().hidden[D.key(t)]; }); };
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
    gain.connect(A.chM.inp);
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
  var bsrc = null, bsg = null, bpos = 0, bLast = 0, bOn = false, bTick = null;
  var rampT = null, rampI = null, rateT2 = null, braked = false;

  function bSync() {
    var now = A.ctx.currentTime;
    if (bOn && bsrc && cur) bpos = Math.min(cur.duration, bpos + (now - bLast) * bsrc.playbackRate.value);
    bLast = now;
  }
  function bStop() {
    if (bTick) { clearInterval(bTick); bTick = null; }
    if (bsrc) {
      bSync();
      var s = bsrc, g = bsg;
      bsrc = null; bsg = null;
      s.onended = null;
      try { s.stop(0); } catch (e) {}
      try { s.disconnect(); g.disconnect(); } catch (e2) {}
    }
    bOn = false;
  }
  // Laisse le morceau en cours finir en vinyl stop, détaché, pendant que le suivant démarre.
  function tailOff(sec) {
    if (!bsrc) return;
    bSync();
    if (bTick) { clearInterval(bTick); bTick = null; }
    var s = bsrc, g = bsg, now = A.ctx.currentTime, p = s.playbackRate;
    bsrc = null; bsg = null; bOn = false;
    s.onended = null;
    try {
      p.cancelScheduledValues(now);
      p.setValueAtTime(p.value, now);
      p.linearRampToValueAtTime(0.001, now + sec);
      A.fade(g.gain, A.freeze(g.gain, now), 0, now + sec * 0.45, sec * 0.55);
      s.stop(now + sec + 0.05);
    } catch (e) { try { s.stop(0); } catch (e2) {} }
    setTimeout(function () { try { s.disconnect(); g.disconnect(); } catch (e3) {} }, sec * 1000 + 300);
  }
  // Fondu croisé « à puissance constante » : pendant que l'un descend et que
  // l'autre monte, le volume perçu reste le même (pas de creux au milieu).
  function eqFade(p, up, from, t0, dur) {
    var n = 32, c = new Float32Array(n), i, x;
    for (i = 0; i < n; i++) { x = i / (n - 1) * Math.PI / 2; c[i] = up ? Math.sin(x) : from * Math.cos(x); }
    try { p.setValueAtTime(c[0], t0); p.setValueCurveAtTime(c, t0, dur); }
    catch (e) { p.setValueAtTime(c[0], t0); p.linearRampToValueAtTime(up ? 1 : 0, t0 + dur); }
  }
  // Fait taire en fondu la lecture en cours, détachée (fondu croisé d'un saut dans le morceau).
  function fadeOff(sec) {
    if (!bsrc) return;
    bSync();
    if (bTick) { clearInterval(bTick); bTick = null; }
    var s = bsrc, g = bsg, now = A.ctx.currentTime;
    bsrc = null; bsg = null; bOn = false;
    s.onended = null;
    try { eqFade(g.gain, false, A.freeze(g.gain, now), now, sec); s.stop(now + sec + 0.05); } catch (e) { try { s.stop(0); } catch (e2) {} }
    setTimeout(function () { try { s.disconnect(); g.disconnect(); } catch (e3) {} }, sec * 1000 + 300);
  }
  // fadeIn (optionnel) : entrée en fondu, en secondes ; xf : moitié montante d'un fondu croisé.
  function bStart(rate, fadeIn, xf) {
    bStop();
    if (bpos >= cur.duration - 0.05) bpos = 0;
    var s = A.ctx.createBufferSource(), g = A.ctx.createGain();
    s.buffer = cur;
    s.playbackRate.value = rate;
    if (fadeIn && xf) eqFade(g.gain, true, 1, A.ctx.currentTime, fadeIn);
    else if (fadeIn) { g.gain.setValueAtTime(0, A.ctx.currentTime); A.fade(g.gain, 0, 1, A.ctx.currentTime, fadeIn); }
    s.connect(g); g.connect(gain);
    bsg = g;
    s.onended = function () {
      if (bsrc !== s) return;
      bSync();
      var end = bpos >= cur.duration - 0.3;
      bStop();
      if (end && want) D.next(true); else emit();
    };
    s.start(0, bpos);
    bsrc = s; bOn = true; bLast = A.ctx.currentTime;
  }

  function auPlay() { var p = au.play(); if (p && p['catch']) p['catch'](function () {}); }
  // Départ réglé (point de départ, fondu d'entrée) d'un morceau lu en flux : il reste muet
  // jusqu'à être arrivé à son point de départ, puis entre en fondu. Plus besoin d'attendre le décodage.
  var auG = null, pend = null, pendT = null;
  function auLevel(v) {
    if (!auG) return;
    var now = A.ctx.currentTime;
    A.freeze(auG.gain, now);
    auG.gain.setValueAtTime(v, now);
  }
  function cueOpen() {
    var p = pend, now = A.ctx.currentTime;
    pend = null;
    if (pendT) { clearTimeout(pendT); pendT = null; }
    if (!p || !auG) return;
    A.freeze(auG.gain, now);
    A.fade(auG.gain, 0, 1, now, Math.max(0.03, p.f));
  }
  function cueCheck() {
    if (!pend || mode !== 'stream' || D.track !== pend.t || !au) return;
    if (au.readyState < 1) return;
    // le fragment « #t= » n'a pas été suivi : on saute à la main (le son est encore coupé)
    if (au.currentTime < pend.s - 0.4) { try { au.currentTime = pend.s; } catch (e) {} return; }
    if (!au.paused && au.currentTime >= pend.s - 0.4) cueOpen();
  }
  function ensureAu() {
    if (au) return;
    au = new Audio();
    au.crossOrigin = 'anonymous';
    au.preload = 'auto';
    try { au.preservesPitch = false; au.webkitPreservesPitch = false; } catch (e) {}
    // auG : volume propre au flux, pour son entrée en fondu et le fondu croisé vers la mémoire
    auG = A.ctx.createGain();
    A.ctx.createMediaElementSource(au).connect(auG);
    auG.connect(gain);
    au.addEventListener('ended', function () { if (mode === 'stream') D.next(true); }, false);
    au.addEventListener('playing', function () { errs = 0; cueCheck(); emit(); }, false);
    au.addEventListener('timeupdate', cueCheck, false);
    au.addEventListener('loadedmetadata', cueCheck, false);
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
      pend = null; auLevel(1);
      var once = function () {
        au.removeEventListener('loadedmetadata', once, false);
        try { au.currentTime = at; } catch (e) {}
        auPlay();
      };
      au.addEventListener('loadedmetadata', once, false);
      au.load();
    }, 1500);
  }

  // Le décodage d'un morceau « en attente » est arrivé : il part pile à son
  // point de départ, avec son fondu d'entrée.
  function ready() {
    if (mode !== 'wait' || !D.track || !bufs[D.track.id]) return;
    var cu = D.cue(D.track);
    mode = 'buf'; cur = bufs[D.track.id];
    bpos = Math.min(cu.s, Math.max(0, cur.duration - 1));
    if (want) bStart(rateK, cu.f, true);
    emit();
  }
  D.loading = function () { return mode === 'wait' && want; };
  function ePlaying() { return mode === 'buf' ? bOn : mode === 'stream' && !!au && !au.paused && !au.ended; }
  function ePos() {
    if (mode === 'buf') { bSync(); return bpos; }
    if (mode === 'wait') return D.cue(D.track).s;
    return mode === 'stream' && au ? au.currentTime || 0 : 0;
  }
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
  // À vitesse constante la position se déduit de l'horloge audio ; seul un
  // changement de vitesse (vinyle, pitch) demande de l'intégrer pas à pas.
  function tickOn() { bSync(); if (!bTick) bTick = setInterval(bSync, 50); }
  function tickOff() { bSync(); if (bTick) { clearInterval(bTick); bTick = null; } }
  function clearRamp() {
    tickOff();
    if (rampT) { clearTimeout(rampT); rampT = null; }
    if (rampI) { clearInterval(rampI); rampI = null; }
  }
  // Fait glisser la vitesse de lecture vers "to" en sec secondes, puis appelle done.
  function eRamp(to, sec, done) {
    clearRamp();
    if (mode === 'buf' && bsrc) {
      var p = bsrc.playbackRate, now = A.ctx.currentTime;
      tickOn();
      try {
        p.cancelScheduledValues(now);
        p.setValueAtTime(p.value, now);
        p.linearRampToValueAtTime(Math.max(0.001, to), now + sec);
      } catch (e) {}
      rampT = setTimeout(function () { rampT = null; tickOff(); done(); }, sec * 1000);
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
    if (mode === 'buf' && bsrc) {
      tickOn();
      try { bsrc.playbackRate.setTargetAtTime(k, A.ctx.currentTime, 0.03); } catch (e) {}
      if (rateT2) clearTimeout(rateT2);
      rateT2 = setTimeout(function () { rateT2 = null; if (!rampT) tickOff(); }, 250);
    }
    else if (mode === 'stream' && au) { try { au.playbackRate = k; } catch (e2) {} }
  };

  function index() { return D.track ? D.queue.indexOf(D.track) : -1; }
  function after() { var i = index(); return i >= 0 ? D.queue[i + 1] || null : null; }
  D.playing = ePlaying;
  D.exact = function () { return mode === 'buf'; };
  // Mode sync : tempo, premier temps fort, position et vitesse du morceau qui joue (ou null).
  D.beat = function () {
    if (mode !== 'buf' || !bOn || !bsrc || !D.track) return null;
    var info = cfg().bpm[D.key(D.track)];
    if (!info) return null;
    bSync();
    return { bpm: info[0], off: info[1], pos: bpos, rate: bsrc.playbackRate.value };
  };
  D.bpmOf = function (t) { var i = cfg().bpm[D.key(t)]; return i ? i[0] : 0; };
  // Calage à la main (case BPM control). Le tempo du morceau est rangé ainsi :
  // [bpm, premier temps, bpm analysé, premier temps analysé] ; les deux derniers
  // n'existent que si on a corrigé à la main, pour pouvoir revenir à l'analyse.
  function info() { return D.track ? cfg().bpm[D.key(D.track)] : null; }
  function keepOrig(i) { if (i.length < 4) { i[2] = i[0]; i[3] = i[1]; } }
  D.setBpm = function (v) {
    var i = info();
    if (!i) return false;
    keepOrig(i);
    i[0] = Math.round(Math.max(40, Math.min(240, v)) * 100) / 100;
    B.save();
    return true;
  };
  D.setOff = function (off) {
    var i = info();
    if (!i) return false;
    keepOrig(i);
    // ramené dans les 16 premiers temps : la grille reste la même pour tous les clips (1, 2 ou 4 mesures)
    var P = 16 * 60 / i[0];
    i[1] = Math.round((((off % P) + P) % P) * 1000) / 1000;
    B.save();
    return true;
  };
  D.resetManual = function () {
    var i = info();
    if (!i || i.length < 4) return false;
    i[0] = i[2]; i[1] = i[3]; i.length = 2;
    B.save();
    return true;
  };
  D.manual = function () { var i = info(); return !!i && i.length >= 4; };
  // Gamme du morceau : [tonique 0..11, 1 si mineur].
  // version de l'analyse : un résultat d'une version plus ancienne est refait (une fois)
  var KEYV = 2;
  function keyOk(k) { return !!k && k[2] === KEYV; }
  D.keyFor = function (t) { return cfg().key[D.key(t)] || null; };
  D.keyNow = function () { return D.track && want ? cfg().key[D.key(D.track)] || null : null; };
  D.analyseKey = function (force) {
    var t = D.track, b = t && bufs[t.id], k;
    if (!b || (!force && keyOk(cfg().key[D.key(t)]))) return false;
    k = keyOf(b);
    if (!k) return false;
    cfg().key[D.key(t)] = k;
    B.save();
    return true;
  };
  // Analyse (ou ré-analyse) le tempo du morceau en cours s'il est en mémoire. Renvoie vrai si c'est fait.
  D.analyse = function (force) {
    var t = D.track, b = t && bufs[t.id];
    if (!b || (!force && cfg().bpm[D.key(t)])) return false;
    cfg().bpm[D.key(t)] = tempoOf(b);
    B.save();
    return true;
  };
  // Position et durée du morceau en cours, en secondes.
  D.times = function () { return [ePos(), eDur()]; };
  D.progress = function () { var d = eDur(); return d > 0 ? Math.min(1, ePos() / d) : 0; };
  // Avance ou recule dans le morceau (0..1).
  D.seek = function (f) {
    var d = eDur();
    if (!D.track || !(d > 0) || mode === 'wait') return;
    settle();
    var sec = Math.max(0, Math.min(0.999, f)) * d;
    // en lecture : fondu croisé de 0,4 s entre l'ancien et le nouvel endroit, sans à-coup
    if (mode === 'buf') { var on = bOn; if (on) fadeOff(XFADE); else bStop(); bpos = sec; if (on) bStart(rateK, XFADE, true); }
    else if (au) { if (pend) cueOpen(); try { au.currentTime = sec; } catch (e) {} }
    emit();
  };

  // Le morceau en cours vient d'être décodé : la lecture passe du flux à la
  // mémoire, à la même position.
  function adopt() {
    if (mode !== 'stream' || !D.track || !bufs[D.track.id] || rampT || rampI) return;
    var on = ePlaying(), pos = au ? au.currentTime || 0 : 0, p = pend, now = A.ctx.currentTime, a = au;
    if (dogT) { clearTimeout(dogT); dogT = null; }
    mode = 'buf';
    cur = bufs[D.track.id];
    if (p) {
      // le flux n'était pas encore arrivé à son point de départ : la mémoire part de là, avec le fondu prévu
      pend = null;
      if (pendT) { clearTimeout(pendT); pendT = null; }
      bpos = Math.min(p.s, Math.max(0, cur.duration - 1));
      if (want) bStart(rateK, p.f, true);
      try { a.pause(); } catch (e0) {}
      auLevel(1);
    } else {
      bpos = Math.min(pos, cur.duration - 0.05);
      if (on) {
        // fondu croisé très court du flux vers la mémoire : le passage ne s'entend pas
        bStart(rateK, 0.08, true);
        try { eqFade(auG.gain, false, A.freeze(auG.gain, now), now, 0.08); } catch (e1) {}
        setTimeout(function () { if (mode !== 'stream') { try { a.pause(); } catch (e2) {} auLevel(1); } }, 140);
      } else { try { a.pause(); } catch (e3) {} }
    }
    emit();
  }

  // Détection de la gamme d'un morceau décodé. Renvoie [tonique 0..11 (0 = do), mode, KEYV], mode :
  // 0 majeur, 1 mineur, 2 mineur harmonique ; ou null.
  //  1. 120 fenêtres réparties sur le morceau, ramenées à environ 11 kHz, spectre fin (1,3 Hz), « blanchi »
  //     (chaque bin rapporté au niveau moyen autour) pour effacer souffle et frappes ;
  //  2. l'accordage du morceau est mesuré (la = 432, 440, 446…) ;
  //  3. saillance de chaque note de do 2 à do 6 : sa fondamentale plus ses harmoniques. Une vraie note
  //     ressort ; la quinte ou la tierce qu'une note contient dans ses harmoniques, non (c'est ce qui
  //     faisait glisser l'ancienne détection vers la gamme voisine) ;
  //  4. on cherche l'ensemble de 7 notes (gamme diatonique ou mineure harmonique) qui contient le plus
  //     de ces notes et le moins en dehors : c'est ce qui évite les fausses notes ;
  //  5. pour cet ensemble, tonique majeure ou mineure (relative) : profils de Krumhansl et poids de la basse.
  var KMAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  var KMIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  var DIA = [0, 2, 4, 5, 7, 9, 11], HARM = [0, 2, 3, 5, 7, 8, 11];
  function fft(re, im) {
    var n = re.length, i, j, k, len, half, step, a, wr, wi, tr, ti, ur, ui, x;
    for (i = 1, j = 0; i < n; i++) {
      for (k = n >> 1; j & k; k >>= 1) j ^= k;
      j ^= k;
      if (i < j) { x = re[i]; re[i] = re[j]; re[j] = x; x = im[i]; im[i] = im[j]; im[j] = x; }
    }
    for (len = 2; len <= n; len <<= 1) {
      half = len >> 1; step = -2 * Math.PI / len;
      for (k = 0; k < half; k++) {
        a = step * k; wr = Math.cos(a); wi = Math.sin(a);
        for (i = k; i < n; i += len) {
          j = i + half;
          tr = re[j] * wr - im[j] * wi; ti = re[j] * wi + im[j] * wr;
          ur = re[i]; ui = im[i];
          re[i] = ur + tr; im[i] = ui + ti; re[j] = ur - tr; im[j] = ui - ti;
        }
      }
    }
  }
  function keyOf(buf) {
    var N = 8192, DEC = Math.max(1, Math.round(buf.sampleRate / 11025)), fs = buf.sampleRate / DEC, span = N * DEC;
    var d = buf.getChannelData(0), n = d.length, FR = 120;
    if (n < span * 4) return null;
    var re = new Float32Array(N), im = new Float32Array(N), win = new Float32Array(N), mag = new Float32Array(N / 2 + 2);
    var f, i, k, q, a0 = Math.floor(n * 0.03), a1 = Math.floor(n * 0.97) - span, h;
    if (a1 <= a0) { a0 = 0; a1 = n - span; }
    for (i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
    var NB = Math.floor(5000 * N / fs), wm = new Float32Array(NB + 2), P0 = 36, P1 = 84, NP = P1 - P0 + 1;
    var frames = [], cs = 0, sn = 0;
    for (f = 0; f < FR; f++) {
      var at = a0 + Math.floor((f + 0.5) / FR * (a1 - a0));
      for (i = 0; i < N; i++) {
        var s0 = 0, b0 = at + i * DEC;
        for (q = 0; q < DEC; q++) s0 += d[b0 + q];
        re[i] = s0 / DEC * win[i]; im[i] = 0;
      }
      fft(re, im);
      for (k = 1; k <= NB + 1; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      // spectre « blanchi » : chaque bin divisé par le niveau moyen autour (±30 bins), ce qui
      // égalise graves et aigus et efface le souffle ; seuls les pics restent au-dessus de 1
      var acc = 0, W = 30;
      for (k = 1; k <= 2 * W + 1; k++) acc += mag[k];
      for (k = 1; k <= NB; k++) {
        var lo2 = k - W, hi2 = k + W;
        if (lo2 > 1 && hi2 <= NB + 1) acc += mag[hi2] - mag[lo2 - 1];
        var ln = acc / (2 * W + 1) + 1e-9, v = mag[k] / ln - 1;
        wm[k] = v > 0 ? v : 0;
      }
      // accordage : décalage des pics par rapport aux notes justes
      for (k = 3; k < NB; k++) if (wm[k] > 2 && wm[k] >= wm[k - 1] && wm[k] >= wm[k + 1]) {
        var x0 = 12 * Math.log(k * fs / N / 440) / Math.LN2;
        cs += wm[k] * Math.cos(2 * Math.PI * x0); sn += wm[k] * Math.sin(2 * Math.PI * x0);
      }
      frames.push(new Float32Array(wm));
    }
    var tune = Math.atan2(sn, cs) / (2 * Math.PI);
    // saillance de chaque note de C2 à C6 : sa fondamentale et ses 7 harmoniques suivantes
    function at2(w, fr) { var c = fr * N / fs, c0 = Math.floor(c), m = 0, j; for (j = c0 - 1; j <= c0 + 2; j++) if (j > 0 && j <= NB && w[j] > m) m = w[j]; return m; }
    var chroma = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], bass = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], sal = new Float32Array(NP), p, top;
    for (f = 0; f < frames.length; f++) {
      top = 0;
      for (p = 0; p < NP; p++) {
        var f0 = 440 * Math.pow(2, (P0 + p - 69 + tune) / 12), sv = 0;
        for (h = 1; h <= 8; h++) sv += at2(frames[f], f0 * h) / h;
        sal[p] = sv;
        if (sv > top) top = sv;
      }
      if (top <= 0) continue;
      // on ne garde que les notes nettement présentes dans la fenêtre (pics locaux, au moins 30 % de la plus forte)
      var fsum = 0, keep = [];
      for (p = 0; p < NP; p++) {
        if (sal[p] < 0.3 * top || (p > 0 && sal[p - 1] > sal[p]) || (p < NP - 1 && sal[p + 1] > sal[p])) continue;
        keep.push(p); fsum += sal[p];
      }
      for (k = 0; k < keep.length; k++) {
        p = keep[k];
        var pc = (P0 + p) % 12, wv = sal[p] / fsum;
        chroma[pc] += wv;
        if (P0 + p < 55) bass[pc] += wv;
      }
    }
    var tot = 0, btot = 0;
    for (k = 0; k < 12; k++) { tot += chroma[k]; btot += bass[k]; }
    if (!(tot > 0)) return null;
    for (k = 0; k < 12; k++) { chroma[k] /= tot; bass[k] /= btot || 1; }
    // 4. l'ensemble de 7 notes qui colle le mieux
    function setScore(shape, r0) {
      var inS = 0, j;
      for (j = 0; j < 7; j++) inS += chroma[(shape[j] + r0) % 12];
      return inS - (1 - inS);
    }
    var bestD = -9, rD = 0, bestH = -9, rH = 0, r1, sc;
    for (r1 = 0; r1 < 12; r1++) {
      sc = setScore(DIA, r1); if (sc > bestD) { bestD = sc; rD = r1; }
      sc = setScore(HARM, r1); if (sc > bestH) { bestH = sc; rH = r1; }
    }
    function corr(pf, r2) {
      var ma = 0, mb = 0, sab = 0, saa = 0, sbb = 0, j;
      for (j = 0; j < 12; j++) { ma += chroma[(j + r2) % 12]; mb += pf[j]; }
      ma /= 12; mb /= 12;
      for (j = 0; j < 12; j++) { var xa = chroma[(j + r2) % 12] - ma, xb = pf[j] - mb; sab += xa * xb; saa += xa * xa; sbb += xb * xb; }
      return sab / Math.sqrt(saa * sbb || 1);
    }
    // mineur harmonique seulement si sa sensible (la 7e haussée) est nettement présente
    if (bestH > bestD + 0.03) return [rH, 2, KEYV];
    // 5. tonique : le majeur (rD) ou sa relative mineure (rD + 9)
    var mi = (rD + 9) % 12;
    var sMaj = corr(KMAJ, rD) + 0.6 * bass[rD], sMin = corr(KMIN, mi) + 0.6 * bass[mi];
    return sMin > sMaj ? [mi, 1, KEYV] : [rD, 0, KEYV];
  }

  // Détection du tempo d'un morceau décodé. Renvoie [bpm, instant en secondes d'un premier temps de mesure].
  //  1. enveloppe des attaques (100 valeurs par seconde), basses renforcées : le kick porte le temps ;
  //  2. autocorrélation pour trouver le tempo à peu près, entre 70 et 180 ;
  //  3. peigne d'impulsions pour l'affiner au centième et trouver où tombent les temps ;
  //  4. le temps 1 de la mesure est celui, parmi quatre, où les basses frappent le plus.
  function tempoOf(buf) {
    var sr = buf.sampleRate, d = buf.getChannelData(0), hop = Math.floor(sr / 100), n = Math.min(Math.floor(d.length / hop) - 1, 18000);
    if (n < 800) return [B.cfg.midi.bpm, 0];
    var env = new Float32Array(n), low = new Float32Array(n), a = Math.exp(-2 * Math.PI * 180 / sr * 2), lp = 0, pl = 0, pf = 0, i, k, x;
    for (k = 0; k < n; k++) {
      var el = 0, ef = 0, b0 = k * hop;
      for (i = 0; i < hop; i += 2) { x = d[b0 + i]; lp = a * lp + (1 - a) * x; el += lp * lp; ef += x * x; }
      el = Math.sqrt(el); ef = Math.sqrt(ef);
      low[k] = Math.max(0, el - pl);
      env[k] = low[k] + 0.5 * Math.max(0, ef - pf);
      pl = el; pf = ef;
    }
    function ac(lag) {
      var l0 = Math.floor(lag), fr = lag - l0, s = 0, q;
      for (q = 0; q + l0 + 1 < n; q += 2) s += env[q] * (env[q + l0] * (1 - fr) + env[q + l0 + 1] * fr);
      return s;
    }
    var best = 120, bs = -1, bpm, sc;
    for (bpm = 70; bpm <= 180; bpm += 0.5) {
      var L = 6000 / bpm, pr = Math.log(bpm / 125) / Math.LN2 / 0.7;
      sc = (ac(L) + 0.5 * ac(2 * L)) * Math.exp(-0.5 * pr * pr);
      if (sc > bs) { bs = sc; best = bpm; }
    }
    function comb(v) { // meilleur placement d'un peigne de période p : [score, phase]
      var p = 6000 / v, top = -1, ph = 0, f, j, s2, at;
      for (f = 0; f < p; f++) {
        s2 = 0;
        for (j = 0; (at = Math.round(f + j * p)) < n; j++) s2 += env[at];
        if (s2 > top) { top = s2; ph = f; }
      }
      return [top, ph];
    }
    var fine = best, fs = -1, c;
    for (bpm = best - 1.5; bpm <= best + 1.5; bpm += 0.02) { c = comb(bpm); if (c[0] > fs) { fs = c[0]; fine = bpm; } }
    if (Math.abs(fine - Math.round(fine)) < 0.12) fine = Math.round(fine); // la plupart des morceaux ont un tempo rond
    var p2 = 6000 / fine, phase = comb(fine)[1], sums = [0, 0, 0, 0], j2, at2;
    for (j2 = 0; (at2 = Math.round(phase + j2 * p2)) < n; j2++) sums[j2 % 4] += low[at2];
    var r = sums.indexOf(Math.max.apply(null, sums)), off = ((phase + r * p2) % (4 * p2)) / 100;
    return [Math.round(fine * 100) / 100, Math.round(off * 1000) / 1000];
  }

  // Décodage : il sert à la fois à la lecture exacte et à la forme d'onde
  // (240 valeurs de 0 à 255, gardée dans la base). Les ondes de la liste en
  // cours sont préparées d'avance, une par une, quand rien ne joue.
  var have = null, bad = {}, waveBusy = false, waveT = null, settled = '';
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
        // le morceau part d'abord ; les analyses (une seule fois par morceau, gardées avec les étiquettes) viennent juste après
        done(out);
        setTimeout(function () {
          // mode sync : le tempo
          if (B.cfg.sync && !cfg().bpm[D.key(t)]) { try { cfg().bpm[D.key(t)] = tempoOf(buf); B.save(); } catch (e) {} }
          // gamme automatique
          if (B.cfg.autoKey && !keyOk(cfg().key[D.key(t)])) { try { var ky = keyOf(buf); if (ky) { cfg().key[D.key(t)] = ky; B.save(); emit(); } } catch (e2) {} }
        }, 400);
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
        var t = null, k, nx = after(), idle = !ePlaying() && !Object.keys(A.voices).length;
        var state = D.rev + '|' + (D.track ? D.track.id : 0) + '|' + (nx ? nx.id : 0) + '|' + idle;
        if (state === settled) return;
        function ok(x) { return x && !bad[x.id] && (!x.ms || x.ms <= WAVE_MAX_MS); }
        function needBuf(x) { return ok(x) && fits(x) && !bufs[x.id]; }
        function needWave(x) { return ok(x) && !have[waveKey(x)]; }
        if (needBuf(D.track) || needWave(D.track)) t = D.track;
        else if (needBuf(nx)) t = nx;
        // les ondes d'avance attendent le silence : décoder pendant la lecture fait craquer un téléphone lent
        else if (idle) {
          for (k = 0; !t && k < D.queue.length && k < WAVE_AHEAD; k++) if (needWave(D.queue[k])) t = D.queue[k];
        }
        if (!t) { settled = state; return; }
        settled = '';
        waveBusy = true;
        compute(t, function (out) {
          waveBusy = false;
          if (!out) { bad[t.id] = 1; if (D.track === t && mode === 'wait') { var w = want; D.play(t); if (!w) D.pause(); } }
          else if (D.track === t) { D.wave = out; ready(); adopt(); emit(); }
          trim();
          pump();
        });
      });
    }, 300);
  }
  D.pump = function () { ready(); adopt(); pump(); };
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
    // enchaînement : l'ancien morceau freine comme un vinyle pendant que le nouveau démarre
    var xs = cfg().xspin !== false && cfg().brake >= 0.05 && ePlaying() && !braked ? cfg().brake : 0;
    clearRamp(); braked = false;
    if (xs && mode === 'buf') tailOff(xs); else bStop();
    if (au) { try { au.pause(); } catch (e) {} }
    if (dogT) { clearTimeout(dogT); dogT = null; }
    D.track = t;
    want = true;
    var cu = D.cue(t);
    trim();
    glide(0);
    if (bufs[t.id]) {
      // déjà décodé (c'était le « suivant ») : départ immédiat et exact
      mode = 'buf'; cur = bufs[t.id]; bpos = Math.min(cu.s, Math.max(0, cur.duration - 1));
      if (xs) { bStart(0.07, Math.max(0.15, cu.f)); eRamp(rateK, xs * 0.6, emit); } else bStart(rateK, cu.f, true);
    } else {
      // lu en flux le temps du décodage : il démarre tout de suite, directement à son point de départ
      // (fragment « #t= » de l'adresse), muet jusqu'à y être, puis avec son fondu d'entrée
      mode = 'stream'; cur = null;
      ensureAu();
      pend = null;
      if (pendT) { clearTimeout(pendT); pendT = null; }
      if (cu.s > 0 || cu.f > 0) {
        pend = { t: t, s: cu.s, f: cu.f };
        auLevel(0);
        // filet de sécurité : s'il n'a jamais signalé son arrivée, on ouvre quand même
        pendT = setTimeout(function () { pendT = null; if (pend && pend.t === t) cueOpen(); }, 2500);
      } else auLevel(1);
      au.src = D.base + 't/' + t.id + (cu.s > 0 ? '#t=' + cu.s.toFixed(2) : '');
      try { au.playbackRate = xs ? 0.07 : rateK; } catch (e2) {}
      auPlay();
      if (xs) eRamp(rateK, xs * 0.6, function () { adopt(); emit(); });
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
    if (mode === 'wait') { want = !want; emit(); return; } // pas encore décodé : il partira (ou non) à l'arrivée
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
