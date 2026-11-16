/*
 * Boucan — interface des clips MIDI : éditeur (séquenceur de batterie ou
 * grille mélodique dans la gamme), réglages communs (tempo, gamme) et clavier.
 * S'appuie sur la boîte à outils de l'interface (B.ui).
 * ES5 uniquement : doit tourner sur de vieilles WebView Android.
 */
(function (B) {
  'use strict';

  var M = B.midi, X = B.midiUI = {}, U;
  function t(k, a) { return B.t(k, a); }
  function btn(label, cls, fn) {
    var b = U.h('button', 'btn' + (cls ? ' ' + cls : ''), label);
    U.on(b, 'click', fn);
    return b;
  }
  function block(parent, label) {
    var s = U.h('div', 'sec'), i;
    if (label) U.add(s, U.h('div', 'secLbl', label));
    for (i = 2; i < arguments.length; i++) U.add(s, arguments[i]);
    U.add(parent, s);
    return s;
  }
  function instName(id) { return M.INST[id] ? M.INST[id].name : '?'; }

  // ====================== Réglages communs ======================
  // Tempo, tonalité, gamme et swing valent pour tous les clips et le clavier.
  X.openSettings = function (done) {
    U = B.ui;
    var c = B.cfg.midi;
    U.sheet(t('mdSet'), function (body) {
      var bpm = U.rangeS(function () { return (c.bpm - 60) / 140; }, function (v) { c.bpm = Math.round(60 + v * 140); B.save(); },
        function () { return c.bpm + ' BPM'; });
      function nudge(d) { return btn(d > 0 ? '+' : '−', 'nudge', function () { c.bpm = Math.max(60, Math.min(200, c.bpm + d)); bpm.paint(); B.save(); }); }
      var row = U.add(U.h('div', 'row'), nudge(-1), nudge(1));
      row.style.marginTop = '8px';
      U.sec(body, t('mdBpm'), bpm, row);

      var kbox = U.h('div', 'kgrid'), kb = [];
      M.KEYS.forEach(function (name, k) {
        var b = btn(name, k === c.root ? 'on' : '', function () {
          c.root = k;
          kb.forEach(function (x) { x.className = 'btn'; });
          b.className = 'btn on';
          B.save();
        });
        kb.push(b);
        U.add(kbox, U.add(U.h('div'), b));
      });
      U.sec(body, t('mdKey'), kbox);

      var sbox = U.h('div', 'sw two'), sb = [];
      M.SCALE_IDS.forEach(function (id) {
        var b = btn(t('sc.' + id), id === c.scale ? 'on' : '', function () {
          c.scale = id;
          sb.forEach(function (x) { x.className = 'btn'; });
          b.className = 'btn on';
          B.save();
          U.renderAll();
        });
        sb.push(b);
        U.add(sbox, U.add(U.h('div'), b));
      });
      U.sec(body, t('mdScale'), sbox, U.h('div', 'note', t('mdScaleNote')));

      U.sec(body, t('mdSwing'), U.rangeS(function () { return c.swing / 0.6; }, function (v) { c.swing = Math.round(v * 12) / 20; B.save(); },
        function () { return Math.round(c.swing / 0.6 * 100) + ' %'; }));
    }, function () { B.save(); if (done) done(); });
  };

  // Choix d'un instrument. synthOnly : pas de batterie (clavier).
  X.pickInst = function (cur, synthOnly, cb) {
    U = B.ui;
    U.sheet(t('mdInst'), function (body, sh) {
      M.GROUPS.forEach(function (g) {
        if (synthOnly && g === 'drum') return;
        var box = U.h('div', 'sw two');
        Object.keys(M.INST).forEach(function (id) {
          if (M.INST[id].group !== g) return;
          U.add(box, U.add(U.h('div'), btn(M.INST[id].name, id === cur ? 'on' : '', function () { sh.close(); cb(id); })));
        });
        U.sec(body, t('mg.' + g), box);
      });
    });
  };

  // ====================== Grille du séquenceur ======================
  // Batterie : une ligne par élément. Synthé : une ligne par note de la gamme
  // (les aiguës en haut). On touche pour poser, on glisse à droite pour allonger.
  function gridUI(pad, getVi, getBar, changed) {
    var c = U.h('canvas', 'seq'), dpr = window.devicePixelRatio || 1, LAB = 46, hit = null, playCol = -1;
    function voice() { return pad.voices[getVi()]; }
    function drum() { return M.INST[voice().inst].kind === 'drum'; }
    function rows() { return drum() ? M.LANES.length : M.rows(); }
    function rowH() { return drum() ? 36 : 25; }
    function dOf(r) { return drum() ? r : rows() - 1 - r; }
    function draw() {
      var R = rows(), rh = rowH(), cw0 = c.clientWidth;
      c.style.height = (R * rh) + 'px';
      var W = c.width = Math.max(50, Math.floor(cw0 * dpr)), H = c.height = Math.floor(R * rh * dpr);
      var g = c.getContext('2d'), S = pad.steps, lab = LAB * dpr, cw = (W - lab) / S, ch = rh * dpr, r, s, base = getBar() * S, d;
      g.fillStyle = '#0c0c0c'; g.fillRect(0, 0, W, H);
      g.font = 'bold ' + Math.round(11 * dpr) + 'px sans-serif';
      g.textBaseline = 'middle';
      for (r = 0; r < R; r++) {
        d = dOf(r);
        var isRoot = !drum() && M.isRoot(d);
        g.fillStyle = isRoot ? '#3a3a3a' : r % 2 ? '#181818' : '#202020';
        g.fillRect(0, r * ch, W, ch - dpr);
        g.fillStyle = isRoot ? '#fff' : '#999';
        g.fillText(drum() ? M.LANES[d] : M.noteName(d), 5 * dpr, r * ch + ch / 2);
      }
      for (s = 0; s <= S; s++) {
        g.fillStyle = s % (S / 4) === 0 ? '#666' : '#2c2c2c';
        g.fillRect(lab + s * cw - (s % (S / 4) === 0 ? dpr : dpr / 2), 0, s % (S / 4) === 0 ? 2 * dpr : dpr, H);
      }
      if (playCol >= 0) { g.fillStyle = 'rgba(255,255,255,.13)'; g.fillRect(lab + playCol * cw, 0, cw, H); }
      g.fillStyle = pad.color;
      voice().n.forEach(function (nt) {
        var col = nt[0] - base, row = drum() ? nt[1] : R - 1 - nt[1];
        if (row < 0 || row >= R || col + nt[2] <= 0 || col >= S) return;
        var x0 = Math.max(0, col), x1 = Math.min(S, col + nt[2]);
        g.fillRect(lab + x0 * cw + 2 * dpr, row * ch + 2 * dpr, (x1 - x0) * cw - 4 * dpr, ch - 5 * dpr);
      });
    }
    function cell(x, y) {
      var r = c.getBoundingClientRect(), S = pad.steps, cw = (r.width - LAB) / S;
      var col = Math.floor((x - r.left - LAB) / cw), row = Math.floor((y - r.top) / rowH());
      if (col < 0 || col >= S || row < 0 || row >= rows()) return null;
      return { s: getBar() * S + col, d: dOf(row) };
    }
    function find(s, d) {
      var n = voice().n, k;
      for (k = 0; k < n.length; k++) if (n[k][1] === d && n[k][0] <= s && s < n[k][0] + n[k][2]) return k;
      return -1;
    }
    function down(x, y) {
      var p = cell(x, y), v = voice();
      hit = null;
      if (!p) return;
      var k = find(p.s, p.d);
      if (k >= 0) hit = { nt: v.n[k], was: true, s: p.s, moved: false };
      else {
        var nt = [p.s, p.d, 1];
        v.n.push(nt);
        hit = { nt: nt, was: false, s: p.s, moved: false };
        M.preview(pad, getVi(), p.d);
      }
      U.buzz();
      changed(); draw();
    }
    function move(x, y) {
      var p = hit && cell(x, y);
      if (!p || drum() || p.s === hit.s) return;
      // glisser vers la droite allonge la note
      hit.moved = true; hit.s = p.s;
      hit.nt[2] = Math.max(1, Math.min(pad.bars * pad.steps - hit.nt[0], p.s - hit.nt[0] + 1));
      changed(); draw();
    }
    function up() {
      if (hit && hit.was && !hit.moved) {
        // simple toucher sur une note existante : on l'enlève
        var n = voice().n, k = n.indexOf(hit.nt);
        if (k >= 0) n.splice(k, 1);
        changed(); draw();
      }
      hit = null;
    }
    U.on(c, 'touchstart', function (ev) { ev.preventDefault(); down(ev.targetTouches[0].clientX, ev.targetTouches[0].clientY); });
    U.on(c, 'touchmove', function (ev) { ev.preventDefault(); if (ev.targetTouches[0]) move(ev.targetTouches[0].clientX, ev.targetTouches[0].clientY); });
    U.on(c, 'touchend', up);
    U.on(c, 'touchcancel', up);
    U.on(c, 'mousedown', function (ev) { down(ev.clientX, ev.clientY); up(); });
    return {
      el: c, draw: draw,
      // colonne en cours de lecture (ou -1)
      head: function (col) { if (col !== playCol) { playCol = col; draw(); } }
    };
  }

  // Curseurs des 4 macros d'un instrument.
  function macros(parent, inst, m, changed) {
    M.INST[inst].macros.forEach(function (key, k) {
      var lbl = U.h('div', 'secLbl', t('mm.' + key));
      lbl.style.marginTop = '10px';
      U.add(parent, lbl, U.rangeS(function () { return m[k]; }, function (v) { m[k] = Math.round(v * 100) / 100; changed(); },
        function () { return Math.round(m[k] * 100) + ' %'; }));
    });
  }

  // ====================== Éditeur d'un clip ======================
  X.edit = function (ref) {
    U = B.ui;
    var pad = U.refGet(ref), vi = 0, bar = 0, raf = null, grid = null, tabs, panel, playB;
    if (!pad) return;
    function saved() { M.touch(pad); B.save(); }
    function playLbl() { playB.textContent = t(M.state(pad) ? 'mdStop' : 'mdPlay'); }

    function rebuild() {
      var v, I;
      if (vi >= pad.voices.length) vi = pad.voices.length - 1;
      if (bar >= pad.bars) bar = 0;
      v = pad.voices[vi]; I = M.INST[v.inst];
      tabs.innerHTML = ''; panel.innerHTML = '';
      pad.voices.forEach(function (x, k) {
        U.add(tabs, btn(instName(x.inst), k === vi ? 'on' : '', function () { vi = k; rebuild(); }));
      });
      if (pad.voices.length < M.MAX_VOICES) {
        U.add(tabs, btn('+', 'more', function () {
          X.pickInst('', false, function (id) {
            pad.voices.push(M.newVoice(id));
            vi = pad.voices.length - 1;
            M.generate(pad, vi);
            saved(); rebuild();
          });
        }));
      }
      var instB = btn(I.name + '  ▾', 'accent', function () {
        X.pickInst(v.inst, false, function (id) {
          var kind = M.INST[id].kind !== I.kind;
          v.inst = id;
          v.m = M.INST[id].def.slice();
          // on passe de la batterie à un synthé (ou l'inverse) : l'ancien motif n'a plus de sens
          if (kind) M.generate(pad, vi);
          saved(); rebuild();
        });
      });
      block(panel, t('mdInst'), instB);
      var seqBox = block(panel, t(I.kind === 'drum' ? 'mdDrums' : 'mdNotes'));
      if (pad.bars > 1) {
        var bars = [], k;
        for (k = 0; k < pad.bars; k++) bars.push([k, t('mdBar') + ' ' + (k + 1)]);
        var br = U.choice(bars, bar, function (b) { bar = b; grid.draw(); });
        br.className = 'row tight';
        br.style.marginBottom = '6px';
        U.add(seqBox, br);
      }
      grid = gridUI(pad, function () { return vi; }, function () { return bar; }, saved);
      var acts = U.add(U.h('div', 'row'), btn(t('mdGen'), '', function () { M.generate(pad, vi); saved(); grid.draw(); }),
        btn(t('mdClear'), '', function () { v.n = []; saved(); grid.draw(); }));
      acts.style.marginTop = '8px';
      U.add(seqBox, grid.el, acts, U.h('div', 'note', t(I.kind === 'drum' ? 'mdDrumsNote' : 'mdNotesNote')));
      setTimeout(grid.draw, 0);

      var mix = block(panel, t('volume'), U.rangeS(function () { return v.vol; }, function (x) { v.vol = Math.round(x * 20) / 20; B.save(); },
        function () { return Math.round(v.vol * 100) + ' %'; }));
      U.add(mix, U.check(t('mdMute'), !!v.mute, function (on) { v.mute = on; B.save(); }));
      mix.lastChild.style.marginTop = '8px';
      if (I.kind !== 'drum') {
        block(panel, t('mdOct'), U.choice([[-1, '−1'], [0, '0'], [1, '+1']], v.oct || 0, function (o) { v.oct = o; B.save(); }));
      }
      var mac = block(panel, t('mdMacros'));
      macros(mac, v.inst, v.m, function () { B.save(); });
      // quel réglage suit le doigt quand on glisse sur la case
      var opts = I.macros.map(function (key, k) { return [k, t('mm.' + key)]; });
      var live = U.choice(opts, pad.lv === vi ? pad.lk : -1, function (k) { pad.lv = vi; pad.lk = k; B.save(); });
      live.className = 'row tight';
      block(panel, t('mdLive'), live, U.h('div', 'note', t('mdLiveNote')));
      if (pad.voices.length > 1) {
        block(panel, '', btn(t('mdDelVoice'), 'danger', function () {
          pad.voices.splice(vi, 1);
          if (pad.lv >= pad.voices.length) { pad.lv = 0; pad.lk = 0; }
          vi = 0;
          saved(); rebuild();
        }));
      }
    }

    U.sheet(t('mdClip'), function (body, sh) {
      playB = btn('', 'accent', function () { M.toggle(pad, ref.pi); playLbl(); });
      var dice = btn(t('mdGenAll'), '', function () {
        M.newProg(pad);
        pad.voices.forEach(function (x, k) { M.generate(pad, k); });
        saved(); grid.draw();
      });
      playLbl();
      U.sec(body, '', U.add(U.h('div', 'row'), playB, dice), U.h('div', 'note', t('mdGenNote')));

      tabs = U.h('div', 'row tight'); panel = U.h('div');
      U.sec(body, t('mdVoices'), tabs, panel);

      var len = U.choice([[1, '1'], [2, '2'], [4, '4']], pad.bars, function (b) { M.setBars(pad, b); B.save(); rebuild(); });
      U.sec(body, t('mdLen'), len);
      U.sec(body, t('mdGrid'), U.choice([[8, '1/8'], [16, '1/16']], pad.steps, function (s) { M.setSteps(pad, s); B.save(); rebuild(); }),
        U.h('div', 'note', t('mdGridNote')));
      var setB = btn('', '', function () { X.openSettings(function () { setLbl(); rebuild(); }); });
      var setLbl = function () { setB.textContent = B.cfg.midi.bpm + ' BPM  ·  ' + M.KEYS[B.cfg.midi.root] + ' ' + t('sc.' + B.cfg.midi.scale); };
      setLbl();
      U.sec(body, t('mdSet'), setB, U.h('div', 'note', t('mdSetNote')));

      U.sec(body, t('name'), U.field(pad.name, 24, function (v) { pad.name = v; B.save(); }));
      U.sec(body, t('color'), U.swatches(pad.color, function (c) { pad.color = c; B.save(); if (grid) grid.draw(); }));
      var move = btn(t('move'), '', function () { sh.close(); U.state.moving = { ref: ref, pad: pad }; U.renderAll(); });
      var clear = btn(t('clear'), 'gap danger', function () {
        U.ask(t('askClear', pad.name || 'MIDI'), t('doClear'), function () { M.stop(pad); U.refSet(ref, null); sh.close(); });
      });
      U.sec(body, t('padSec'), move, clear);

      rebuild();
      // tête de lecture sur la grille
      (function tick() {
        var st = M.stepOf(pad), col = st - bar * pad.steps;
        if (grid) grid.head(st >= 0 && col >= 0 && col < pad.steps ? col : -1);
        if (playB) playLbl();
        raf = window.requestAnimationFrame(tick);
      })();
    }, function () {
      if (raf) window.cancelAnimationFrame(raf);
      M.touch(pad);
      B.saveNow();
      U.renderAll();
    });
  };

  // ====================== Clavier ======================
  // Huit touches, toutes dans la gamme : aucune fausse note possible.
  var NKEYS = 8;
  X.keysDom = function () {
    U = B.ui;
    var d = { el: U.h('div', 'kbd'), keys: [], pad: null, cur: {} }, k;
    for (k = 0; k < NKEYS; k++) { d.keys.push(U.h('div', 'key')); U.add(d.el, d.keys[k]); }
    function keyAt(x) {
      var r = d.el.getBoundingClientRect();
      return Math.max(0, Math.min(NKEYS - 1, Math.floor((x - r.left) / r.width * NKEYS)));
    }
    function lit() {
      var on = {}, id;
      for (id in d.cur) on[d.cur[id]] = 1;
      d.keys.forEach(function (e, i) { var c = e.base + (on[i] ? ' down' : ''); if (e.className !== c) e.className = c; });
    }
    function start(id, x) {
      if (!d.pad || U.state.edit) return;
      var k2 = keyAt(x);
      if (d.cur[id] === k2) return;
      d.cur[id] = k2;
      M.keyOn(d.pad, d.pad.id + ':' + id, k2);
      lit();
    }
    function stop(id) {
      if (d.cur[id] === undefined) return;
      delete d.cur[id];
      if (d.pad) M.keyOff(d.pad.id + ':' + id);
      lit();
    }
    function each(ev, fn) { for (var i = 0; i < ev.changedTouches.length; i++) fn(ev.changedTouches[i]); }
    U.on(d.el, 'touchstart', function (ev) { if (!U.state.edit) ev.preventDefault(); each(ev, function (tc) { start(tc.identifier, tc.clientX); }); });
    // glisser d'une touche à l'autre joue les notes au passage
    U.on(d.el, 'touchmove', function (ev) { if (!U.state.edit) ev.preventDefault(); each(ev, function (tc) { if (d.cur[tc.identifier] !== undefined) start(tc.identifier, tc.clientX); }); });
    var end = function (ev) { each(ev, function (tc) { stop(tc.identifier); }); };
    U.on(d.el, 'touchend', end);
    U.on(d.el, 'touchcancel', end);
    U.on(d.el, 'mousedown', function (ev) { start('m', ev.clientX); });
    U.on(window, 'mouseup', function () { stop('m'); });
    return d;
  };
  X.keysPaint = function (d, pad) {
    d.pad = pad;
    d.keys.forEach(function (e, k) {
      e.base = 'key' + (M.isRoot(k) ? ' root' : '');
      if (e.shown !== M.noteName(k)) { e.shown = M.noteName(k); e.textContent = e.shown; }
      if (e.className.indexOf('down') < 0) e.className = e.base;
    });
  };
  X.newKeys = function () { return { inst: 'pluck', vol: 0.8, oct: 0, m: M.INST.pluck.def.slice() }; };

  X.editKeys = function (ref) {
    U = B.ui;
    var pad = U.refGet(ref);
    if (!pad) return;
    U.sheet(t('typeKeys'), function (body, sh) {
      var mac = U.h('div');
      function fill() { mac.innerHTML = ''; macros(mac, pad.inst, pad.m, function () { B.save(); }); }
      var instB = btn(instName(pad.inst) + '  ▾', 'accent', function () {
        X.pickInst(pad.inst, true, function (id) {
          pad.inst = id; pad.m = M.INST[id].def.slice();
          instB.textContent = instName(id) + '  ▾';
          fill(); B.save();
        });
      });
      U.sec(body, t('mdInst'), instB, U.h('div', 'note', t('keysNote')));
      U.sec(body, t('mdOct'), U.choice([[-1, '−1'], [0, '0'], [1, '+1']], pad.oct || 0, function (o) { pad.oct = o; B.save(); }));
      U.sec(body, t('volume'), U.rangeS(function () { return pad.vol; }, function (x) { pad.vol = Math.round(x * 20) / 20; B.save(); },
        function () { return Math.round(pad.vol * 100) + ' %'; }));
      U.sec(body, t('mdMacros'), mac);
      fill();
      var setB = btn(M.KEYS[B.cfg.midi.root] + ' ' + t('sc.' + B.cfg.midi.scale), '', function () { X.openSettings(function () { sh.close(); X.editKeys(ref); }); });
      U.sec(body, t('mdSet'), setB, U.h('div', 'note', t('mdSetNote')));
      U.sec(body, t('color'), U.swatches(pad.color, function (c) { pad.color = c; B.save(); U.renderAll(); }));
      U.sec(body, t('padSec'), btn(t('clear'), 'danger', function () {
        U.ask(t('askClear', t('typeKeys')), t('doClear'), function () { U.refSet(ref, null); sh.close(); });
      }));
    }, function () { B.saveNow(); U.renderAll(); });
  };
})(window.Boucan);
