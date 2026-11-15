/*
 * Boucan — interface.
 * Tout ce qui se joue (cases, STOP, effet, pages) réagit dès le toucher
 * (touchstart). Tout ce qui édite passe par un vrai "click".
 * ES5 uniquement : doit tourner sur de vieilles WebView Android.
 */
(function (B) {
  'use strict';

  var A = B.audio;
  var S = { edit: false, moving: null, sheets: [], ask: null };
  var MODES = [['oneshot', 'ONE SHOT'], ['toggle', 'ON / OFF'], ['gate', 'PIANO']];
  var MODE_TAG = { oneshot: 'ONE SHOT', toggle: 'ON / OFF', gate: 'PIANO' };
  var MODE_HINT = {
    oneshot: 'Un appui joue le son en entier. Un nouvel appui le relance du début.',
    toggle: 'Un appui lance le son, un autre appui l\'arrête.',
    gate: 'Le son joue tant que le doigt reste appuyé.'
  };
  var NATIVE = !!window.BoucanNative;
  var pads = [], el = {};
  var held = {}; // identifiant du doigt -> case tenue

  function $(id) { return document.getElementById(id); }
  function h(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;
    return e;
  }
  function on(e, ev, fn) { e.addEventListener(ev, fn, false); }
  function add(parent) {
    for (var i = 1; i < arguments.length; i++) parent.appendChild(arguments[i]);
    return parent;
  }
  // Réaction immédiate au toucher (pas d'attente du "click").
  function press(e, fn) {
    on(e, 'touchstart', function (ev) { ev.preventDefault(); fn(ev); });
    on(e, 'mousedown', function (ev) { fn(ev); });
  }
  function ink(hex) {
    var r = parseInt(hex.substr(1, 2), 16), g = parseInt(hex.substr(3, 2), 16), b = parseInt(hex.substr(5, 2), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#000000' : '#ffffff';
  }
  function shade(hex, k) {
    var r = parseInt(hex.substr(1, 2), 16), g = parseInt(hex.substr(3, 2), 16), b = parseInt(hex.substr(5, 2), 16);
    return 'rgb(' + Math.round(r * k) + ',' + Math.round(g * k) + ',' + Math.round(b * k) + ')';
  }
  function page() { return B.cfg.pages[B.cfg.cur]; }
  function buzz() {
    if (B.cfg && B.cfg.vibrate && navigator.vibrate) { try { navigator.vibrate(12); } catch (e) {} }
  }

  // ====================== Messages ======================
  var toastT = null;
  function toast(msg, ms) {
    el.toast.textContent = msg;
    el.toast.style.display = 'block';
    if (toastT) clearTimeout(toastT);
    toastT = setTimeout(function () { el.toast.style.display = 'none'; }, ms || 2200);
  }
  function busy(msg) { el.busyTxt.textContent = msg; el.busy.style.display = 'flex'; }
  function idle() { el.busy.style.display = 'none'; }
  function ask(msg, yes, cb) {
    var wrap = h('div', 'ask'), box = h('div', 'askBox'), row = h('div', 'row');
    var no = h('button', 'btn', 'ANNULER'), ok = h('button', 'btn danger', yes);
    function close() { if (S.ask === close) S.ask = null; if (wrap.parentNode) document.body.removeChild(wrap); }
    on(no, 'click', close);
    on(ok, 'click', function () { close(); cb(); });
    add(document.body, add(wrap, add(box, h('div', 'askTxt', msg), add(row, no, ok))));
    S.ask = close;
  }
  B.onError = function (msg) { toast(msg, 3500); };

  // ====================== Rendu ======================
  function buildGrid() {
    for (var i = 0; i < B.SLOTS; i++) {
      var p = { el: h('div', 'pad'), inn: h('div', 'padIn'), prog: h('div', 'prog'), name: h('div', 'name'), tag: h('div', 'tag') };
      p.el.style.left = (i % 2 * 50) + '%';
      p.el.style.top = (Math.floor(i / 2) * 25) + '%';
      p.el.setAttribute('data-i', i);
      add(el.grid, add(p.el, add(p.inn, p.prog, p.name, p.tag)));
      pads.push(p);
    }
  }

  function setProg(p, v) {
    var st = p.prog.style;
    st.webkitAnimation = 'none'; st.animation = 'none';
    if (!v) return;
    void p.prog.offsetWidth; // relance l'animation
    var gone = Math.max(0, A.ctx.currentTime - v.t0), d = Math.max(0.02, v.dur);
    var s = 'prog ' + d.toFixed(3) + 's linear ' + (-(v.loop ? gone % d : Math.min(gone, d))).toFixed(3) + 's ' +
      (v.loop ? 'infinite' : '1') + ' both';
    st.webkitAnimation = s; st.animation = s;
  }

  function isHeld(i) {
    for (var k in held) if (held[k].i === i && held[k].pg === B.cfg.cur) return true;
    return false;
  }

  function renderPad(i) {
    var p = pads[i], pad = page().pads[i], cls = 'padIn';
    if (!pad) {
      p.inn.className = cls + ' empty';
      p.inn.style.background = ''; p.inn.style.color = ''; p.inn.style.boxShadow = '';
      p.name.className = 'name';
      p.name.textContent = S.edit ? '+' : '';
      p.tag.textContent = '';
      setProg(p, null);
      return;
    }
    var v = A.voices[pad.id], fg = ink(pad.color), nm = pad.name || '', longest = 0;
    nm.split(/\s+/).forEach(function (w) { if (w.length > longest) longest = w.length; });
    if (!A.buffers[pad.sample]) cls += ' loading';
    if (isHeld(i)) cls += ' down';
    if (S.moving && S.moving.pad === pad) cls += ' src';
    p.inn.className = cls;
    p.inn.style.background = pad.color;
    p.inn.style.color = fg;
    p.inn.style.boxShadow = v ? 'inset 0 0 0 6px ' + fg : '';
    p.name.className = 'name' + (longest > 11 || nm.length > 22 ? ' s3' : longest > 8 || nm.length > 14 ? ' s2' : '');
    p.name.textContent = nm;
    p.tag.textContent = MODE_TAG[pad.mode] + (pad.loop ? ' · BOUCLE' : '');
    setProg(p, v);
  }

  function renderGrid() {
    el.grid.style.background = shade(page().color, 0.3);
    for (var i = 0; i < B.SLOTS; i++) renderPad(i);
  }

  function renderTabs() {
    var live = {}, n = B.cfg.pages.length;
    B.eachPad(function (p, pi) { if (A.voices[p.id]) live[pi] = 1; });
    el.tabs.innerHTML = '';
    B.cfg.pages.forEach(function (pg, k) {
      var t = h('div', 'tab' + (k === B.cfg.cur ? ' cur' : '') + (live[k] ? ' live' : ''));
      var inn = h('div', 'tabIn', pg.name || String(k + 1));
      t.setAttribute('data-k', k);
      if (k === B.cfg.cur) { inn.style.background = pg.color; inn.style.color = ink(pg.color); }
      else inn.style.borderTopColor = pg.color;
      add(el.tabs, add(t, inn));
    });
    if (S.edit && n < B.MAX_PAGES) {
      var a = h('div', 'tab add');
      a.setAttribute('data-k', 'add');
      add(el.tabs, add(a, h('div', 'tabIn', '+')));
    }
  }

  function fxName() {
    var t = B.cfg.fx.type, out = 'REVERB';
    B.FX.forEach(function (f) { if (f[0] === t) out = f[1]; });
    return out;
  }
  function renderFx() {
    el.fxLbl.textContent = fxName();
    el.fxFill.style.width = (B.cfg.fx.amt * 100) + '%';
    el.fxFill.style.borderRightWidth = B.cfg.fx.amt > 0 ? '5px' : '0';
  }
  function renderHint() {
    el.hint.textContent = S.moving ? 'TOUCHE LA CASE DE DESTINATION' : 'ÉDITION · TOUCHE UNE CASE OU UNE PAGE';
  }
  function renderAll() {
    document.body.className = S.edit ? 'editing' : '';
    el.editLbl.textContent = S.edit ? 'OK' : 'ÉDIT';
    renderHint(); renderFx(); renderGrid(); renderTabs();
  }

  A.onChange = function (id) {
    var pg = page().pads, i;
    for (i = 0; i < B.SLOTS; i++) if (pg[i] && pg[i].id === id) renderPad(i);
    renderTabs();
  };

  // ====================== Jeu ======================
  function padDown(i, key) {
    var pad = page().pads[i];
    if (!pad || !A.buffers[pad.sample]) return;
    buzz();
    held[key] = { pad: pad, i: i, pg: B.cfg.cur };
    if (pad.mode === 'toggle' && A.voices[pad.id]) A.stop(pad.id);
    else A.play(pad);
    renderPad(i);
  }
  function padUp(key) {
    var hd = held[key];
    if (!hd) return;
    delete held[key];
    if (hd.pad.mode === 'gate') A.stop(hd.pad.id);
    if (hd.pg === B.cfg.cur) renderPad(hd.i);
  }
  function padIndex(target) {
    while (target && target !== el.grid) {
      if (target.getAttribute && target.getAttribute('data-i') !== null) return parseInt(target.getAttribute('data-i'), 10);
      target = target.parentNode;
    }
    return -1;
  }
  function tabKey(target) {
    while (target && target !== el.tabs) {
      if (target.getAttribute && target.getAttribute('data-k') !== null) return target.getAttribute('data-k');
      target = target.parentNode;
    }
    return null;
  }
  function goPage(k) {
    if (k === B.cfg.cur || !B.cfg.pages[k]) return;
    B.cfg.cur = k;
    renderGrid(); renderTabs();
    B.save();
  }

  function setFx(type, amt) {
    B.cfg.fx.type = type;
    B.cfg.fx.amt = amt;
    A.setFx(type, amt);
    renderFx();
    B.save();
  }

  // Curseur horizontal : get() -> 0..1, set(v).
  function slider(e, set) {
    var down = false;
    function at(x) {
      var r = e.getBoundingClientRect(), v = (x - r.left - 10) / (r.width - 20);
      set(v < 0.03 ? 0 : v > 0.97 ? 1 : v);
    }
    on(e, 'touchstart', function (ev) { ev.preventDefault(); A.resume(); at(ev.targetTouches[0].clientX); });
    on(e, 'touchmove', function (ev) { ev.preventDefault(); if (ev.targetTouches[0]) at(ev.targetTouches[0].clientX); });
    on(e, 'mousedown', function (ev) { down = true; at(ev.clientX); });
    on(window, 'mousemove', function (ev) { if (down) at(ev.clientX); });
    on(window, 'mouseup', function () { down = false; });
  }

  // ====================== Mode édition ======================
  function setEdit(v) {
    S.edit = v;
    S.moving = null;
    if (v) Object.keys(held).forEach(padUp);
    renderAll();
  }

  function bindPlay() {
    on(el.grid, 'touchstart', function (ev) {
      A.resume();
      if (S.edit) return;
      ev.preventDefault();
      for (var k = 0; k < ev.changedTouches.length; k++) {
        var t = ev.changedTouches[k], i = padIndex(t.target);
        if (i >= 0) padDown(i, 't' + t.identifier);
      }
    });
    function end(ev) {
      for (var k = 0; k < ev.changedTouches.length; k++) padUp('t' + ev.changedTouches[k].identifier);
    }
    on(el.grid, 'touchend', end);
    on(el.grid, 'touchcancel', end);
    on(el.grid, 'mousedown', function (ev) {
      A.resume();
      if (S.edit) return;
      var i = padIndex(ev.target);
      if (i >= 0) padDown(i, 'm');
    });
    on(window, 'mouseup', function () { padUp('m'); });
    on(el.grid, 'click', function (ev) {
      if (!S.edit) return;
      var i = padIndex(ev.target);
      if (i >= 0) editTap(i);
    });

    on(el.tabs, 'touchstart', function (ev) {
      if (S.edit) return;
      ev.preventDefault();
      var k = tabKey(ev.changedTouches[0].target);
      if (k !== null && k !== 'add') { buzz(); goPage(parseInt(k, 10)); }
    });
    on(el.tabs, 'mousedown', function (ev) {
      if (S.edit) return;
      var k = tabKey(ev.target);
      if (k !== null && k !== 'add') goPage(parseInt(k, 10));
    });
    on(el.tabs, 'click', function (ev) {
      if (!S.edit) return;
      var k = tabKey(ev.target);
      if (k === null) return;
      if (k === 'add') { addPage(); return; }
      k = parseInt(k, 10);
      if (k === B.cfg.cur && !S.moving) editPage(k); else goPage(k);
    });

    press(el.stopBtn, function () {
      buzz();
      A.stopAll();
      el.stopBtn.className = 'tbtn down';
      setTimeout(function () { el.stopBtn.className = 'tbtn'; }, 150);
    });

    slider(el.fx, function (v) { setFx(B.cfg.fx.type, v); });
    press(el.fxBtn, function () {
      // Changer d'effet remet le dosage à zéro : jamais de surprise sonore.
      var t = B.cfg.fx.type, k = 0;
      B.FX.forEach(function (f, n) { if (f[0] === t) k = n; });
      buzz();
      setFx(B.FX[(k + 1) % B.FX.length][0], 0);
    });

    // ÉDIT : appui long pour entrer (pas d'entrée par accident), simple appui pour sortir.
    var holdT = null;
    function holdStart() {
      if (S.edit) { setEdit(false); return; }
      el.editBtn.className = 'tbtn holding';
      holdT = setTimeout(function () { holdT = null; el.editBtn.className = 'tbtn'; buzz(); setEdit(true); }, 550);
    }
    function holdEnd() {
      if (!holdT) return;
      clearTimeout(holdT); holdT = null;
      el.editBtn.className = 'tbtn';
      toast('Maintenir appuyé pour éditer', 1400);
    }
    on(el.editBtn, 'touchstart', function (ev) { ev.preventDefault(); holdStart(); });
    on(el.editBtn, 'touchend', holdEnd);
    on(el.editBtn, 'touchcancel', holdEnd);
    on(el.editBtn, 'mousedown', holdStart);
    on(el.editBtn, 'mouseup', holdEnd);
    on(el.editBtn, 'mouseleave', holdEnd);

    on(el.menuBtn, 'click', openMenu);
    on(document, 'contextmenu', function (ev) { ev.preventDefault(); });
  }

  function editTap(i) {
    var pg = page();
    if (S.moving) {
      var m = S.moving, src = B.cfg.pages[m.pg];
      S.moving = null;
      if (src && src.pads[m.i] === m.pad && !(m.pg === B.cfg.cur && m.i === i)) {
        src.pads[m.i] = pg.pads[i];
        pg.pads[i] = m.pad;
        B.save();
      }
      renderAll();
      return;
    }
    if (pg.pads[i]) { editPad(B.cfg.cur, i); return; }
    pickAudio(function (res, name) {
      var tr = A.autoTrim(res.buffer);
      pg.pads[i] = { id: B.uid('p'), name: name, color: B.COLORS[i % B.COLORS.length], mode: 'oneshot', loop: false,
        vol: 1, sample: res.id, start: tr[0], end: tr[1] };
      B.saveNow();
      renderAll();
      editPad(B.cfg.pages.indexOf(pg), i);
    });
  }

  // ====================== Fichiers ======================
  function readFile(f) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.onerror = function () { rej(fr.error || new Error('lecture')); };
      fr.readAsArrayBuffer(f);
    });
  }
  function pick(input, cb) {
    input.value = '';
    input.onchange = function () {
      var f = input.files && input.files[0];
      input.onchange = null;
      if (f) cb(f);
    };
    input.click();
  }
  function cleanName(n) {
    n = String(n || '').replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ');
    return n.replace(/^\s+|\s+$/g, '').substr(0, 24).toUpperCase();
  }
  function pickAudio(cb) {
    pick(el.fileAudio, function (f) {
      if (f.size > B.MAX_BYTES) { toast('Fichier trop lourd (60 Mo max)', 3500); return; }
      busy('IMPORT DU SON…');
      readFile(f).then(A.importAudio).then(function (res) {
        idle();
        cb(res, cleanName(f.name));
      }, function (e) {
        idle();
        toast(e && e.tooLong ? 'Son trop long (10 minutes max)' : 'Format audio non reconnu', 3500);
      });
    });
  }

  // ====================== Feuilles ======================
  function sheet(title, build, onClose) {
    var wrap = h('div', 'sheet'), head = h('div', 'sheetHead'), ok = h('button', 'btn on sheetOk', 'OK'), body = h('div', 'sheetBody');
    var sh = { el: wrap, body: body, closed: false };
    sh.close = function () {
      if (sh.closed) return;
      sh.closed = true;
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      document.body.removeChild(wrap);
      S.sheets.splice(S.sheets.indexOf(sh), 1);
      if (onClose) onClose();
    };
    on(ok, 'click', sh.close);
    add(wrap, add(head, h('div', 'sheetTitle', title), ok), body);
    add(document.body, wrap);
    S.sheets.push(sh);
    build(body, sh);
    return sh;
  }
  function sec(body, label) {
    var s = h('div', 'sec');
    if (label) add(s, h('div', 'secLbl', label));
    for (var i = 2; i < arguments.length; i++) add(s, arguments[i]);
    add(body, s);
    return s;
  }
  function field(value, max, cb) {
    var f = h('input', 'field');
    f.type = 'text'; f.maxLength = max; f.value = value;
    f.setAttribute('autocapitalize', 'characters'); f.setAttribute('autocomplete', 'off');
    f.setAttribute('autocorrect', 'off'); f.setAttribute('spellcheck', 'false');
    on(f, 'input', function () { cb(f.value.toUpperCase()); });
    on(f, 'keydown', function (ev) { if (ev.keyCode === 13) f.blur(); });
    return f;
  }
  function swatches(cur, cb) {
    var box = h('div', 'sw'), cells = [];
    B.COLORS.forEach(function (c) {
      var cell = h('div', c === cur ? 'sel' : ''), dot = h('div');
      dot.style.background = c;
      on(cell, 'click', function () {
        cells.forEach(function (x) { x.className = ''; });
        cell.className = 'sel';
        cb(c);
      });
      cells.push(cell);
      add(box, add(cell, dot));
    });
    return box;
  }
  function choice(opts, cur, cb) {
    var row = h('div', 'row'), btns = [];
    opts.forEach(function (o) {
      var b = h('button', 'btn' + (o[0] === cur ? ' on' : ''), o[1]);
      on(b, 'click', function () {
        btns.forEach(function (x) { x.className = 'btn'; });
        b.className = 'btn on';
        cb(o[0]);
      });
      btns.push(b);
      add(row, b);
    });
    return row;
  }
  // Bouton qui se répète tant qu'on le tient (réglage fin du recadrage).
  function repeat(btn, fn) {
    var t = null, iv = null;
    function stop() { if (t) clearTimeout(t); if (iv) clearInterval(iv); t = iv = null; }
    function start(ev) {
      if (ev.type === 'touchstart') ev.preventDefault();
      stop(); fn();
      t = setTimeout(function () { iv = setInterval(fn, 45); }, 350);
    }
    on(btn, 'touchstart', start); on(btn, 'touchend', stop); on(btn, 'touchcancel', stop);
    on(btn, 'mousedown', start); on(btn, 'mouseup', stop); on(btn, 'mouseleave', stop);
  }

  // Forme d'onde avec deux poignées (début / fin).
  function waveform(canvas, pad, changed) {
    var buf, W = 0, H = 0, peaks = null, drag = null, dpr = window.devicePixelRatio || 1;
    function compute() {
      buf = A.buffers[pad.sample];
      W = canvas.width = Math.max(50, Math.floor(canvas.clientWidth * dpr));
      H = canvas.height = Math.max(20, Math.floor(canvas.clientHeight * dpr));
      peaks = new Float32Array(W * 2);
      if (!buf) return;
      var d = buf.getChannelData(0), n = d.length, x, i, top = 0;
      for (x = 0; x < W; x++) {
        var a = Math.floor(x * n / W), b = Math.max(a + 1, Math.floor((x + 1) * n / W));
        var step = Math.max(1, Math.floor((b - a) / 48)), lo = 0, hi = 0;
        for (i = a; i < b; i += step) { var v = d[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
        peaks[x * 2] = lo; peaks[x * 2 + 1] = hi;
        if (-lo > top) top = -lo;
        if (hi > top) top = hi;
      }
      // Un son faible reste lisible : l'onde est affichée à pleine hauteur.
      if (top > 0.001) for (x = 0; x < W * 2; x++) peaks[x] /= top;
    }
    function draw() {
      var g = canvas.getContext('2d'), x;
      g.fillStyle = '#161616'; g.fillRect(0, 0, W, H);
      if (!buf) return;
      var rg = A.range(pad, buf), xs = rg[0] / buf.duration * W, xe = rg[1] / buf.duration * W, hw = 3 * dpr;
      g.fillStyle = '#333'; g.fillRect(xs, 0, xe - xs, H);
      for (x = 0; x < W; x++) {
        var y1 = (0.5 - peaks[x * 2 + 1] * 0.47) * H, y2 = (0.5 - peaks[x * 2] * 0.47) * H;
        g.fillStyle = x >= xs && x <= xe ? '#fff' : '#666';
        g.fillRect(x, y1, 1, Math.max(1, y2 - y1));
      }
      g.fillStyle = '#FDD835';
      g.fillRect(xs - hw / 2, 0, hw, H); g.fillRect(xs, 0, 14 * dpr, 14 * dpr);
      g.fillRect(xe - hw / 2, 0, hw, H); g.fillRect(xe - 14 * dpr, H - 14 * dpr, 14 * dpr, 14 * dpr);
    }
    function setEdge(which, t) {
      if (!buf) return;
      var rg = A.range(pad, buf);
      if (which === 'start') pad.start = Math.max(0, Math.min(t, rg[1] - 0.02));
      else pad.end = Math.max(rg[0] + 0.02, Math.min(t, buf.duration));
      draw(); changed();
    }
    function pos(x) {
      var r = canvas.getBoundingClientRect();
      return Math.max(0, Math.min(1, (x - r.left) / r.width)) * (buf ? buf.duration : 0);
    }
    function grab(x) {
      if (!buf) return;
      var rg = A.range(pad, buf), t = pos(x);
      drag = Math.abs(t - rg[0]) <= Math.abs(t - rg[1]) ? 'start' : 'end';
      setEdge(drag, t);
    }
    on(canvas, 'touchstart', function (ev) { ev.preventDefault(); grab(ev.targetTouches[0].clientX); });
    on(canvas, 'touchmove', function (ev) { ev.preventDefault(); if (drag && ev.targetTouches[0]) setEdge(drag, pos(ev.targetTouches[0].clientX)); });
    on(canvas, 'touchend', function () { drag = null; });
    on(canvas, 'mousedown', function (ev) { grab(ev.clientX); });
    on(window, 'mousemove', function (ev) { if (drag && S.sheets.length) setEdge(drag, pos(ev.clientX)); });
    on(window, 'mouseup', function () { drag = null; });
    return {
      reload: function () { compute(); draw(); },
      nudge: function (which, dt) {
        if (!buf) return;
        var rg = A.range(pad, buf);
        setEdge(which, (which === 'start' ? rg[0] : rg[1]) + dt);
      }
    };
  }

  // Son long : à la fermeture on ne garde que la partie recadrée.
  function finalizePad(pad) {
    var buf = A.buffers[pad.sample];
    if (!buf || buf.duration <= B.KEEP_SEC) return Promise.resolve();
    var rg = A.range(pad, buf);
    if (rg[0] < 0.05 && rg[1] > buf.duration - 0.05) return Promise.resolve();
    return A.storeBuffer(buf, rg[0], rg[1]).then(function (r) {
      pad.sample = r.id; pad.start = 0; pad.end = r.buffer.duration;
      return B.saveNow();
    });
  }

  function editPad(pi, i) {
    var pg = B.cfg.pages[pi], pad = pg.pads[i];
    if (!pad) return;
    function show() { if (pi === B.cfg.cur) renderPad(i); B.save(); }

    sheet('CASE ' + (i + 1), function (body, sh) {
      sec(body, 'NOM', field(pad.name, 24, function (v) { pad.name = v; show(); }));
      sec(body, 'COULEUR', swatches(pad.color, function (c) { pad.color = c; show(); }));

      var hint = h('div', 'note', MODE_HINT[pad.mode]);
      var loop = h('button', 'btn gap');
      function loopLbl() { loop.textContent = 'BOUCLE : ' + (pad.loop ? 'OUI' : 'NON'); loop.className = 'btn gap' + (pad.loop ? ' on' : ''); }
      loopLbl();
      on(loop, 'click', function () { A.stop(pad.id); pad.loop = !pad.loop; loopLbl(); show(); });
      sec(body, 'DÉCLENCHEMENT', choice(MODES, pad.mode, function (m) {
        A.stop(pad.id); pad.mode = m; hint.textContent = MODE_HINT[m]; show();
      }), hint, loop);

      var vol = h('div', 'slider'), vFill = h('div', 'fill'), vLbl = h('div', 'lbl');
      function volShow() { vFill.style.width = (pad.vol / 2 * 100) + '%'; vLbl.textContent = Math.round(pad.vol * 100) + ' %'; }
      volShow();
      slider(vol, function (v) {
        pad.vol = Math.round(v * 40) / 20;
        var cur = A.voices[pad.id];
        if (cur) cur.g.gain.setTargetAtTime(pad.vol, A.ctx.currentTime, 0.02);
        volShow(); B.save();
      });
      sec(body, 'VOLUME', add(vol, vFill, vLbl));

      var canvas = h('canvas', 'wave'), tS = h('div', 'time'), tE = h('div', 'time'), keep = h('div', 'note');
      function times() {
        var buf = A.buffers[pad.sample];
        if (!buf) { tS.textContent = tE.textContent = '—'; keep.textContent = ''; return; }
        var rg = A.range(pad, buf);
        tS.textContent = 'DÉBUT ' + rg[0].toFixed(2) + ' s';
        tE.textContent = 'FIN ' + rg[1].toFixed(2) + ' s';
        keep.textContent = 'Durée jouée : ' + (rg[1] - rg[0]).toFixed(2) + ' s. Glisse sur l\'onde pour recadrer, − et + pour ajuster.' +
          (buf.duration > B.KEEP_SEC ? ' Son long : à la fermeture, seule la partie recadrée est conservée.' : '');
      }
      var wave = waveform(canvas, pad, function () { A.stop(pad.id); times(); B.save(); });
      function nudge(which, dt, lbl) {
        var b = h('button', 'btn nudge', lbl);
        repeat(b, function () { wave.nudge(which, dt); });
        return b;
      }
      var listen = h('button', 'btn gap', 'ÉCOUTER');
      on(listen, 'click', function () { if (A.voices[pad.id]) A.stop(pad.id); else A.play(pad); });
      var rowS = add(h('div', 'row'), nudge('start', -0.01, '−'), tS, nudge('start', 0.01, '+'));
      var rowE = add(h('div', 'row'), nudge('end', -0.01, '−'), tE, nudge('end', 0.01, '+'));
      rowS.style.marginTop = rowE.style.marginTop = '8px';
      sec(body, 'RECADRAGE', canvas, rowS, rowE, listen, keep);

      var change = h('button', 'btn', 'CHANGER LE SON'), move = h('button', 'btn gap', 'DÉPLACER LA CASE'), clear = h('button', 'btn gap danger', 'VIDER LA CASE');
      on(change, 'click', function () {
        pickAudio(function (res, name) {
          A.stop(pad.id);
          var tr = A.autoTrim(res.buffer);
          pad.sample = res.id; pad.start = tr[0]; pad.end = tr[1];
          if (!pad.name) pad.name = name;
          wave.reload(); times(); show();
        });
      });
      on(move, 'click', function () {
        sh.close();
        S.moving = { pg: pi, i: i, pad: pad };
        renderAll();
      });
      on(clear, 'click', function () {
        ask('Vider la case « ' + (pad.name || i + 1) + ' » ?', 'VIDER', function () {
          A.stop(pad.id);
          pg.pads[i] = null;
          sh.close();
        });
      });
      sec(body, 'SON', change, move, clear);

      wave.reload(); times();
    }, function () {
      A.stop(pad.id);
      var still = pg.pads[i] === pad;
      (still ? finalizePad(pad) : Promise.resolve()).then(function () { return B.saveNow(); }).then(B.gc)['catch'](function () {});
      renderAll();
    });
  }

  function addPage() {
    if (B.cfg.pages.length >= B.MAX_PAGES) return;
    B.cfg.pages.push(B.newPage(B.cfg.pages.length + 1));
    B.cfg.cur = B.cfg.pages.length - 1;
    B.save();
    renderAll();
  }

  function editPage(k) {
    var pg = B.cfg.pages[k];
    sheet('PAGE ' + (k + 1), function (body, sh) {
      sec(body, 'NOM', field(pg.name, 12, function (v) { pg.name = v; renderTabs(); B.save(); }));
      sec(body, 'COULEUR', swatches(pg.color, function (c) { pg.color = c; renderGrid(); renderTabs(); B.save(); }));
      var left = h('button', 'btn', '← À GAUCHE'), right = h('button', 'btn', 'À DROITE →');
      function shift(d) {
        var cur = B.cfg.pages.indexOf(pg), to = cur + d;
        if (to < 0 || to >= B.cfg.pages.length) return;
        B.cfg.pages.splice(cur, 1);
        B.cfg.pages.splice(to, 0, pg);
        B.cfg.cur = to;
        renderTabs(); B.save();
      }
      on(left, 'click', function () { shift(-1); });
      on(right, 'click', function () { shift(1); });
      sec(body, 'ORDRE', add(h('div', 'row'), left, right));
      var del = h('button', 'btn danger', 'SUPPRIMER LA PAGE');
      on(del, 'click', function () {
        if (B.cfg.pages.length < 2) { toast('Il faut garder au moins une page'); return; }
        ask('Supprimer la page « ' + pg.name + ' » et ses sons ?', 'SUPPRIMER', function () {
          pg.pads.forEach(function (p) { if (p) A.stop(p.id); });
          B.cfg.pages.splice(B.cfg.pages.indexOf(pg), 1);
          B.cfg.cur = Math.min(B.cfg.cur, B.cfg.pages.length - 1);
          sh.close();
          B.saveNow().then(B.gc);
        });
      });
      sec(body, 'SUPPRESSION', del);
    }, renderAll);
  }

  // ====================== Menu : export / import ======================
  function closeSheets() { S.sheets.slice().forEach(function (s) { s.close(); }); }

  function loadBuffers() {
    var ids = [], seen = {};
    function take(p) { if (!seen[p.sample]) { seen[p.sample] = 1; ids.push(p.sample); } }
    page().pads.forEach(function (p) { if (p) take(p); });
    B.eachPad(take);
    return new Promise(function (res) {
      var k = 0;
      (function next() {
        if (k >= ids.length) { res(); return; }
        var id = ids[k++];
        A.load(id).then(function () {
          page().pads.forEach(function (p, i) { if (p && p.sample === id) renderPad(i); });
        })['catch'](function () {}).then(function () { setTimeout(next, 0); });
      })();
    });
  }

  function doExport(action) {
    busy('PRÉPARATION DU FICHIER…');
    setTimeout(function () {
      (NATIVE ? B.nativeExport(action) : B.webExport()).then(function () {
        idle();
        if (!NATIVE) toast('Config téléchargée');
      }, function (e) {
        idle();
        toast('Export impossible : ' + (e && e.message || e), 4000);
      });
    }, 60);
  }

  function doImport() {
    pick(el.fileConfig, function (f) {
      busy('LECTURE DU FICHIER…');
      readFile(f).then(function (ab) {
        var parsed = B.parseExport(ab);
        idle();
        ask('Remplacer toute la config actuelle par celle de ce fichier ?', 'REMPLACER', function () {
          busy('IMPORT DE LA CONFIG…');
          B.applyImport(parsed).then(function () {
            A.setFx(B.cfg.fx.type, B.cfg.fx.amt);
            closeSheets();
            S.edit = false; S.moving = null;
            renderAll(); idle();
            toast('Config importée');
            return loadBuffers();
          })['catch'](function (e) { idle(); toast('Import impossible : ' + (e && e.message || e), 4000); });
        });
      })['catch'](function () { idle(); toast('Ce fichier n\'est pas une config Boucan', 3500); });
    });
  }

  function factoryReset() {
    busy('PRÉPARATION DES SONS…');
    A.stopAll();
    A.buffers = {};
    return B.db.clear('samples').then(function () {
      return B.buildFactory(function (i, n) { busy('PRÉPARATION DES SONS ' + i + '/' + n); });
    }).then(function (cfg) {
      B.cfg = cfg;
      return B.saveNow();
    });
  }

  function openMenu() {
    sheet('BOUCAN', function (body) {
      function btn(label, cls, fn) { var b = h('button', 'btn gap' + (cls ? ' ' + cls : ''), label); on(b, 'click', fn); return b; }
      if (NATIVE) {
        sec(body, 'TRANSFÉRER SUR UN AUTRE TÉLÉPHONE',
          btn('ENVOYER LA CONFIG', '', function () { doExport('share'); }),
          btn('ENREGISTRER DANS UN FICHIER', '', function () { doExport('save'); }),
          btn('IMPORTER UNE CONFIG', '', doImport),
          h('div', 'note', 'Le fichier .boucan contient toutes les pages, les réglages et les sons. Sur l\'autre téléphone : MENU, puis IMPORTER UNE CONFIG.'));
      } else {
        sec(body, 'TRANSFÉRER SUR UN AUTRE TÉLÉPHONE',
          btn('EXPORTER LA CONFIG', '', function () { doExport('save'); }),
          btn('IMPORTER UNE CONFIG', '', doImport),
          h('div', 'note', 'Le fichier .boucan contient toutes les pages, les réglages et les sons.'));
      }
      var vib = btn('', '', function () { B.cfg.vibrate = !B.cfg.vibrate; vibLbl(); B.save(); buzz(); });
      function vibLbl() { vib.textContent = 'VIBRATION AU TOUCHER : ' + (B.cfg.vibrate ? 'OUI' : 'NON'); }
      vibLbl();
      sec(body, 'RÉGLAGES', vib);
      sec(body, 'REMISE À ZÉRO', btn('REMETTRE LES SONS D\'ORIGINE', 'danger', function () {
        ask('Effacer toutes les pages et tous les sons importés, et remettre les 16 sons d\'origine ?', 'REMETTRE À ZÉRO', function () {
          factoryReset().then(function () {
            A.setFx(B.cfg.fx.type, B.cfg.fx.amt);
            closeSheets();
            S.edit = false;
            renderAll(); idle();
            return loadBuffers();
          })['catch'](function (e) { idle(); toast('Erreur : ' + (e && e.message || e), 4000); });
        });
      }));
      add(body, h('div', 'note', 'Boucan ' + B.VERSION + ' — sons d\'origine synthétisés, mélodies du domaine public.'));
    });
  }

  // ====================== Ponts natifs (Android) ======================
  B.nativeMsg = function (msg) { idle(); if (msg) toast(msg, 3000); };
  // Bouton retour : vrai si l'app a consommé l'appui.
  B.back = function () {
    if (S.ask) { S.ask(); return true; }
    if (S.sheets.length) { S.sheets[S.sheets.length - 1].close(); return true; }
    if (S.moving) { S.moving = null; renderAll(); return true; }
    if (S.edit) { setEdit(false); return true; }
    return false;
  };

  // ====================== Démarrage ======================
  function fatal(msg) { el.busyTxt.textContent = msg; el.busy.style.display = 'flex'; }

  function boot() {
    ['grid', 'tabs', 'toast', 'busy', 'busyTxt', 'fx', 'fxLbl', 'fxBtn', 'menuBtn', 'stopBtn', 'editBtn', 'editLbl', 'hint', 'fileAudio', 'fileConfig']
      .forEach(function (id) { el[id] = $(id); });
    el.fxFill = el.fx.querySelector('.fill');
    buildGrid();
    try { A.init(); } catch (e) { fatal('Audio indisponible sur cet appareil'); return; }
    on(document, 'touchstart', A.resume);
    on(document, 'visibilitychange', function () { if (!document.hidden) A.resume(); });

    B.db.open().then(function () {
      return B.db.get('kv', 'config');
    }).then(function (raw) {
      if (raw && raw.pages && raw.pages.length) { B.cfg = B.sanitize(raw); return null; }
      return factoryReset();
    }).then(function () {
      bindPlay();
      A.setFx(B.cfg.fx.type, B.cfg.fx.amt);
      renderAll();
      idle();
      return loadBuffers();
    })['catch'](function (e) {
      fatal('Erreur au démarrage : ' + (e && e.message || e));
    });
  }

  if (document.readyState === 'loading') on(document, 'DOMContentLoaded', boot); else boot();
})(window.Boucan);
