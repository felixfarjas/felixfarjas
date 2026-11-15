/*
 * Boucan — sons d'origine.
 * Les 16 sons livrés avec l'app sont synthétisés ici (aucun fichier audio
 * embarqué, aucun enregistrement sous droits). Les mélodies sont toutes du
 * domaine public. Chaque fonction rend un Float32Array mono à 44,1 kHz.
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

  var SR = 44100, TAU = Math.PI * 2;
  B.SR = SR;

  function buf(sec) { return new Float32Array(Math.ceil(sec * SR)); }

  // Générateur pseudo-aléatoire à graine : les sons sont identiques partout.
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var defRnd = rng(1);

  var SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function N(name) {
    var m = /^([A-G])([#b]?)(\d)$/.exec(name);
    var v = SEMI[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (parseInt(m[3], 10) + 1) * 12;
    return 440 * Math.pow(2, (v - 69) / 12);
  }

  function blep(p, dt) {
    if (p < dt) { p /= dt; return p + p - p * p - 1; }
    if (p > 1 - dt) { p = (p - 1) / dt; return p * p + p + p + 1; }
    return 0;
  }

  /*
   * Oscillateur. o : f (Hz ou fn(t)), dur, wave (saw|square|sine|tri), gain,
   * a (attaque), r (relâchement), decay (constante de temps), env fn(t),
   * cut (passe-bas Hz ou fn(t)), det ([ratios] de désaccord), vib {rate, depth, delay}
   */
  function tone(out, t0, o) {
    var r = o.r === undefined ? 0.03 : o.r;
    var a = o.a === undefined ? 0.005 : o.a;
    var gain = o.gain === undefined ? 0.5 : o.gain;
    var n0 = Math.round(t0 * SR), len = Math.floor((o.dur + r) * SR);
    var dets = o.det || [1], nv = dets.length, ph = [], v, i;
    for (v = 0; v < nv; v++) ph.push(o.phase ? 0 : (v * 0.37) % 1);
    var fFn = typeof o.f === 'function', cFn = typeof o.cut === 'function';
    var wave = o.wave || 'saw', lp1 = 0, lp2 = 0;
    for (i = 0; i < len; i++) {
      var idx = n0 + i;
      if (idx >= out.length) break;
      if (idx < 0) continue;
      var t = i / SR;
      var f = fFn ? o.f(t) : o.f;
      if (o.vib && t > (o.vib.delay || 0)) f *= 1 + o.vib.depth * Math.sin(TAU * o.vib.rate * t);
      var s = 0;
      for (v = 0; v < nv; v++) {
        var dt = f * dets[v] / SR, p = ph[v], x;
        if (wave === 'sine') x = Math.sin(TAU * p);
        else if (wave === 'tri') x = 4 * Math.abs(p - 0.5) - 1;
        else if (wave === 'square') x = (p < 0.5 ? 1 : -1) + blep(p, dt) - blep((p + 0.5) % 1, dt);
        else x = 2 * p - 1 - blep(p, dt);
        s += x;
        p += dt;
        if (p >= 1) p -= 1;
        ph[v] = p;
      }
      s /= nv;
      if (o.cut) {
        var c = cFn ? o.cut(t) : o.cut;
        var k = 1 - Math.exp(-TAU * c / SR);
        lp1 += k * (s - lp1);
        lp2 += k * (lp1 - lp2);
        s = lp2;
      }
      var env = t < a ? t / a : 1;
      if (o.decay) env *= Math.exp(-t / o.decay);
      if (o.env) env *= o.env(t);
      if (t > o.dur) env *= Math.max(0, 1 - (t - o.dur) / r);
      out[idx] += s * env * gain;
    }
  }

  /* Bruit filtré. o : dur, gain, decay, a, env fn(t), type (lp|hp|bp), f, q, rnd */
  function noise(out, t0, o) {
    var n0 = Math.round(t0 * SR), len = Math.floor(o.dur * SR), rnd = o.rnd || defRnd;
    var low = 0, band = 0, fFn = typeof o.f === 'function', damp = 1 / (o.q || 0.8);
    var a = o.a || 0.001, gain = o.gain === undefined ? 0.5 : o.gain, i;
    for (i = 0; i < len; i++) {
      var idx = n0 + i;
      if (idx >= out.length) break;
      var t = i / SR, y = rnd() * 2 - 1;
      if (o.type) {
        var fc = Math.min(fFn ? o.f(t) : o.f, SR / 6.5);
        var F = 2 * Math.sin(Math.PI * fc / SR);
        low += F * band;
        var high = y - low - damp * band;
        band += F * high;
        y = o.type === 'lp' ? low : o.type === 'hp' ? high : band;
      }
      var env = t < a ? t / a : 1;
      if (o.decay) env *= Math.exp(-t / o.decay);
      if (o.env) env *= o.env(t);
      var rem = o.dur - t;
      if (rem < 0.005) env *= rem / 0.005;
      if (idx >= 0) out[idx] += y * env * gain;
    }
  }

  // ---------- Percussions ----------
  function kick(out, t, g, o) {
    o = o || {};
    var f0 = o.f || 48, sw = o.sweep || 110, st = o.st || 0.035;
    tone(out, t, { wave: 'sine', phase: 1, dur: o.dur || 0.28, a: 0.001, r: 0.05, decay: o.decay || 0.16, gain: g,
      f: function (x) { return f0 + sw * Math.exp(-x / st); } });
    noise(out, t, { dur: 0.012, gain: g * 0.3, type: 'lp', f: 3000 });
  }
  function snare(out, t, g, rnd) {
    noise(out, t, { dur: 0.22, decay: 0.055, gain: g * 0.9, type: 'bp', f: 2300, q: 0.7, rnd: rnd });
    noise(out, t, { dur: 0.12, decay: 0.03, gain: g * 0.4, type: 'hp', f: 5000, rnd: rnd });
    tone(out, t, { wave: 'tri', phase: 1, dur: 0.1, a: 0.001, decay: 0.04, gain: g * 0.5,
      f: function (x) { return 185 + 90 * Math.exp(-x / 0.02); } });
  }
  function clap(out, t, g, rnd) {
    for (var k = 0; k < 3; k++) noise(out, t + k * 0.011, { dur: 0.02, decay: 0.008, gain: g * 0.7, type: 'bp', f: 1300, q: 1.2, rnd: rnd });
    noise(out, t + 0.03, { dur: 0.2, decay: 0.05, gain: g * 0.7, type: 'bp', f: 1200, q: 1, rnd: rnd });
  }
  function crowdClap(out, t, g, rnd, n) {
    for (var k = 0; k < n; k++) {
      noise(out, t + rnd() * 0.028, { dur: 0.11, decay: 0.016 + rnd() * 0.012, type: 'bp', q: 1.3,
        gain: g * (0.5 + 0.5 * rnd()) * 1.7 / Math.sqrt(n), f: 900 + rnd() * 1500, rnd: rnd });
    }
  }
  function hat(out, t, g, rnd, open) {
    noise(out, t, { dur: open ? 0.25 : 0.05, decay: open ? 0.07 : 0.012, gain: g, type: 'hp', f: 6500, q: 0.9, rnd: rnd });
  }
  function crash(out, t, g, rnd) {
    noise(out, t, { dur: 1.7, decay: 0.42, gain: g, type: 'hp', f: 4200, q: 0.8, rnd: rnd });
    noise(out, t, { dur: 0.9, decay: 0.2, gain: g * 0.6, type: 'bp', f: 3000, q: 0.6, rnd: rnd });
  }
  function tom(out, t, g, f) {
    tone(out, t, { wave: 'sine', phase: 1, dur: 0.3, a: 0.001, decay: 0.12, gain: g,
      f: function (x) { return f * (1 + 0.6 * Math.exp(-x / 0.03)); } });
    noise(out, t, { dur: 0.02, gain: g * 0.25, type: 'lp', f: 2500 });
  }
  function surdo(out, t, g, open) {
    tone(out, t, { wave: 'sine', phase: 1, dur: open ? 0.42 : 0.09, a: 0.001, r: 0.03, decay: open ? 0.22 : 0.05, gain: g,
      f: function (x) { return 64 + 30 * Math.exp(-x / 0.03); } });
    noise(out, t, { dur: 0.015, gain: g * 0.2, type: 'lp', f: 1800 });
  }
  function bell(out, t, f, g) {
    tone(out, t, { wave: 'square', dur: 0.14, a: 0.001, decay: 0.06, gain: g, f: f, cut: 5000 });
    tone(out, t, { wave: 'sine', dur: 0.14, a: 0.001, decay: 0.05, gain: g * 0.5, f: f * 2.76 });
  }

  // ---------- Instruments mélodiques ----------
  function brass(bright) {
    return function (out, t, f, dur, g) {
      tone(out, t, { wave: 'saw', det: [1, 1.006, 0.994], f: f, dur: dur, a: 0.012, r: 0.05, gain: 0.42 * g,
        cut: function (x) { return 500 + bright * (1 - Math.exp(-x / 0.035)); },
        vib: dur > 0.4 ? { rate: 5.5, depth: 0.006, delay: 0.22 } : null });
      tone(out, t, { wave: 'square', f: f / 2, dur: dur, a: 0.012, r: 0.05, gain: 0.16 * g, cut: 900 });
    };
  }
  function carHorn(out, t, f, dur, g) {
    tone(out, t, { wave: 'square', det: [1, 1.005], f: f, dur: dur, a: 0.006, r: 0.03, gain: 0.3 * g,
      cut: function (x) { return 800 + 3600 * (1 - Math.exp(-x / 0.01)); } });
    tone(out, t, { wave: 'saw', f: f, dur: dur, a: 0.006, r: 0.03, gain: 0.2 * g, cut: 4500 });
  }
  function hornBlast(out, t0, dur, g) {
    [370, 466.2, 554.4].forEach(function (f0) {
      tone(out, t0, { wave: 'saw', det: [1, 1.004], dur: dur, a: 0.008, r: 0.07, gain: 0.3 * g,
        f: function (t) {
          var up = 1 - 0.07 * Math.exp(-t / 0.02);
          var down = t > dur - 0.02 ? 1 - 0.06 * Math.min(1, (t - (dur - 0.02)) / 0.09) : 1;
          return f0 * up * down;
        },
        cut: function (t) { return 900 + 3800 * (1 - Math.exp(-t / 0.015)); } });
    });
  }

  // Écrêtage doux, normalisation, micro-fondus aux extrémités.
  function master(out, o) {
    o = o || {};
    var drive = o.drive || 1, i, pk = 0, n = out.length;
    for (i = 0; i < n; i++) {
      var x = Math.tanh(out[i] * drive);
      out[i] = x;
      if (x < 0) x = -x;
      if (x > pk) pk = x;
    }
    var k = pk > 0 ? 0.92 / pk : 1;
    for (i = 0; i < n; i++) out[i] *= k;
    var fi = Math.floor(0.002 * SR), fo = Math.floor((o.loop ? 0.002 : 0.012) * SR);
    for (i = 0; i < fi && i < n; i++) out[i] *= i / fi;
    for (i = 0; i < fo && i < n; i++) out[n - 1 - i] *= i / fo;
    return out;
  }

  // Joue une liste [note, temps] ; renvoie le buffer prêt à masteriser.
  function tune(o) {
    var beat = 60 / o.bpm, total = 0, t = 0;
    o.notes.forEach(function (nn) { total += nn[1]; });
    var out = buf(total * beat + (o.tail || 0));
    o.notes.forEach(function (nn) {
      var d = nn[1] * beat;
      if (nn[0]) o.lead(out, t, N(nn[0]) * (o.transpose || 1), Math.max(0.04, d * (o.gate || 0.86)), nn[2] || 1);
      t += d;
    });
    if (o.drums) o.drums(out, beat, total);
    return master(out, { drive: o.drive || 1.5, loop: o.loop });
  }

  // ====================== PAGE 1 : AMBIANCE ======================

  function airhorn() {
    var out = buf(2.2);
    [[0, 0.15], [0.21, 0.15], [0.42, 0.15], [0.63, 1.35]].forEach(function (b) { hornBlast(out, b[0], b[1], 1); });
    return master(out, { drive: 1.6 });
  }

  function siren() {
    var T = 1.5, dur = 2 * T, out = buf(dur), n = Math.floor(dur * SR), sum = 0, i;
    var raw = function (t) { return 620 * Math.pow(2, 1.05 * (0.5 - 0.5 * Math.cos(TAU * t / T))); };
    for (i = 0; i < n; i++) sum += raw(i / SR) / SR;
    var k = Math.round(sum) / sum; // nombre entier de cycles : boucle sans clic
    var f = function (t) { return raw(t) * k; };
    tone(out, 0, { wave: 'saw', phase: 1, f: f, dur: dur, a: 0, r: 0.0001, gain: 0.5, cut: 3500 });
    tone(out, 0, { wave: 'square', phase: 1, f: f, dur: dur, a: 0, r: 0.0001, gain: 0.25, cut: 2500 });
    return master(out, { drive: 1.5, loop: true });
  }

  function whistle() {
    var dur = 1, out = buf(dur), i;
    [2900, 3080].forEach(function (f0) {
      tone(out, 0, { wave: 'sine', phase: 1, dur: dur, a: 0, r: 0.0001, gain: 0.4,
        f: function (t) { return f0 + 110 * Math.sin(TAU * 38 * t); } });
    });
    for (i = 0; i < out.length; i++) out[i] *= 0.62 + 0.38 * Math.sin(TAU * 38 * i / SR + 1.3);
    noise(out, 0, { dur: dur, gain: 0.1, type: 'bp', f: 3000, q: 2, rnd: rng(21) });
    return master(out, { loop: true });
  }

  function vuvuzela() {
    var dur = 1.5, out = buf(dur);
    [[349, 1, 3], [353, 0.7, 2], [346, 0.7, 4]].forEach(function (p, k) {
      var f0 = p[0] / dur;
      tone(out, 0, { wave: 'saw', phase: 1, dur: dur, a: 0, r: 0.0001, gain: 0.4 * p[1], cut: 1700,
        f: function (t) { return f0 * (1 + 0.004 * Math.sin(TAU * p[2] * t / dur + k)); } });
    });
    return master(out, { drive: 2.2, loop: true });
  }

  function clapStade() {
    var e = 0.24, out = buf(16 * e), r = rng(7);
    [0, 2, 4, 5, 6, 8, 9, 10, 11, 13, 14].forEach(function (p) {
      crowdClap(out, p * e, 1, r, 10);
      kick(out, p * e, 0.4, { f: 60, sweep: 60, decay: 0.08, dur: 0.15 });
    });
    return master(out, { drive: 1.3, loop: true });
  }

  function batucada() {
    var st = 60 / 132 / 4, out = buf(32 * st), r = rng(11), i;
    var agogo = { 0: 880, 2: 880, 4: 660, 5: 660, 7: 880, 9: 880, 11: 660, 12: 660, 14: 880 };
    for (i = 0; i < 32; i++) {
      var t = i * st, s = i % 16;
      var acc = s === 0 || s === 3 || s === 6 || s === 10 || s === 12 || s === 15;
      noise(out, t, { dur: 0.08, decay: 0.022, gain: acc ? 0.5 : 0.15, type: 'bp', f: 2600, q: 0.8, rnd: r });
      noise(out, t, { dur: 0.04, decay: 0.012, gain: s % 2 ? 0.1 : 0.06, type: 'hp', f: 6000, rnd: r });
      if (s === 4 || s === 12) surdo(out, t, 0.95, true);
      else if (s === 0 || s === 8) surdo(out, t, 0.5, false);
      if (i === 30) surdo(out, t, 0.6, false);
      if (agogo[s]) bell(out, t, agogo[s], 0.2);
    }
    return master(out, { drive: 1.4, loop: true });
  }

  function techno() {
    var beat = 60 / 140, out = buf(8 * beat), r = rng(5), b;
    for (b = 0; b < 8; b++) {
      var t = b * beat;
      kick(out, t, 1, { f: 46, sweep: 160, st: 0.03, decay: 0.2, dur: 0.34 });
      hat(out, t + beat / 2, 0.3, r, true);
      hat(out, t + beat / 4, 0.1, r, false);
      hat(out, t + 3 * beat / 4, 0.1, r, false);
      if (b % 2 === 1) clap(out, t, 0.55, r);
      tone(out, t + beat / 2, { wave: 'saw', f: b >= 6 ? 65.4 : 55, dur: beat * 0.4, a: 0.004, r: 0.03, gain: 0.4,
        cut: function (x) { return 180 + 900 * Math.exp(-x / 0.05); } });
    }
    return master(out, { drive: 1.8, loop: true });
  }

  function drop() {
    var R = 3.2, T = R + 0.12, out = buf(T + 2.6), r = rng(3), t = 0;
    noise(out, 0, { dur: R, gain: 0.5, type: 'bp', q: 2.5, rnd: r,
      f: function (x) { return 300 * Math.pow(20, x / R); },
      env: function (x) { return (x / R) * (x / R); } });
    tone(out, 0, { wave: 'saw', det: [1, 1.01], dur: R, a: 0.01, r: 0.01, gain: 0.3, cut: 4000,
      f: function (x) { return 110 * Math.pow(8, Math.pow(x / R, 1.5)); },
      env: function (x) { return 0.2 + 0.8 * x / R; } });
    while (t < R - 0.01) {
      var p = t / R;
      snare(out, t, 0.3 + 0.5 * p, r);
      t += p < 0.4 ? 0.214 : p < 0.7 ? 0.107 : 0.0535;
    }
    kick(out, T, 1.2, { f: 38, sweep: 170, st: 0.05, decay: 0.5, dur: 1.2 });
    tone(out, T, { wave: 'sine', phase: 1, dur: 2.2, a: 0.002, r: 0.2, decay: 0.9, gain: 0.9,
      f: function (x) { return 36 + 50 * Math.exp(-x / 0.25); } });
    crash(out, T, 0.5, r);
    hornBlast(out, T, 1.1, 0.8);
    return master(out, { drive: 1.6 });
  }

  // ====================== PAGE 2 : RÉFS (domaine public) ======================

  // Grosse caisse sur chaque temps, clap sur 2 et 4, charley en contretemps.
  function fourFloor(pickup, seed) {
    return function (out, beat, total) {
      var r = rng(seed), p;
      for (p = pickup % 1; p < total - 0.01; p += 1) {
        var inBar = ((Math.round(p - pickup) % 4) + 4) % 4;
        kick(out, p * beat, 0.9, { f: 46, sweep: 140, decay: 0.15 });
        if (inBar === 1 || inBar === 3) clap(out, p * beat, 0.5, r);
        if (p + 0.5 < total) hat(out, (p + 0.5) * beat, 0.22, r, false);
      }
    };
  }

  function bellaCiao() {
    return tune({ bpm: 150, lead: brass(3000), loop: true, drums: fourFloor(1.5, 31), notes: [
      ['E4', .5], ['A4', .5], ['B4', .5],
      ['C5', .5], ['A4', 2], ['E4', .5], ['A4', .5], ['B4', .5],
      ['C5', .5], ['A4', 2], ['E4', .5], ['A4', .5], ['B4', .5],
      ['C5', 1], ['B4', .5], ['A4', .5], ['C5', 1], ['B4', .5], ['A4', .5],
      ['E5', 1], ['E5', 1], ['E5', .5], ['E5', .5], ['D5', .5], ['E5', .5],
      ['F5', .5], ['F5', 2], ['F5', .5], ['E5', .5], ['D5', .5],
      ['F5', .5], ['E5', 2], ['E5', .5], ['D5', .5], ['C5', .5],
      ['B4', 2], ['E5', 2],
      ['C5', 2], ['B4', 2],
      ['A4', 2.5]
    ] });
  }

  function cancan() {
    return tune({ bpm: 160, lead: brass(3600), transpose: 2, loop: true, gate: 0.8, notes: [
      ['D4', 1], ['D4', 1], ['E4', .5], ['G4', .5], ['F#4', .5], ['E4', .5],
      ['A4', 1], ['A4', 1], ['A4', .5], ['B4', .5], ['F#4', .5], ['G4', .5],
      ['E4', 1], ['E4', 1], ['E4', .5], ['G4', .5], ['F#4', .5], ['E4', .5],
      ['D4', .5], ['D5', .5], ['C#5', .5], ['B4', .5], ['A4', .5], ['G4', .5], ['F#4', .5], ['E4', .5]
    ], drums: function (out, beat, total) {
      var r = rng(41), p;
      for (p = 0; p < total; p++) {
        kick(out, p * beat, 0.9, { f: 50, sweep: 120, decay: 0.12 });
        snare(out, (p + 0.5) * beat, 0.45, r);
      }
    } });
  }

  function toreador() {
    return tune({ bpm: 116, lead: brass(3200), loop: true, gate: 0.9, notes: [
      ['C5', 1], ['D5', .75], ['C5', .25], ['A4', 1], ['A4', 1],
      ['A4', .75], ['G4', .25], ['A4', .75], ['Bb4', .25], ['A4', 2],
      ['Bb4', 1], ['G4', .75], ['C5', .25], ['A4', 2],
      ['F4', 1], ['D4', .75], ['G4', .25], ['C4', 2]
    ], drums: function (out, beat, total) {
      var r = rng(43), p;
      for (p = 0; p < total; p++) {
        if (p % 2 === 0) kick(out, p * beat, 0.9, { f: 50, sweep: 110, decay: 0.16 });
        else snare(out, p * beat, 0.55, r);
        if (p % 4 === 3) { snare(out, (p + 0.5) * beat, 0.3, r); snare(out, (p + 0.75) * beat, 0.35, r); }
      }
    } });
  }

  function walkyries() {
    var cell = [
      ['B3', 1.5], ['F#3', .5], ['B3', 1], ['D4', 3], ['B3', 3],
      ['D4', 1.5], ['B3', .5], ['D4', 1], ['F#4', 3], ['D4', 3],
      ['F#4', 1.5], ['D4', .5], ['F#4', 1], ['A4', 3], ['A3', 3],
      ['D4', 1.5], ['A3', .5], ['D4', 1], ['F#4', 6]
    ];
    var up = cell.map(function (nn) {
      return [nn[0].replace(/\d/, function (d) { return String(+d + 1); }), nn[1]];
    });
    return tune({ bpm: 60 / 0.19, lead: brass(3800), gate: 0.92, tail: 0.3, drive: 1.6, notes: cell.concat(up),
      drums: function (out, beat) {
        var r = rng(47), c;
        for (c = 0; c < 8; c++) {
          var t = (c * 9 + 3) * beat;
          kick(out, t, 0.8, { f: 62, sweep: 40, decay: 0.3, dur: 0.5 });
          if (c % 4 !== 3) kick(out, t + 3 * beat, 0.5, { f: 62, sweep: 40, decay: 0.25, dur: 0.4 });
          if (c === 4) crash(out, t, 0.35, r);
        }
      } });
  }

  function cucaracha() {
    return tune({ bpm: 200, lead: carHorn, gate: 0.8, tail: 0.1, drive: 1.4, notes: [
      ['C5', .5], ['C5', .5], ['C5', .5], ['F5', 1.5], ['A5', 1],
      ['C5', .5], ['C5', .5], ['C5', .5], ['F5', 1.5], ['A5', 1.5],
      ['F5', .5], ['F5', .5], ['E5', .5], ['E5', .5], ['D5', .5], ['D5', .5], ['C5', 2]
    ] });
  }

  function marcheFunebre() {
    return tune({ bpm: 72, lead: brass(1500), gate: 0.93, tail: 0.4, drive: 1.4, notes: [
      ['Bb3', 2], ['Bb3', 1.5], ['Bb3', .5],
      ['Bb3', 2], ['Db4', 1.5], ['C4', .5],
      ['C4', 1.5], ['Bb3', .5], ['Bb3', 1.5], ['A3', .5],
      ['Bb3', 4]
    ], drums: function (out, beat, total) {
      for (var p = 0; p < total; p += 2) kick(out, p * beat, 0.9, { f: 44, sweep: 50, decay: 0.35, dur: 0.6 });
    } });
  }

  function badumtss() {
    var out = buf(1.9), r = rng(9);
    snare(out, 0.02, 0.8, r);
    kick(out, 0.02, 0.5);
    tom(out, 0.2, 0.9, 130);
    kick(out, 0.42, 1);
    crash(out, 0.42, 0.8, r);
    return master(out, { drive: 1.3 });
  }

  function tromboneTriste() {
    var out = buf(3.1), t = 0.02;
    [[349.2, 0.42], [329.6, 0.42], [311.1, 0.42], [293.7, 1.5]].forEach(function (nn, k) {
      var last = k === 3, d = nn[1];
      tone(out, t, { wave: 'saw', det: [1, 1.003], dur: d * (last ? 1 : 0.9), a: 0.03, r: 0.08, gain: 0.5,
        f: function (x) { return nn[0] * (last ? 1 - 0.07 * (x / d) * (x / d) : 1 - 0.012 * x / d); },
        vib: last ? { rate: 5, depth: 0.012, delay: 0.25 } : null,
        cut: function (x) { return 450 + 1900 * Math.exp(-x / (d * 0.55)); } });
      t += d + 0.04;
    });
    return master(out, { drive: 1.3 });
  }

  var RED = '#E53935', ORANGE = '#FB8C00', YELLOW = '#FDD835', GREEN = '#43A047', CYAN = '#00ACC1',
    BLUE = '#1E88E5', VIOLET = '#8E24AA', PINK = '#EC407A', GREY = '#546E7A';

  B.FACTORY_PAGES = [{ name: 'AMBIANCE', color: RED }, { name: 'RÉFS', color: BLUE }];
  B.FACTORY = [
    { name: 'AIR HORN', color: RED, mode: 'oneshot', make: airhorn },
    { name: 'SIRÈNE', color: ORANGE, mode: 'toggle', loop: true, make: siren },
    { name: 'SIFFLET', color: YELLOW, mode: 'gate', loop: true, make: whistle },
    { name: 'VUVUZELA', color: GREEN, mode: 'gate', loop: true, make: vuvuzela },
    { name: 'CLAP STADE', color: CYAN, mode: 'toggle', loop: true, make: clapStade },
    { name: 'BATUCADA', color: BLUE, mode: 'toggle', loop: true, make: batucada },
    { name: 'BOUM BOUM', color: VIOLET, mode: 'toggle', loop: true, make: techno },
    { name: 'MONTÉE + DROP', color: PINK, mode: 'oneshot', make: drop },

    { name: 'BELLA CIAO', color: RED, mode: 'toggle', loop: true, make: bellaCiao },
    { name: 'CANCAN', color: PINK, mode: 'toggle', loop: true, make: cancan },
    { name: 'TORÉADOR', color: ORANGE, mode: 'toggle', loop: true, make: toreador },
    { name: 'WALKYRIES', color: BLUE, mode: 'toggle', make: walkyries },
    { name: 'CUCARACHA', color: YELLOW, mode: 'oneshot', make: cucaracha },
    { name: 'MARCHE FUNÈBRE', color: GREY, mode: 'toggle', make: marcheFunebre },
    { name: 'BA DUM TSS', color: CYAN, mode: 'oneshot', make: badumtss },
    { name: 'TROMBONE TRISTE', color: VIOLET, mode: 'oneshot', make: tromboneTriste }
  ];
})(window.Boucan = window.Boucan || {});
