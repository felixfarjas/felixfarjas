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
  var D = B.deck = { base: 'https://boucan.music/', state: 'none', tracks: [], queue: [], track: null, rev: 0, onChange: null };
  var au = null, gain = null, duckK = 1, rateT = null, errs = 0, want = false;

  function nat() { return window.BoucanNative; }
  function cfg() { return B.cfg.deck; }
  function emit() { if (D.onChange) D.onChange(); }
  function low(s) { return String(s || '').toLowerCase(); }
  var FIELD = { dir: 'd', album: 'al', artist: 'a' };

  D.load = function () {
    var N = nat(), r;
    if (!N || !N.musicList) { D.state = 'none'; emit(); return; }
    try { r = N.musicList(); } catch (e) { r = '[]'; }
    if (r === 'PERM') { D.state = 'perm'; D.tracks = []; }
    else {
      try { D.tracks = JSON.parse(r); } catch (e2) { D.tracks = []; }
      D.state = 'ok';
    }
    D.queue = D.pick(cfg().kind, cfg().key);
    D.rev++;
    emit();
  };
  D.ask = function () { try { nat().musicAsk(); } catch (e) {} };
  // appelé par le natif après la réponse à la demande d'autorisation
  B.deckPerm = function () { if (B.cfg) D.load(); };

  // Les « playlists » : dossiers, albums ou artistes, avec leur nombre de morceaux.
  D.lists = function (kind) {
    var f = FIELD[kind], seen = {}, out = [];
    if (!f) return out;
    D.tracks.forEach(function (t) {
      var k = t[f] || '';
      if (!seen[k]) { seen[k] = { key: k, n: 0 }; out.push(seen[k]); }
      seen[k].n++;
    });
    out.sort(function (x, y) { return low(x.key) < low(y.key) ? -1 : low(x.key) > low(y.key) ? 1 : 0; });
    return out;
  };
  D.pick = function (kind, key) {
    var f = FIELD[kind];
    var q = D.tracks.filter(function (t) { return !f || (t[f] || '') === key; });
    q.sort(function (x, y) {
      // un album se lit dans l'ordre des pistes, le reste par titre
      if (kind === 'album' && x.n !== y.n) return x.n - y.n;
      return low(x.t) < low(y.t) ? -1 : low(x.t) > low(y.t) ? 1 : 0;
    });
    return q;
  };
  D.setList = function (kind, key) {
    cfg().kind = kind; cfg().key = key;
    D.queue = D.pick(kind, key);
    D.rev++;
    B.save();
    emit();
  };
  D.listName = function () { return FIELD[cfg().kind] ? cfg().key : ''; };

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
