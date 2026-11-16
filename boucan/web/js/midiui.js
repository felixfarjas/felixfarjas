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
    var pend = null; // toucher en cours, pas encore décidé : note, allongement ou défilement de la page
    function begin(p) {
      var v = voice(), k = find(p.s, p.d);
      if (k >= 0) hit = { nt: v.n[k], was: true, s: p.s, moved: false };
      else {
        var nt = [p.s, p.d, 1];
        v.n.push(nt);
        hit = { nt: nt, was: false, s: p.s, moved: false };
      }
      U.buzz();
      changed(); draw();
    }
    // Colonne des noms : ligne touchée, ou -1.
    function labelAt(x, y) {
      var r = c.getBoundingClientRect(), row = Math.floor((y - r.top) / rowH());
      return x - r.left < LAB && row >= 0 && row < rows() ? dOf(row) : -1;
    }
    // Renvoie vrai si le toucher a joué une note (colonne des noms) : il ne doit alors rien faire d'autre.
    function down(x, y) {
      hit = null; pend = null;
      var d = labelAt(x, y);
      if (d >= 0) {
        // on joue la note tout de suite, et si le clip tourne elle s'inscrit dans la boucle sur le pas le plus proche
        var s = M.record(pad, getVi(), d);
        U.buzz();
        if (s >= 0) { changed(); draw(); }
        return true;
      }
      var p = cell(x, y);
      pend = p ? { x: x, y: y, p: p } : null;
      return false;
    }
    // renvoie vrai si le geste appartient à la grille (il ne doit alors plus faire défiler la page)
    function move(x, y) {
      if (pend) {
        var dx = Math.abs(x - pend.x), dy = Math.abs(y - pend.y);
        if (dy > 9 && dy >= dx) { pend = null; return false; } // défilement vertical : la page bouge, rien n'est posé
        if (dx < 9) return false;
        begin(pend.p);
        pend = null;
      }
      var p = hit && cell(x, y);
      if (!hit) return false;
      if (!p || drum() || p.s === hit.s) return true;
      // glisser vers la droite allonge la note
      hit.moved = true; hit.s = p.s;
      hit.nt[2] = Math.max(1, Math.min(pad.bars * pad.steps - hit.nt[0], p.s - hit.nt[0] + 1));
      changed(); draw();
      return true;
    }
    function up() {
      if (pend) { begin(pend.p); pend = null; } // simple toucher
      if (hit && hit.was && !hit.moved) {
        // simple toucher sur une note existante : on l'enlève
        var n = voice().n, k = n.indexOf(hit.nt);
        if (k >= 0) n.splice(k, 1);
        changed(); draw();
      }
      hit = null;
    }
    U.on(c, 'touchstart', function (ev) { if (down(ev.targetTouches[0].clientX, ev.targetTouches[0].clientY)) ev.preventDefault(); });
    U.on(c, 'touchmove', function (ev) { if (ev.targetTouches[0] && move(ev.targetTouches[0].clientX, ev.targetTouches[0].clientY)) ev.preventDefault(); });
    U.on(c, 'touchend', function (ev) { if (pend || hit) ev.preventDefault(); up(); });
    U.on(c, 'touchcancel', function () { pend = null; hit = null; });
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
    var pad = U.refGet(ref), vi = 0, bar = 0, raf = null, grid = null, tabs, panel, playB, playIco, playTxt, auto = false, lastOn = null, bodyEl;
    if (!pad) return;
    if (!(pad.live instanceof Array)) pad.live = [];
    function saved() { M.touch(pad); B.save(); }
    function playLbl() {
      var on = !!M.state(pad);
      if (on === lastOn) return;
      lastOn = on;
      playIco.innerHTML = on ? U.pauseSvg : U.playSvg;
      playTxt.textContent = t(on ? 'mdStop' : 'mdPlay');
      playB.className = 'btn mdPlay' + (on ? ' on' : '');
    }
    function liveHas(v, k) { return pad.live.some(function (l) { return l[0] === v && l[1] === k; }); }
    // Onglets des voix, avec sous chaque nom une croix pour la couper (muet).
    function voiceTabs(withAdd) {
      var box = U.h('div'), names = U.h('div', 'row tight'), mutes = U.h('div', 'row tight');
      pad.voices.forEach(function (x, k) {
        U.add(names, btn(instName(x.inst), (k === vi ? 'on' : '') + (x.mute ? ' muted' : ''), function () { vi = k; rebuild(); }));
        U.add(mutes, btn('✕', 'cross' + (x.mute ? ' on' : ''), function () { x.mute = !x.mute; B.save(); rebuild(); }));
      });
      if (withAdd && pad.voices.length < M.MAX_VOICES) {
        U.add(names, btn('+', 'more', function () {
          X.pickInst('', false, function (id) {
            pad.voices.push(M.newVoice(id));
            vi = pad.voices.length - 1;
            M.generate(pad, vi);
            saved(); rebuild();
          });
        }));
        U.add(mutes, U.h('div', 'more'));
      }
      mutes.style.marginTop = '4px';
      return U.add(box, names, mutes);
    }

    function rebuild() {
      var v, I, keep = bodyEl ? bodyEl.scrollTop : 0;
      if (vi >= pad.voices.length) vi = pad.voices.length - 1;
      if (bar >= pad.bars) bar = 0;
      v = pad.voices[vi]; I = M.INST[v.inst];
      tabs.innerHTML = ''; panel.innerHTML = '';
      U.add(tabs, voiceTabs(true));

      // 1. les notes
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

      // 2. l'instrument de la voix
      block(panel, t('mdInst'), btn(I.name + '  ▾', 'accent', function () {
        X.pickInst(v.inst, false, function (id) {
          var kind = M.INST[id].kind !== I.kind;
          v.inst = id;
          v.m = M.INST[id].def.slice();
          // on passe de la batterie à un synthé (ou l'inverse) : l'ancien motif n'a plus de sens
          if (kind) { M.generate(pad, vi); pad.live = pad.live.filter(function (l) { return l[0] !== vi; }); }
          saved(); rebuild();
        });
      }));

      // 3. réglages du son : on choisit la piste ici aussi, et on la coupe d'une croix
      var snd = block(panel, t('mdMacros'), voiceTabs(false));
      var vl = U.h('div', 'secLbl', t('volume'));
      vl.style.marginTop = '10px';
      U.add(snd, vl, U.rangeS(function () { return v.vol; }, function (x) { v.vol = Math.round(x * 20) / 20; B.save(); },
        function () { return Math.round(v.vol * 100) + ' %'; }));
      if (I.kind !== 'drum') {
        var ol = U.h('div', 'secLbl', t('mdOct'));
        ol.style.marginTop = '10px';
        U.add(snd, ol, U.choice([[-1, '−1'], [0, '0'], [1, '+1']], v.oct || 0, function (o) { v.oct = o; B.save(); }));
      }
      macros(snd, v.inst, v.m, function () { B.save(); });

      // 4. réglages au glissé : toutes les voix d'un coup, autant de réglages qu'on veut
      var liveSec = block(panel, t('mdLive'), U.h('div', 'note', t('mdLiveNote')));
      pad.voices.forEach(function (x, xi) {
        var XI = M.INST[x.inst], box = U.h('div', 'sw two'), opts = XI.macros.map(function (key, k) { return [k, t('mm.' + key)]; });
        if (XI.kind !== 'drum') opts.push([4, t('mdOct')]);
        opts.forEach(function (o) {
          var b = btn(o[1], liveHas(xi, o[0]) ? 'on' : '', function () {
            if (liveHas(xi, o[0])) pad.live = pad.live.filter(function (l) { return !(l[0] === xi && l[1] === o[0]); });
            else pad.live.push([xi, o[0]]);
            b.className = 'btn' + (liveHas(xi, o[0]) ? ' on' : '');
            B.save();
          });
          U.add(box, U.add(U.h('div'), b));
        });
        var nm = U.h('div', 'secLbl', XI.name);
        nm.style.marginTop = '12px';
        U.add(liveSec, nm, box);
      });

      if (pad.voices.length > 1) {
        block(panel, '', btn(t('mdDelVoice', I.name), 'danger', function () {
          pad.voices.splice(vi, 1);
          // les réglages au glissé suivent la renumérotation des voix
          pad.live = pad.live.filter(function (l) { return l[0] !== vi; }).map(function (l) { return [l[0] > vi ? l[0] - 1 : l[0], l[1]]; });
          vi = 0;
          saved(); rebuild();
        }));
      }
      if (bodyEl) bodyEl.scrollTop = keep;
    }

    U.sheet(t('mdClip'), function (body, sh) {
      bodyEl = body;
      playB = U.h('button', 'btn mdPlay'); playIco = U.h('span', 'mdIco'); playTxt = U.h('span');
      U.add(playB, playIco, playTxt);
      U.on(playB, 'click', function () { auto = false; M.toggle(pad, ref.pi); playLbl(); });
      // dupliquer et « jouer en plus des autres » : juste sous le bouton lire
      var dup = btn(t('mdDup'), '', function () {
        // copie dans la première case libre : d'abord sur cette page, puis sur les suivantes
        var order = [ref.pi], k, done = false;
        for (k = 0; k < B.cfg.pages.length; k++) if (k !== ref.pi) order.push(k);
        order.forEach(function (pi) {
          var pg = B.cfg.pages[pi], i;
          for (i = 0; i < B.SLOTS && !done; i++) {
            if (pg.pads[i] || B.cover(pg, i) >= 0) continue;
            var copy = JSON.parse(JSON.stringify(pad));
            copy.id = B.uid('p');
            pg.pads[i] = copy;
            done = true;
            U.toast(t('mdDupDone', pg.name || String(pi + 1)), 2500);
          }
        });
        if (!done) U.toast(t('mdNoRoom'), 3000);
        B.saveNow();
      });
      var lay = U.check(t('mdLayer'), !!pad.layer, function (on) { pad.layer = on; B.save(); });
      var two = U.add(U.h('div', 'row tight'), dup, lay);
      two.style.marginTop = '8px';
      U.sec(body, '', playB, two);

      // longueur et précision côte à côte, sur une seule ligne
      var len = U.choice([[1, '1'], [2, '2'], [4, '4']], pad.bars, function (b) { M.setBars(pad, b); B.save(); rebuild(); });
      var gr = U.choice([[8, '1/8'], [16, '1/16']], pad.steps, function (s) { M.setSteps(pad, s); B.save(); rebuild(); });
      len.className = gr.className = 'row tight';
      U.sec(body, '', U.add(U.h('div', 'row'), U.add(U.h('div'), U.h('div', 'secLbl', t('mdLen')), len), U.add(U.h('div'), U.h('div', 'secLbl', t('mdGrid')), gr)));

      tabs = U.h('div'); panel = U.h('div');
      U.sec(body, t('mdVoices'), tabs, panel);

      var dice = btn(t('mdGenAll'), '', function () {
        M.newProg(pad);
        pad.voices.forEach(function (x, k) { M.generate(pad, k); });
        saved(); grid.draw();
      });
      U.sec(body, t('mdGenAll'), dice, U.h('div', 'note', t('mdGenNote')));
      U.sec(body, t('mdLayerSec'), U.h('div', 'note', t('mdLayerNote')));
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
      // en ouvrant l'éditeur, le clip joue : on entend ce qu'on compose
      if (!M.state(pad)) { M.toggle(pad, ref.pi); auto = true; }
      // tête de lecture sur la grille
      (function tick() {
        var st = M.stepOf(pad), col = st - bar * pad.steps;
        if (grid) grid.head(st >= 0 && col >= 0 && col < pad.steps ? col : -1);
        playLbl();
        raf = window.requestAnimationFrame(tick);
      })();
    }, function () {
      if (raf) window.cancelAnimationFrame(raf);
      // lancé par l'éditeur : il s'arrête avec lui
      if (auto && M.state(pad) && U.refGet(ref) === pad) M.stop(pad);
      M.touch(pad);
      B.saveNow();
      U.renderAll();
    });
  };

  // ====================== Clavier ======================
  // Huit touches, toutes dans la gamme : aucune fausse note possible.
  // Par rangée : de la tonique à la tonique suivante (8 touches au plus). En
  // deux rangées, celle du haut joue l'octave au-dessus.
  var NKEYS = 16;
  function layout(pad) {
    var L = M.scale().length, per = Math.min(8, L + 1), rows = pad.rows === 2 ? 2 : 1;
    return { L: L, per: per, rows: rows };
  }
  X.keysDom = function () {
    U = B.ui;
    var d = { el: U.h('div', 'kbd'), keys: [], pad: null, cur: {}, y0: {}, m0: {}, lay: '' }, k;
    for (k = 0; k < NKEYS; k++) { d.keys.push(U.add(U.h('div', 'key'), U.h('span'))); U.add(d.el, d.keys[k]); }
    // touche sous le doigt : numéro de l'élément, ou -1
    function keyAt(x, y) {
      var r = d.el.getBoundingClientRect(), g = layout(d.pad);
      var col = Math.max(0, Math.min(g.per - 1, Math.floor((x - r.left) / r.width * g.per)));
      var row = Math.max(0, Math.min(g.rows - 1, Math.floor((y - r.top) / r.height * g.rows)));
      return row * g.per + col;
    }
    function lit() {
      var on = {}, id;
      for (id in d.cur) on[d.cur[id]] = 1;
      d.keys.forEach(function (e, i) { var c = e.base + (on[i] ? ' down' : ''); if (e.className !== c) e.className = c; });
    }
    // le doigt monte ou descend : les réglages cochés suivent (jauge à l'appui), et le filtre de la note tenue avec
    function bend(id, y) {
      var p = d.pad, live = p && p.live || [];
      if (d.y0[id] === undefined || !live.length) return;
      var dv = (d.y0[id] - y) / 110, I = M.INST[p.inst];
      if (Math.abs(dv) < 0.08 && !d.bent) return;
      d.bent = true;
      live.forEach(function (k2) { p.m[k2] = Math.round(Math.max(0, Math.min(1, d.m0[id][k2] + dv)) * 100) / 100; });
      M.keyBend(p);
      U.gauge(d.el.getBoundingClientRect(), '#FDD835', p.m[live[0]], Math.round(p.m[live[0]] * 100) + ' %',
        live.map(function (k2) { return t('mm.' + I.macros[k2]); }).join(' + '));
    }
    function start(id, x, y) {
      if (!d.pad || U.state.edit) return;
      var k2 = keyAt(x, y), first = d.cur[id] === undefined;
      if (first) { d.y0[id] = y; d.m0[id] = d.pad.m.slice(); }
      if (d.cur[id] === k2) return;
      d.cur[id] = k2;
      M.keyOn(d.pad, d.pad.id + ':' + id, d.keys[k2].n);
      lit();
    }
    function stop(id) {
      if (d.cur[id] === undefined) return;
      delete d.cur[id]; delete d.y0[id]; delete d.m0[id];
      if (d.pad) M.keyOff(d.pad.id + ':' + id);
      var left = false, q;
      for (q in d.cur) left = true;
      if (d.bent && !left) { d.bent = false; U.gaugeHide(); B.save(); }
      lit();
    }
    function each(ev, fn) { for (var i = 0; i < ev.changedTouches.length; i++) fn(ev.changedTouches[i]); }
    U.on(d.el, 'touchstart', function (ev) { if (!U.state.edit) ev.preventDefault(); each(ev, function (tc) { start(tc.identifier, tc.clientX, tc.clientY); }); });
    // glisser d'une touche à l'autre joue les notes au passage ; monter ou descendre règle le son
    U.on(d.el, 'touchmove', function (ev) {
      if (!U.state.edit) ev.preventDefault();
      each(ev, function (tc) {
        if (d.cur[tc.identifier] === undefined) return;
        bend(tc.identifier, tc.clientY);
        start(tc.identifier, tc.clientX, d.bent || layout(d.pad).rows === 1 ? d.y0[tc.identifier] : tc.clientY);
      });
    });
    var end = function (ev) { each(ev, function (tc) { stop(tc.identifier); }); };
    U.on(d.el, 'touchend', end);
    U.on(d.el, 'touchcancel', end);
    U.on(d.el, 'mousedown', function (ev) { start('m', ev.clientX, ev.clientY); });
    U.on(window, 'mouseup', function () { stop('m'); });
    return d;
  };
  X.keysPaint = function (d, pad) {
    d.pad = pad;
    if (!(pad.live instanceof Array)) pad.live = [0];
    var g = layout(pad), sig = g.per + 'x' + g.rows;
    d.keys.forEach(function (e, i) {
      var row = Math.floor(i / g.per), col = i % g.per, shown = i < g.per * g.rows;
      // deux rangées : celle du haut (première) joue l'octave au-dessus
      e.n = col + (g.rows === 2 && row === 0 ? g.L : 0);
      if (d.lay !== sig) {
        e.style.display = shown ? '' : 'none';
        e.style.left = (col * 100 / g.per) + '%'; e.style.width = (100 / g.per) + '%';
        e.style.top = (row * 100 / g.rows) + '%'; e.style.height = (100 / g.rows) + '%';
      }
      if (!shown) return;
      e.base = 'key' + (M.isRoot(e.n) ? ' root' : '');
      if (e.shown !== M.noteName(e.n)) { e.shown = M.noteName(e.n); e.firstChild.textContent = e.shown; }
      if (e.className.indexOf('down') < 0) e.className = e.base;
    });
    d.lay = sig;
  };
  X.newKeys = function () { return { inst: 'pluck', vol: 0.8, oct: 0, rows: 1, m: M.INST.pluck.def.slice(), live: [0] }; };

  X.editKeys = function (ref) {
    U = B.ui;
    var pad = U.refGet(ref);
    if (!pad) return;
    U.sheet(t('typeKeys'), function (body, sh) {
      var mac = U.h('div');
      var liveBox = U.h('div', 'sw two');
      if (!(pad.live instanceof Array)) pad.live = [0];
      function fill() {
        mac.innerHTML = ''; liveBox.innerHTML = '';
        macros(mac, pad.inst, pad.m, function () { B.save(); });
        M.INST[pad.inst].macros.forEach(function (key, k) {
          var b = btn(t('mm.' + key), pad.live.indexOf(k) >= 0 ? 'on' : '', function () {
            var at = pad.live.indexOf(k);
            if (at >= 0) pad.live.splice(at, 1); else pad.live.push(k);
            b.className = 'btn' + (pad.live.indexOf(k) >= 0 ? ' on' : '');
            B.save();
          });
          U.add(liveBox, U.add(U.h('div'), b));
        });
      }
      var instB = btn(instName(pad.inst) + '  ▾', 'accent', function () {
        X.pickInst(pad.inst, true, function (id) {
          pad.inst = id; pad.m = M.INST[id].def.slice();
          instB.textContent = instName(id) + '  ▾';
          fill(); B.save();
        });
      });
      U.sec(body, t('mdInst'), instB, U.h('div', 'note', t('keysNote')));
      U.sec(body, t('mdOct'), U.choice([[-1, '−1'], [0, '0'], [1, '+1']], pad.oct || 0, function (o) { pad.oct = o; B.save(); }));
      U.sec(body, t('keysRows'), U.choice([[1, t('keysRow1')], [2, t('keysRow2')]], pad.rows === 2 ? 2 : 1, function (r) { pad.rows = r; B.save(); U.renderAll(); }),
        U.h('div', 'note', t('keysRowsNote')));
      U.sec(body, t('volume'), U.rangeS(function () { return pad.vol; }, function (x) { pad.vol = Math.round(x * 20) / 20; B.save(); },
        function () { return Math.round(pad.vol * 100) + ' %'; }));
      U.sec(body, t('mdMacros'), mac);
      U.sec(body, t('keysLive'), liveBox, U.h('div', 'note', t('keysLiveNote')));
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
