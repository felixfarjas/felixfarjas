/*
 * Boucan — clips MIDI : horloge commune, synthés et batteries synthétisés,
 * générateur de motifs. Tout est joué dans la gamme choisie (réglage commun),
 * donc tout sonne juste ensemble sans rien connaître au solfège.
 * ES5 uniquement : doit tourner sur de vieilles WebView Android.
 */
(function (B) {
  'use strict';

  var A = B.audio, dsp = B.dsp, M = B.midi = {};

  M.KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  M.SCALES = {
    minor: [0, 2, 3, 5, 7, 8, 10], major: [0, 2, 4, 5, 7, 9, 11], pentam: [0, 3, 5, 7, 10], pentaM: [0, 2, 4, 7, 9],
    dorian: [0, 2, 3, 5, 7, 9, 10], phryg: [0, 1, 3, 5, 7, 8, 10], harm: [0, 2, 3, 5, 7, 8, 11], blues: [0, 3, 5, 6, 7, 10]
  };
  M.SCALE_IDS = ['minor', 'major', 'pentam', 'pentaM', 'dorian', 'phryg', 'harm', 'blues'];
  M.LANES = ['KICK', 'SNARE', 'CLAP', 'HAT', 'OPEN', 'TOM', 'PERC', 'CRASH'];
  M.MAX_VOICES = 4;

  var DEF = { bpm: 120, root: 9, scale: 'minor', swing: 0 };
  function cf() { return (B.cfg && B.cfg.midi) || DEF; }
  function ex(m, lo, hi) { return lo * Math.pow(hi / lo, m); }
  function rnd(n) { return Math.floor(Math.random() * n); }
  function pick(a) { return a[rnd(a.length)]; }

  // ====================== Gamme ======================
  // Gamme en vigueur : celle du réglage, ou celle du morceau qui joue (gamme automatique).
  var effKey = null, MINORS = ['minor', 'pentam', 'dorian', 'phryg', 'harm', 'blues'];
  function root() { return effKey ? effKey.root : cf().root; }
  M.scale = function () { return M.SCALES[effKey ? effKey.scale : cf().scale] || M.SCALES.minor; };
  M.key = function () { return effKey ? { root: effKey.root, scale: effKey.scale, auto: true } : { root: cf().root, scale: cf().scale, auto: false }; };
  // nombre de lignes d'une grille mélodique : deux octaves de la gamme, plus la tonique du haut
  M.rows = function () { return M.scale().length * 2 + 1; };
  function semi(n) {
    var sc = M.scale(), L = sc.length, k = ((n % L) + L) % L;
    return sc[k] + 12 * Math.floor(n / L);
  }
  M.noteName = function (n) { return M.KEYS[(((root() + semi(n)) % 12) + 12) % 12]; };
  M.isRoot = function (n) { var L = M.scale().length; return ((n % L) + L) % L === 0; };
  // n : degré dans la gamme (0 = tonique) ; oct : octave de départ de l'instrument
  M.freq = function (n, oct) {
    if (oct <= 1 && root() < 5) oct++; // les basses restent dans une zone qui s'entend
    return 440 * Math.pow(2, (12 * (oct + 1) + root() + semi(n) - 69) / 12);
  };

  // ====================== Instruments ======================
  // Chaque synthé : 4 macros (curseurs 0..1) traduites en réglages de son par patch(m).
  // gen : famille de motifs que le générateur lui écrit.
  M.INST = {
    k909: { name: 'KIT 909', kind: 'drum', group: 'drum', macros: ['punch', 'tone', 'decay', 'drive'], def: [0.5, 0.5, 1, 0.15], drive: function (m) { return m[3]; } },
    k808: { name: 'KIT 808', kind: 'drum', group: 'drum', macros: ['punch', 'tone', 'decay', 'drive'], def: [0.5, 0.5, 1, 0.1], drive: function (m) { return m[3]; } },
    ktrap: { name: 'KIT TRAP', kind: 'drum', group: 'drum', macros: ['punch', 'tone', 'decay', 'drive'], def: [0.6, 0.5, 1, 0.3], drive: function (m) { return m[3]; } },
    khard: { name: 'KIT HARD', kind: 'drum', group: 'drum', macros: ['punch', 'tone', 'decay', 'drive'], def: [0.6, 0.5, 0.9, 0.5], drive: function (m) { return m[3]; } },

    acid: { name: 'ACID', kind: 'synth', group: 'bass', gen: 'acid', oct: 1, macros: ['cutoff', 'reso', 'env', 'decay'], def: [0.35, 0.7, 0.6, 0.35],
      drive: function () { return 0.45; },
      patch: function (m) {
        return { oscs: [{ w: 'sawtooth' }], gain: 0.22, amp: { a: 0.003, d: 0.25, s: 0.75, r: 0.04 },
          flt: { f: ex(m[0], 90, 3500), q: 1 + m[1] * 9, env: m[2] * 5500, dec: ex(m[3], 0.05, 0.7), p4: true } };
      } },
    sub: { name: 'SUB 808', kind: 'synth', group: 'bass', gen: 'bass', oct: 1, macros: ['decay', 'drive', 'drop', 'tone'], def: [0.55, 0.4, 0.3, 0.3],
      drive: function (m) { return m[1]; },
      patch: function (m) {
        return { oscs: [{ w: 'sine' }, { w: 'triangle', g: m[3] * 0.6 }], gain: 0.5, pitch: { mul: 1 + m[2] * 3, t: 0.05 },
          amp: { a: 0.002, d: ex(m[0], 0.15, 2.5), s: 0, r: 0.08 } };
      } },
    reese: { name: 'REESE', kind: 'synth', group: 'bass', gen: 'bass', oct: 1, macros: ['cutoff', 'detune', 'reso', 'release'], def: [0.4, 0.45, 0.3, 0.2],
      drive: function () { return 0.3; },
      patch: function (m) {
        var c = 5 + m[1] * 40;
        return { oscs: [{ w: 'sawtooth', d: -c }, { w: 'sawtooth', d: c }, { w: 'sine', r: 0.5, g: 0.6 }], gain: 0.2,
          amp: { a: 0.008, d: 0.3, s: 0.9, r: ex(m[3], 0.03, 0.8) }, flt: { f: ex(m[0], 120, 6000), q: 0.7 + m[2] * 8, env: 0, dec: 0.1 } };
      } },
    donk: { name: 'DONK', kind: 'synth', group: 'bass', gen: 'bass', oct: 2, macros: ['bright', 'decay', 'pitch', 'drive'], def: [0.55, 0.35, 0.35, 0.4],
      drive: function (m) { return m[3]; },
      patch: function (m) {
        return { oscs: [{ w: 'sine' }], gain: 0.42, fm: { r: 1, idx: 2 + m[0] * 8, dec: 0.04 + m[1] * 0.1, sus: 0 }, pitch: { mul: 1 + m[2] * 1.5, t: 0.03 },
          amp: { a: 0.001, d: ex(m[1], 0.08, 0.6), s: 0, r: 0.05 } };
      } },
    organ: { name: 'ORGAN', kind: 'synth', group: 'bass', gen: 'bass', oct: 2, macros: ['tone', 'decay', 'click', 'drive'], def: [0.5, 0.55, 0.5, 0.25],
      drive: function (m) { return m[3]; },
      patch: function (m) {
        return { oscs: [{ w: 'sine' }, { w: 'sine', r: 2, g: 0.4 + m[0] * 0.5 }, { w: 'sine', r: 3, g: m[0] * 0.6 }, { w: 'sine', r: 4, g: m[0] * 0.3 }], gain: 0.2,
          fm: { r: 4, idx: m[2] * 3, dec: 0.02, sus: 0 }, amp: { a: 0.002, d: ex(m[1], 0.1, 2), s: 0.35, r: 0.06 } };
      } },

    supersaw: { name: 'SUPERSAW', kind: 'synth', group: 'lead', gen: 'lead', oct: 3, macros: ['cutoff', 'detune', 'attack', 'release'], def: [0.8, 0.45, 0, 0.3],
      drive: function () { return 0.15; },
      patch: function (m) {
        var s = 8 + m[1] * 40;
        return { oscs: [{ d: -s }, { d: -s / 2 }, { d: 0 }, { d: s / 2 }, { d: s }], gain: 0.12,
          amp: { a: ex(m[2] + 0.001, 0.003, 0.4), d: 0.3, s: 0.85, r: ex(m[3], 0.04, 1.2) }, flt: { f: ex(m[0], 400, 16000), q: 0.6, env: 0, dec: 0.1 } };
      } },
    hoover: { name: 'HOOVER', kind: 'synth', group: 'lead', gen: 'lead', oct: 3, macros: ['cutoff', 'detune', 'bend', 'release'], def: [0.7, 0.55, 0.5, 0.35],
      drive: function () { return 0.4; },
      patch: function (m) {
        var c = 10 + m[1] * 45;
        return { oscs: [{ d: -c }, { d: 0 }, { d: c }, { w: 'square', r: 0.5, g: 0.6 }], gain: 0.1, pitch: { mul: Math.pow(2, -m[2] * 7 / 12), t: 0.12 },
          amp: { a: 0.01, d: 0.2, s: 0.9, r: ex(m[3], 0.05, 1) }, flt: { f: ex(m[0], 500, 12000), q: 1.2, env: 0, dec: 0.1 } };
      } },
    cowbell: { name: 'COWBELL', kind: 'synth', group: 'lead', gen: 'lead', oct: 4, macros: ['tone', 'decay', 'drive', 'detune'], def: [0.5, 0.45, 0.5, 0.3],
      drive: function (m) { return m[2]; },
      patch: function (m) {
        return { oscs: [{ w: 'square' }, { w: 'square', r: 1.4836, d: m[3] * 30 }], gain: 0.3,
          amp: { a: 0.001, d: ex(m[1], 0.08, 0.9), s: 0, r: 0.05 }, flt: { type: 'bandpass', f: ex(m[0], 600, 3000), q: 1.2, env: 0, dec: 0.1, kt: 1 } };
      } },
    chip: { name: 'CHIP', kind: 'synth', group: 'lead', gen: 'arp', oct: 4, macros: ['decay', 'vibrato', 'octave', 'tone'], def: [0.7, 0.2, 0.3, 0.6],
      drive: function () { return 0; },
      patch: function (m) {
        return { oscs: [{ w: 'square' }, { w: 'square', r: 2, g: m[2] }], gain: 0.28, vib: { rate: 6, depth: m[1] * 35 },
          amp: { a: 0.002, d: ex(m[0], 0.08, 2), s: 0.55, r: 0.05 }, flt: { f: ex(m[3], 1500, 14000), q: 0.5, env: 0, dec: 0.1 } };
      } },

    pluck: { name: 'PLUCK', kind: 'synth', group: 'keys', gen: 'arp', oct: 3, macros: ['cutoff', 'decay', 'reso', 'tone'], def: [0.5, 0.4, 0.3, 0.5],
      drive: function () { return 0.1; },
      patch: function (m) {
        var d = ex(m[1], 0.08, 1.2);
        return { oscs: [{ w: 'sawtooth' }, { w: 'square', g: m[3] }], gain: 0.3,
          amp: { a: 0.002, d: d, s: 0, r: 0.08 }, flt: { f: ex(m[0], 200, 5000), q: 1 + m[2] * 8, env: 4000, dec: d * 0.7 } };
      } },
    bell: { name: 'BELL', kind: 'synth', group: 'keys', gen: 'arp', oct: 4, macros: ['bright', 'decay', 'ratio', 'detune'], def: [0.4, 0.6, 0.5, 0.2],
      drive: function () { return 0; },
      patch: function (m) {
        var d = ex(m[1], 0.2, 3);
        return { oscs: [{ w: 'sine' }, { w: 'sine', d: 4 + m[3] * 20, g: 0.6 }], gain: 0.34,
          fm: { r: [1.41, 2, 3.5, 5.19][Math.min(3, Math.floor(m[2] * 4))], idx: 1 + m[0] * 7, dec: d * 0.6, sus: 0.08 }, amp: { a: 0.002, d: d, s: 0, r: 0.2 } };
      } },
    pad: { name: 'PAD', kind: 'synth', group: 'keys', gen: 'pad', oct: 3, macros: ['cutoff', 'attack', 'release', 'detune'], def: [0.45, 0.5, 0.6, 0.4],
      drive: function () { return 0; },
      patch: function (m) {
        var c = 4 + m[3] * 25;
        return { oscs: [{ d: -c }, { d: c }, { w: 'triangle', g: 0.8 }], gain: 0.16,
          amp: { a: ex(m[1], 0.01, 1.2), d: 0.5, s: 0.8, r: ex(m[2], 0.1, 2.5) }, flt: { f: ex(m[0], 300, 8000), q: 0.7, env: 600, dec: 0.6 } };
      } }
  };
  M.GROUPS = ['drum', 'bass', 'lead', 'keys'];

  // ====================== Voies de mixage ======================
  var bus = null, chans = {}, live = 0;
  function ctx() { return A.ctx; }
  function getBus() {
    if (!bus) { bus = ctx().createGain(); bus.gain.value = 0.8; bus.connect(A.bus); }
    return bus;
  }
  function curve(amt) {
    var n = 256, c = new Float32Array(n), k = 1 + amt * 8, nk = Math.tanh(k), i;
    for (i = 0; i < n; i++) c[i] = Math.tanh(k * (i * 2 / (n - 1) - 1)) / nk;
    return c;
  }
  // Une voie par voix de clip : volume, saturation.
  function chan(key, vol, drive) {
    var c = chans[key], x = ctx();
    if (!c) {
      c = chans[key] = { inp: x.createGain(), sh: x.createWaveShaper(), out: x.createGain(), drive: -1, vol: -1, open: null };
      c.inp.connect(c.sh); c.sh.connect(c.out); c.out.connect(getBus());
    }
    if (c.vol !== vol) { c.vol = vol; c.inp.gain.setTargetAtTime(vol * vol * 1.3, x.currentTime, 0.02); }
    if (Math.abs(c.drive - drive) > 0.02) { c.drive = drive; c.sh.curve = curve(drive); c.out.gain.value = 0.76 / (1 + drive * 1.3); }
    return c;
  }
  function dropChans(prefix) {
    setTimeout(function () {
      if (active[prefix]) return;
      for (var k in chans) if (k.indexOf(prefix + ':') === 0) { try { chans[k].out.disconnect(); } catch (e) {} delete chans[k]; }
    }, 5000);
  }

  // ====================== Synthé ======================
  // Joue une note. dur null : note tenue jusqu'à off(). Renvoie { off(t) }.
  function noteOn(c, P, f, t, dur, vel) {
    if (live > 28) return null; // garde-fou pour les téléphones lents
    var x = ctx(), vca = x.createGain(), inp = vca, amp = P.amp, pk = vel * P.gain, os = [], i, o, mg = null, lg = null;
    var te = dur === null ? null : t + (amp.s === 0 ? Math.max(dur, amp.d * 1.5) : dur);
    vca.gain.setValueAtTime(0, t);
    vca.gain.setTargetAtTime(pk, t, amp.a / 3 + 0.0005);
    if (te === null || t + amp.a < te) vca.gain.setTargetAtTime(pk * amp.s, t + amp.a, amp.d / 3 + 0.001);
    if (P.flt) {
      var lo = Math.min(17000, P.flt.f + (P.flt.kt ? f * P.flt.kt : 0)), hi = Math.min(18000, lo + (P.flt.env || 0));
      var mk = function () {
        var b = x.createBiquadFilter();
        b.type = P.flt.type || 'lowpass';
        b.Q.value = P.flt.q;
        b.frequency.setValueAtTime(hi, t);
        if (hi > lo) b.frequency.setTargetAtTime(lo, t, P.flt.dec / 3 + 0.001);
        return b;
      };
      var f1 = mk();
      if (P.flt.p4) { var f2 = mk(); f1.connect(f2); f2.connect(vca); } else f1.connect(vca);
      inp = f1;
    }
    if (P.fm && P.fm.idx > 0) {
      var mod = x.createOscillator();
      mod.frequency.setValueAtTime(f * P.fm.r, t);
      mg = x.createGain();
      mg.gain.setValueAtTime(P.fm.idx * f, t);
      mg.gain.setTargetAtTime(P.fm.idx * f * (P.fm.sus || 0), t, P.fm.dec / 3 + 0.001);
      mod.connect(mg);
      os.push(mod);
    }
    if (P.vib && P.vib.depth > 0.5) {
      var lfo = x.createOscillator();
      lfo.frequency.value = P.vib.rate;
      lg = x.createGain();
      lg.gain.value = P.vib.depth;
      lfo.connect(lg);
      os.push(lfo);
    }
    for (i = 0; i < P.oscs.length; i++) {
      var d = P.oscs[i], fo = f * (d.r || 1);
      if (d.g === 0) continue;
      o = x.createOscillator();
      o.type = d.w || 'sawtooth';
      if (d.d) o.detune.value = d.d;
      if (P.pitch && P.pitch.mul !== 1) { o.frequency.setValueAtTime(fo * P.pitch.mul, t); o.frequency.exponentialRampToValueAtTime(fo, t + P.pitch.t); }
      else o.frequency.setValueAtTime(fo, t);
      if (mg) mg.connect(o.frequency);
      if (lg) lg.connect(o.detune);
      if (d.g !== undefined && d.g !== 1) { var og = x.createGain(); og.gain.value = d.g; o.connect(og); og.connect(inp); } else o.connect(inp);
      os.push(o);
    }
    vca.connect(c.inp);
    for (i = 0; i < os.length; i++) os[i].start(t);
    live++;
    var h = { done: false, f: f, flt: inp === vca ? null : inp, flt2: P.flt && P.flt.p4 ? inp : null };
    h.off = function (at) {
      if (h.done) return;
      h.done = true;
      if (dur === null) vca.gain.cancelScheduledValues(at);
      vca.gain.setTargetAtTime(0, at, amp.r / 3 + 0.002);
      for (var k = 0; k < os.length; k++) { try { os[k].stop(at + amp.r * 1.6 + 0.05); } catch (e) {} }
    };
    os[os.length - 1].onended = function () { live--; try { vca.disconnect(); } catch (e) {} };
    if (te !== null) h.off(te);
    return h;
  }

  // ====================== Batteries ======================
  // Chaque son est calculé une fois (à la première utilisation du kit), puis
  // rejoué depuis la mémoire : c'est ce qui coûte le moins au téléphone.
  var KITS = {
    k909: { kick: { f: 50, sw: 230, st: 0.02, dec: 0.2, dur: 0.5, drive: 1.6, click: 0.5 }, snare: { f: 200, dec: 0.12, hp: 2200, tone: 0.5 }, clap: { f: 1200, dec: 0.1 },
      hat: { dec: 0.02, hp: 8000, noise: 0.6 }, open: { dec: 0.16, hp: 8000, noise: 0.6 }, tom: { f: 130, dec: 0.14 }, perc: { rim: 1 }, crash: { dec: 0.5, hp: 5000 } },
    k808: { kick: { f: 46, sw: 90, st: 0.045, dec: 0.5, dur: 1.1, drive: 1.2, click: 0.25 }, snare: { f: 180, dec: 0.1, hp: 1500, tone: 0.9 }, clap: { f: 1050, dec: 0.09 },
      hat: { dec: 0.022, hp: 7000, noise: 0.1 }, open: { dec: 0.14, hp: 7000, noise: 0.1 }, tom: { f: 105, dec: 0.2 }, perc: { f: 540, dec: 0.09 }, crash: { dec: 0.4, hp: 6000 } },
    ktrap: { kick: { f: 42, sw: 110, st: 0.03, dec: 0.75, dur: 1.5, drive: 2.4, click: 0.4 }, snare: { f: 230, dec: 0.08, hp: 2800, tone: 0.4 }, clap: { f: 1400, dec: 0.07 },
      hat: { dec: 0.012, hp: 9000, noise: 0.5 }, open: { dec: 0.1, hp: 9000, noise: 0.5 }, tom: { f: 160, dec: 0.1 }, perc: { rim: 1 }, crash: { dec: 0.35, hp: 7000 } },
    khard: { kick: { f: 55, sw: 380, st: 0.03, dec: 0.3, dur: 0.6, drive: 7, click: 0.6 }, snare: { f: 210, dec: 0.1, hp: 2500, tone: 0.3 }, clap: { f: 1300, dec: 0.12 },
      hat: { dec: 0.016, hp: 9500, noise: 0.7 }, open: { dec: 0.2, hp: 8500, noise: 0.7 }, tom: { f: 120, dec: 0.12 }, perc: { f: 800, dec: 0.05 }, crash: { dec: 0.7, hp: 4500 } }
  };
  var METAL = [5.13, 7.61, 9.24, 13.07, 13.5, 20]; // rapports inharmoniques d'une cymbale analogique (base 40 Hz)
  var kits = {}, LEVEL = [1, 0.9, 0.8, 0.45, 0.45, 0.85, 0.65, 0.55];
  function hp(a, fc, passes) {
    var k = Math.exp(-2 * Math.PI * fc / dsp.SR), p, i, l;
    for (p = 0; p < passes; p++) { l = 0; for (i = 0; i < a.length; i++) { l = k * l + (1 - k) * a[i]; a[i] -= l; } }
  }
  function lpf(a, fc) {
    var k = Math.exp(-2 * Math.PI * fc / dsp.SR), i, l = 0;
    for (i = 0; i < a.length; i++) { l = k * l + (1 - k) * a[i]; a[i] = l; }
  }
  function finish(a, drive, peak) {
    var i, m = 0, n = a.length, fo = Math.floor(0.01 * dsp.SR);
    for (i = 0; i < n; i++) { if (drive) a[i] = Math.tanh(a[i] * drive); if (Math.abs(a[i]) > m) m = Math.abs(a[i]); }
    for (i = 0; i < n; i++) a[i] *= peak / (m || 1);
    for (i = 0; i < fo && i < n; i++) a[n - 1 - i] *= i / fo;
    return A.pcmBuffer(a, dsp.SR);
  }
  function cymbal(dur, dec, cut, noise, peak) {
    var a = dsp.buf(dur), r = dsp.rng(7);
    dsp.tone(a, 0, { wave: 'square', f: 40, det: METAL, dur: dur - 0.02, a: 0.001, r: 0.01, decay: dec, gain: 1 });
    if (noise) dsp.noise(a, 0, { dur: dur - 0.01, decay: dec, gain: noise, type: 'hp', f: 6000, rnd: r });
    hp(a, cut, 2);
    return finish(a, 0, peak);
  }
  function kitOf(id) {
    if (kits[id]) return kits[id];
    var K = KITS[id] || KITS.k909, k = [], r = dsp.rng(11), a, i;
    // 0 kick
    a = dsp.buf(K.kick.dur + 0.1);
    dsp.tone(a, 0, { wave: 'sine', phase: 1, dur: K.kick.dur, a: 0.001, r: 0.05, decay: K.kick.dec, gain: 0.9,
      f: function (x) { return K.kick.f + K.kick.sw * Math.exp(-x / K.kick.st); } });
    dsp.noise(a, 0, { dur: 0.012, gain: K.kick.click, type: 'lp', f: 3500, rnd: r });
    k.push(finish(a, K.kick.drive, 0.95));
    // 1 snare
    a = dsp.buf(0.4);
    dsp.tone(a, 0, { wave: 'tri', phase: 1, dur: 0.12, a: 0.001, decay: 0.045, gain: 0.5 * K.snare.tone, f: function (x) { return K.snare.f + 90 * Math.exp(-x / 0.02); } });
    dsp.tone(a, 0, { wave: 'sine', phase: 1, dur: 0.1, a: 0.001, decay: 0.035, gain: 0.3 * K.snare.tone, f: K.snare.f * 1.78 });
    dsp.noise(a, 0, { dur: 0.3, decay: K.snare.dec * 0.55, gain: 0.9, type: 'bp', f: K.snare.hp, q: 0.7, rnd: r });
    dsp.noise(a, 0, { dur: 0.2, decay: K.snare.dec * 0.3, gain: 0.45, type: 'hp', f: 5500, rnd: r });
    k.push(finish(a, 1.4, 0.9));
    // 2 clap
    a = dsp.buf(0.5);
    for (i = 0; i < 4; i++) dsp.noise(a, i * 0.009, { dur: 0.02, decay: 0.007, gain: 0.8, type: 'bp', f: K.clap.f, q: 1.3, rnd: r });
    dsp.noise(a, 0.034, { dur: 0.4, decay: K.clap.dec * 0.6, gain: 0.8, type: 'bp', f: K.clap.f * 0.95, q: 1, rnd: r });
    k.push(finish(a, 1.3, 0.85));
    // 3 charley fermé, 4 ouvert
    k.push(cymbal(0.14, K.hat.dec, K.hat.hp, K.hat.noise, 0.55));
    k.push(cymbal(0.7, K.open.dec, K.open.hp, K.open.noise, 0.5));
    // 5 tom
    a = dsp.buf(0.6);
    dsp.tone(a, 0, { wave: 'sine', phase: 1, dur: 0.5, a: 0.001, decay: K.tom.dec, gain: 0.9, f: function (x) { return K.tom.f * (1 + 0.6 * Math.exp(-x / 0.03)); } });
    dsp.noise(a, 0, { dur: 0.02, gain: 0.2, type: 'lp', f: 2500, rnd: r });
    k.push(finish(a, 1.2, 0.85));
    // 6 percussion : rimshot ou cloche
    a = dsp.buf(0.5);
    if (K.perc.rim) {
      dsp.tone(a, 0, { wave: 'sine', phase: 1, dur: 0.05, a: 0.0005, decay: 0.012, gain: 0.8, f: 1650 });
      dsp.tone(a, 0, { wave: 'tri', phase: 1, dur: 0.05, a: 0.0005, decay: 0.015, gain: 0.6, f: 480 });
      dsp.noise(a, 0, { dur: 0.01, gain: 0.4, type: 'hp', f: 4000, rnd: r });
    } else {
      dsp.tone(a, 0, { wave: 'square', f: K.perc.f, det: [1, 1.481], dur: 0.4, a: 0.001, decay: K.perc.dec, gain: 0.9 });
      hp(a, K.perc.f * 0.8, 1); lpf(a, K.perc.f * 6);
    }
    k.push(finish(a, 1.2, 0.7));
    // 7 crash
    k.push(cymbal(1.6, K.crash.dec, K.crash.hp, 0.9, 0.45));
    kits[id] = k;
    return k;
  }
  // m : macros du kit [kick, hauteur, durée, saturation]
  function drumHit(c, kit, lane, t, vel, m, pk) {
    var b = kit[lane];
    if (!b) return;
    var x = ctx(), s = x.createBufferSource(), g = x.createGain(), rate = Math.pow(2, (m[1] - 0.5) * (lane === 0 ? 0.6 : 1.2)) * (pk || 1);
    s.buffer = b;
    s.playbackRate.value = rate;
    // chaque élément à sa place dans le mix : le kick devant, les cymbales derrière
    g.gain.setValueAtTime(vel * (lane === 0 ? 0.55 + m[0] * 0.9 : LEVEL[lane]), t);
    if (m[2] < 0.98) {
      var keep = b.duration / rate * (0.06 + 0.94 * m[2]);
      g.gain.setTargetAtTime(0, t + keep * 0.4, keep * 0.25 + 0.004);
    }
    // le charley fermé étouffe le charley ouvert, comme sur une vraie batterie
    if (lane === 3 && c.open) { try { c.open.gain.cancelScheduledValues(t); c.open.gain.setTargetAtTime(0, t, 0.008); } catch (e) {} }
    if (lane === 4) c.open = g;
    s.connect(g); g.connect(c.inp);
    s.onended = function () { try { g.disconnect(); } catch (e) {} };
    s.start(t);
  }

  // ====================== Horloge ======================
  // Un « tick » = une double croche. L'horloge est commune à tout : un clip
  // qu'on lance entre aussitôt, à l'endroit de la mesure où en est l'horloge.
  // En mode sync, elle se cale sur le tempo et les temps de la musique du lecteur.
  var active = {};  // id de case -> { pad, page }
  var maps = {};    // id de case -> pour chaque voix, notes rangées par pas
  var timer = null, nextTick = 0, nextTime = 0, lastTick = 0, lastTime = 0, lastRun = 0;
  var bpmNow = 0, bk = 1, bkOn = false, bkTime = 0.9, snap = false;

  // Tempo en vigueur : celui du réglage, ou celui de la musique en mode sync.
  M.bpm = function () { return bpmNow || cf().bpm; };
  // Musique du lecteur sur laquelle se caler (mode sync), ou null.
  function music() { return B.cfg && B.cfg.sync && B.deck && B.deck.beat ? B.deck.beat() : null; }
  // Fait glisser le tempo vers sa cible : vite quand une musique donne le tempo,
  // en 3 secondes environ quand on revient au tempo réglé.
  function tempo(dt) {
    var m = music(), target = m ? m.bpm * m.rate : cf().bpm;
    if (!bpmNow || dt <= 0) bpmNow = target;
    else bpmNow += (target - bpmNow) * (1 - Math.exp(-dt / (m || M.locked ? 0.12 : 1)));
    if (Math.abs(target - bpmNow) < 0.02) bpmNow = target;
    M.locked = !!m;
    return m;
  }
  function tickDur() { return 60 / M.bpm() / 4 / Math.max(0.05, bk); }
  // Hauteur à appliquer aux notes : effet PITCH et vinyl stop.
  function pitch() { return (A.target !== 'music' ? A.pitchK || 1 : 1) * bk; }
  function change(id) { if (A.onChange) A.onChange(id); }
  // à appeler après toute modification des notes d'un clip
  M.touch = function (pad) { delete maps[pad.id]; };
  function mapOf(pad) {
    var m = maps[pad.id];
    if (m) return m;
    m = maps[pad.id] = pad.voices.map(function (v) {
      var o = {};
      v.n.forEach(function (nt) { (o[nt[0]] = o[nt[0]] || []).push(nt); });
      return o;
    });
    return m;
  }
  function playStep(pad, step, tt, sd) {
    var mp = mapOf(pad), pk = pitch();
    pad.voices.forEach(function (v, vi) {
      var list = mp[vi] && mp[vi][step], I = M.INST[v.inst], k;
      if (!list || v.mute || !I) return;
      var c = chan(pad.id + ':' + vi, v.vol, I.drive(v.m));
      if (I.kind === 'drum') {
        var kit = kitOf(v.inst);
        for (k = 0; k < list.length; k++) drumHit(c, kit, list[k][1], tt, list[k][1] === 3 && step % 2 ? 0.6 : 1, v.m, pk);
      } else {
        var P = I.patch(v.m);
        for (k = 0; k < list.length; k++) noteOn(c, P, M.freq(list[k][1], I.oct + (v.oct || 0)) * pk, tt, list[k][2] * sd * 0.92, 0.9);
      }
    });
  }
  function posOf(pad, g) { var len = pad.bars * 16; return ((g % len) + len) % len; }
  function schedule(g, tt) {
    for (var id in active) {
      var pad = active[id].pad, st = 16 / pad.steps, pos = posOf(pad, g);
      if (pos % st === 0) playStep(pad, pos / st, tt, st * tickDur());
    }
  }
  function run() {
    var now = ctx().currentTime, ahead = document.hidden ? 1.5 : 0.14, dt = lastRun ? now - lastRun : 0, m;
    lastRun = now;
    m = tempo(dt);
    // vinyl stop : l'horloge freine avec le son, puis repart
    if (bkOn) bk = Math.max(0.02, bk - dt / bkTime); else if (bk < 1) bk = Math.min(1, bk + dt / 0.35);
    if (bk < 0.06) { nextTime = now + 0.03; return; }
    if (m && m.rate > 0.3 && bk === 1) {
      // calage sur la musique : la position dans le morceau donne le temps exact de chaque tick
      var td = 60 / (m.bpm * m.rate) / 4, mt = (m.pos - m.off) / (60 / m.bpm) * 4, ideal = now + (nextTick - mt) * td;
      // saut dans le morceau, autre morceau, premier calage : on se replace d'un coup
      if (snap) {
        // SYNC à la main : on repart du temps qu'on vient de taper, même s'il est passé de quelques millisecondes
        snap = false;
        nextTick = Math.floor(mt + 0.5);
        ideal = Math.max(now, now + (nextTick - mt) * td);
      } else if (ideal < now - 0.03 || ideal > now + ahead + td * 1.6) { nextTick = Math.ceil(mt + 0.03 / td); ideal = now + (nextTick - mt) * td; }
      nextTime = ideal;
    } else if (nextTime < now - 0.25) nextTime = now + 0.02; // l'horloge a été gelée (appli en arrière-plan) : on repart d'ici
    while (nextTime < now + ahead) {
      schedule(nextTick, nextTime + (((nextTick % 2) + 2) % 2 ? cf().swing * tickDur() * 0.5 : 0));
      lastTick = nextTick; lastTime = nextTime;
      nextTick++;
      nextTime += tickDur();
    }
  }
  function any(o) { for (var k in o) return true; return false; }
  function halt() { if (timer) { clearInterval(timer); timer = null; lastRun = 0; } }

  M.state = function (pad) { return active[pad.id] ? 'on' : ''; };
  // Début et durée de la boucle en cours (pour la barre de progression de la case).
  M.info = function (pad) {
    if (!active[pad.id]) return null;
    var td = tickDur();
    return { t0: lastTime - posOf(pad, lastTick) * td, dur: pad.bars * 16 * td, loop: true };
  };
  // Pas en cours de lecture dans le clip, ou -1.
  M.stepOf = function (pad) {
    if (!active[pad.id]) return -1;
    return Math.floor(posOf(pad, lastTick) / (16 / pad.steps));
  };
  M.stop = function (pad) {
    if (active[pad.id]) { delete active[pad.id]; dropChans(pad.id); }
    if (!any(active)) halt();
    change(pad.id);
  };
  // Lance ou arrête un clip. Il entre tout de suite, calé sur l'horloge. Un clip
  // exclusif remplace celui de sa page ; un clip réglé « en plus des autres »
  // (pad.layer) s'ajoute sans rien couper.
  M.toggle = function (pad, page) {
    var id;
    if (active[pad.id]) { M.stop(pad); return; }
    A.resume(); A.unkill();
    if (!pad.layer) for (id in active) if (active[id].page === page && !active[id].pad.layer) { delete active[id]; dropChans(id); change(id); }
    active[pad.id] = { pad: pad, page: page };
    if (!timer) {
      // premier clip : il part du début (ou, en mode sync, de l'endroit où en est la musique)
      nextTick = 0; nextTime = ctx().currentTime + 0.05;
      lastTick = 0; lastTime = nextTime; lastRun = 0;
      bk = 1; bkOn = false;
      timer = setInterval(run, 25);
      run();
    }
    change(pad.id);
  };
  M.stopAll = function () {
    var ids = Object.keys(active);
    active = {};
    halt();
    ids.forEach(function (id) { dropChans(id); change(id); });
    for (var k in held) { if (held[k]) held[k].off(ctx().currentTime); delete held[k]; }
  };
  // Effet vinyl stop sur les clips.
  M.brake = function (on, time) { bkOn = on; bkTime = time || 0.9; };
  // Tenu à jour une fois par seconde quand aucun clip ne joue : les effets calés sur le tempo suivent la musique.
  M.poll = function () {
    var before = M.bpm();
    if (!timer) tempo(music() || !bpmNow ? 0 : 1);
    if (Math.abs(M.bpm() - before) > 0.3 && A.refx) A.refx();
    // gamme automatique : on garde la famille choisie (mineure, penta…) si elle va avec le morceau
    var k = B.cfg && B.cfg.autoKey && B.deck && B.deck.keyNow ? B.deck.keyNow() : null, nk = null, sc = cf().scale;
    if (k) nk = { root: k[0], scale: k[1] ? (MINORS.indexOf(sc) >= 0 ? sc : 'minor') : (sc === 'major' || sc === 'pentaM' ? sc : 'major') };
    if ((nk && nk.root) + ':' + (nk && nk.scale) !== (effKey && effKey.root) + ':' + (effKey && effKey.scale)) {
      effKey = nk;
      if (M.onKey) M.onKey();
    }
  };

  // ====================== BPM control ======================
  M.musicLocked = function () { return !!music(); };
  // − / + : en mode sync sur une musique, corrige le tempo du morceau au dixième ;
  // sinon change le tempo réglé, d'un BPM.
  M.nudge = function (d) {
    var m = music(), v;
    if (m) {
      v = Math.round((m.bpm + d * 0.1) * 10) / 10;
      if (B.deck.setBpm(v)) bpmNow = v * m.rate;
    } else {
      cf().bpm = Math.max(60, Math.min(200, Math.round(cf().bpm + d)));
      bpmNow = cf().bpm;
      B.save();
    }
    if (A.refx) A.refx();
  };
  // SYNC : les clips repartent du début à cet instant. Sur une musique, ce calage
  // devient le premier temps du morceau, et il est gardé.
  M.resync = function () {
    var m = music(), now = ctx().currentTime;
    // le premier temps tombe pile à l'instant du toucher, et on le joue aussitôt
    if (m) { B.deck.setOff(m.pos); snap = true; }
    else if (timer) { nextTick = 0; nextTime = now; }
    if (timer) run();
  };
  // Appui long sur SYNC : on oublie le calage manuel, retour à l'analyse automatique.
  M.unsync = function () { return !!music() && B.deck.resetManual(); };
  // Où en est le temps (en temps, à virgule), pour le voyant : horloge des clips, ou musique en mode sync.
  M.phase = function () {
    if (timer) return (lastTick + (ctx().currentTime - lastTime) / tickDur()) / 4;
    var m = music();
    return m ? (m.pos - m.off) / (60 / m.bpm) : null;
  };
  // Durée (secondes) ramenée à la division du temps la plus proche : 1/4, 1/3, 1/2, 3/4, 1, 2 temps.
  M.div = function (sec, max) {
    var beat = 60 / M.bpm(), best = sec, err = 1e9;
    [0.25, 1 / 3, 0.5, 0.75, 1, 2].forEach(function (f) {
      var v = beat * f, e = Math.abs(Math.log(v / sec));
      if (v <= (max || 1e9) && e < err) { err = e; best = v; }
    });
    return best;
  };
  // Fréquence (Hz) ramenée à un multiple du temps : 1/2, 1, 2, 4 ou 8 par temps.
  M.rateQ = function (hz) {
    var bps = M.bpm() / 60, best = hz, err = 1e9;
    [0.5, 1, 2, 4, 8].forEach(function (f) { var e = Math.abs(Math.log(bps * f / hz)); if (e < err) { err = e; best = bps * f; } });
    return best;
  };
  // Instant du prochain temps de l'horloge (pour caler le hachoir), ou 0 si elle ne tourne pas.
  M.nextBeat = function () {
    if (!timer) return 0;
    var k = ((nextTick % 4) + 4) % 4;
    return nextTime + (k ? 4 - k : 0) * tickDur();
  };
  M.playing = function () { return !!timer; };

  // Écoute d'une note ou d'une frappe pendant l'édition.
  M.preview = function (pad, vi, d) {
    var v = pad.voices[vi], I = M.INST[v.inst], c = chan(pad.id + ':' + vi, v.vol, I.drive(v.m)), t = ctx().currentTime + 0.01;
    A.resume(); A.unkill();
    if (I.kind === 'drum') drumHit(c, kitOf(v.inst), d, t, 1, v.m, 1);
    else noteOn(c, I.patch(v.m), M.freq(d, I.oct + (v.oct || 0)), t, 0.25, 0.9);
  };
  // Joue une note à la main et, si le clip tourne, l'inscrit dans la boucle sur
  // le pas le plus proche (jeu en direct, quantifié). Renvoie le pas, ou -1.
  M.record = function (pad, vi, d) {
    var info = M.info(pad), v = pad.voices[vi], total = pad.bars * pad.steps, s, k;
    M.preview(pad, vi, d);
    if (!info) return -1;
    s = Math.round((ctx().currentTime - info.t0) / ((16 / pad.steps) * tickDur()));
    s = ((s % total) + total) % total;
    for (k = 0; k < v.n.length; k++) if (v.n[k][0] === s && v.n[k][1] === d) return s;
    v.n.push([s, d, 1]);
    M.touch(pad);
    return s;
  };

  // ====================== Clavier (widget) ======================
  var held = {};
  M.keyOn = function (pad, key, n) {
    var I = M.INST[pad.inst] || M.INST.pluck;
    A.resume(); A.unkill();
    M.keyOff(key);
    held[key] = noteOn(chan(pad.id + ':k', pad.vol, I.drive(pad.m)), I.patch(pad.m), M.freq(n, I.oct + (pad.oct || 0)) * pitch(), ctx().currentTime, null, 0.9);
  };
  // Les réglages du clavier ont bougé pendant qu'on joue : le filtre des notes tenues suit le doigt.
  M.keyBend = function (pad) {
    var I = M.INST[pad.inst] || M.INST.pluck, P = I.patch(pad.m), k, h, t = ctx().currentTime;
    if (!P.flt) return;
    for (k in held) {
      h = held[k];
      if (!h || !h.flt || k.indexOf(pad.id + ':') !== 0) continue;
      try {
        h.flt.frequency.cancelScheduledValues(t);
        h.flt.frequency.setTargetAtTime(Math.min(17000, P.flt.f + (P.flt.kt ? h.f * P.flt.kt : 0)), t, 0.03);
        h.flt.Q.setTargetAtTime(P.flt.q, t, 0.03);
      } catch (e) {}
    }
  };
  M.keyOff = function (key) {
    if (held[key]) held[key].off(ctx().currentTime);
    delete held[key];
  };

  // ====================== Clips ======================
  M.newVoice = function (inst) {
    return { inst: inst, vol: 0.8, oct: 0, mute: false, m: M.INST[inst].def.slice(), n: [] };
  };
  M.newClip = function (id, color) {
    var pad = { id: id, type: 'midi', name: 'MIDI', color: color, bars: 2, steps: 16, prog: [0, 5, 2, 6], live: [[0, 2]], layer: false, voices: [M.newVoice('k909')] };
    M.newProg(pad);
    M.generate(pad, 0);
    return pad;
  };
  // Page de démonstration des sons d'origine : trois clips prêts à jouer.
  M.demo = function (uid) {
    function clip(name, color, insts) {
      var pad = M.newClip(uid('p'), color);
      pad.name = name;
      pad.voices = insts.map(M.newVoice);
      M.newProg(pad);
      pad.voices.forEach(function (v, k) { M.generate(pad, k); });
      // le glissé sur la case règle la première macro du premier synthé
      pad.live = [[Math.min(1, pad.voices.length - 1), 0]];
      return pad;
    }
    return [clip('ACID', '#FDD835', ['k909', 'acid']), clip('TRAP', '#8E24AA', ['ktrap', 'sub', 'bell']),
      clip('HOUSE', '#00ACC1', ['k909', 'organ', 'pluck']), clip('RAVE', '#E53935', ['khard', 'reese', 'hoover'])];
  };
  M.setBars = function (pad, bars) {
    var old = pad.bars * pad.steps, now = bars * pad.steps;
    pad.voices.forEach(function (v) {
      var out = [];
      v.n.forEach(function (nt) {
        // on rallonge : le contenu existant est recopié dans les nouvelles mesures
        for (var s = nt[0]; s < now; s += old) out.push([s, nt[1], Math.min(nt[2], now - s)]);
      });
      v.n = out;
    });
    pad.bars = bars;
    M.touch(pad);
  };
  M.setSteps = function (pad, steps) {
    if (steps === pad.steps) return;
    var up = steps > pad.steps;
    pad.voices.forEach(function (v) {
      var seen = {}, out = [];
      v.n.forEach(function (nt) {
        var s = up ? nt[0] * 2 : Math.floor(nt[0] / 2), l = up ? nt[2] * 2 : Math.max(1, Math.round(nt[2] / 2)), k = s + ':' + nt[1];
        if (!seen[k]) { seen[k] = 1; out.push([s, nt[1], l]); }
      });
      v.n = out;
    });
    pad.steps = steps;
    M.touch(pad);
  };

  // ====================== Générateur de motifs ======================
  // Les voix d'un clip suivent la même suite d'accords (pad.prog) : elles
  // s'accordent donc toujours entre elles.
  var PROGS = [[0, 5, 2, 6], [0, 3, 5, 4], [0, 5, 3, 4], [0, 2, 5, 4], [0, 6, 5, 6], [0, 3, 0, 4]];
  M.newProg = function (pad) { pad.prog = pick(PROGS).slice(); };

  M.generate = function (pad, vi) {
    var v = pad.voices[vi], I = M.INST[v.inst], S = pad.steps, T = pad.bars * S, L = M.scale().length, top = 2 * L, seen = {}, out = [], bar, k;
    var nC = pad.bars >= 4 ? 4 : 2, seg = T / nC;
    function root(step) { return pad.prog[Math.floor(step / seg) % 4] % L; }
    function clampN(n) { while (n > top) n -= L; while (n < 0) n += L; return n; }
    // s16 et l16 en doubles croches dans la mesure
    function put(s16, d, l16) {
      if (S === 8 && s16 % 2) return;
      var s = bar * S + (S === 8 ? s16 / 2 : s16), l = Math.max(1, S === 8 ? Math.round((l16 || 1) / 2) : l16 || 1), key = s + ':' + d;
      if (s >= T || seen[key]) return;
      seen[key] = 1;
      out.push([s, d, Math.min(l, T - s)]);
    }
    function each(list, fn) { for (var q = 0; q < list.length; q++) fn(list[q], q); }

    if (I.kind === 'drum') {
      var style = v.inst === 'ktrap' ? 'trap' : v.inst === 'k808' ? 'electro' : 'four';
      var kick = style === 'trap' ? pick([[0, 6, 10], [0, 3, 8, 11], [0, 7, 8, 14]]) : style === 'electro' ? pick([[0, 6, 10], [0, 3, 6, 10], [0, 4, 10, 12]]) : [0, 4, 8, 12];
      var open = Math.random() < 0.6, roll = pick([[5, 7], [13, 15], [9, 11], []]), percs = [rnd(16), rnd(16)];
      for (bar = 0; bar < pad.bars; bar++) {
        var last = bar === pad.bars - 1 && pad.bars > 1;
        each(kick, function (s) { put(s, 0); });
        if (style === 'trap') { put(8, 1); put(8, 2); } else { put(4, 2); put(12, 2); if (style === 'electro') { put(4, 1); put(12, 1); } }
        if (style === 'four') { each([2, 6, 10, 14], function (s) { put(s, open && v.inst === 'khard' ? 4 : 3); }); if (open && v.inst !== 'khard') put(14, 4); }
        else { each([0, 2, 4, 6, 8, 10, 12, 14], function (s) { put(s, 3); }); each(roll, function (s) { put(s, 3); }); if (open) put(14, 4); }
        if (Math.random() < 0.7) each(percs, function (s) { put(s, 6); });
        if (last) each(pick([[13, 14, 15], [14, 15], [10, 13, 15], []]), function (s) { put(s, style === 'four' ? 1 : 5); });
        if (bar === 0 && pad.bars >= 2 && style === 'four') put(0, 7);
      }
    } else if (I.gen === 'pad') {
      for (k = 0; k < nC; k++) {
        bar = 0;
        var r0 = root(k * seg), s0 = k * seg;
        [0, 2, 4].forEach(function (off) { out.push([s0, clampN(r0 + off), seg]); });
      }
    } else {
      var lowOnly = I.gen === 'bass', len1 = I.gen === 'bass' ? 2 : 1;
      var rh = I.gen === 'bass' ? pick([[0, 3, 6, 8, 11, 14], [2, 6, 10, 14], [0, 6, 8, 14], [0, 2, 4, 6, 8, 10, 12, 14]]) :
        I.gen === 'arp' ? pick([[0, 2, 4, 6, 8, 10, 12, 14], [0, 3, 6, 8, 11, 14], [0, 2, 3, 6, 8, 10, 11, 14]]) :
        I.gen === 'lead' ? pick([[0, 3, 6, 8, 11, 14], [0, 2, 4, 8, 10, 12], [0, 4, 6, 8, 12, 14], [0, 6, 8, 14]]) : null;
      // deux phrases (A et B) qui alternent : ça se retient, sans tourner en rond
      var phrases = [0, 1].map(function () {
        var p = [], cur = pick([0, 2, 4]), q;
        if (I.gen === 'acid') {
          for (q = 0; q < 16; q++) if (Math.random() < 0.72) p.push([q, pick([0, 0, 0, 0, L, L, 2, 4]), Math.random() < 0.2 ? 2 : 1]);
        } else {
          each(rh, function (s, qi) {
            var nxt = qi + 1 < rh.length ? rh[qi + 1] : 16, off;
            if (I.gen === 'bass') off = Math.random() < 0.2 ? L : 0;
            else if (I.gen === 'arp') off = [0, 2, 4, L, 4, 2][qi % 6];
            else { cur += pick([-2, -1, 0, 1, 2]); if (qi === rh.length - 1) cur = pick([0, 2, 4]); off = Math.max(-2, Math.min(L, cur)); }
            p.push([s, off, I.gen === 'lead' ? Math.max(1, Math.min(4, nxt - s - (nxt - s > 2 ? 1 : 0))) : len1]);
          });
        }
        return p;
      });
      for (bar = 0; bar < pad.bars; bar++) {
        each(phrases[bar % 2], function (nt) {
          var r1 = root(bar * S + (S === 8 ? Math.floor(nt[0] / 2) : nt[0]));
          put(nt[0], clampN(r1 + nt[1] + (lowOnly || I.gen === 'acid' ? 0 : r1 < L / 2 ? L : 0)), nt[2]);
        });
      }
    }
    v.n = out;
    M.touch(pad);
  };
})(window.Boucan);
