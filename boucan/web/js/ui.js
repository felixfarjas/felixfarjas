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
  function t(k, a) { return B.t(k, a); }
  function modes() { return ['oneshot', 'toggle', 'gate'].map(function (m) { return [m, t('mode.' + m)]; }); }
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
  // Le navigateur refuse navigator.vibrate() sur un simple "touchstart" :
  // sur Android la vibration passe donc par le natif.
  function buzz() {
    if (!B.cfg || !B.cfg.vibrate) return;
    try {
      if (NATIVE && window.BoucanNative.vibrate) window.BoucanNative.vibrate(22);
      else if (navigator.vibrate) navigator.vibrate(22);
    } catch (e) {}
  }
  function tellLang() {
    try { if (NATIVE && window.BoucanNative.setLang) window.BoucanNative.setLang(B.lang); } catch (e) {}
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
    var no = h('button', 'btn', t('cancel')), ok = h('button', 'btn danger', yes);
    function close() { if (S.ask === close) S.ask = null; if (wrap.parentNode) document.body.removeChild(wrap); }
    on(no, 'click', close);
    on(ok, 'click', function () { close(); cb(); });
    add(document.body, add(wrap, add(box, h('div', 'askTxt', msg), add(row, no, ok))));
    S.ask = close;
  }
  B.onError = function () { toast(t('saveFail'), 3500); };

  // ====================== Rendu ======================
  function buildGrid() {
    for (var i = 0; i < B.SLOTS; i++) {
      var p = { el: h('div', 'pad'), inn: h('div', 'padIn'), prog: h('div', 'prog'), name: h('div', 'name'), tag: h('div', 'tag'), ico: h('div', 'padIco') };
      p.el.style.left = (i % 2 * 50) + '%';
      p.el.style.top = (Math.floor(i / 2) * 25) + '%';
      p.el.setAttribute('data-i', i);
      add(el.grid, add(p.el, add(p.inn, p.prog, p.ico, p.name, p.tag)));
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
      p.tag.textContent = ''; p.ico.innerHTML = '';
      p.inn.style.border = ''; p.inn.style.backgroundColor = '';
      setProg(p, null);
      return;
    }
    var type = pad.type || 'sample', mic = type === 'mic', fx = type === 'fx';
    var v = A.voices[pad.id], lit = fx ? !!A.fxPads[pad.id] : !!v;
    var fg = mic ? pad.color : ink(pad.color), nm = pad.name || '', longest = 0;
    nm.split(/\s+/).forEach(function (w) { if (w.length > longest) longest = w.length; });
    if (type === 'sample' && !A.buffers[pad.sample]) cls += ' loading';
    if (mic) cls += ' mic';
    if (fx) cls += ' fx' + (lit ? ' lit' : '');
    if (isHeld(i)) cls += ' down';
    if (S.moving && S.moving.pad === pad) cls += ' src';
    p.inn.className = cls;
    // micro : case noire cerclée de couleur ; FX : case hachurée
    p.inn.style.background = '';
    p.inn.style.backgroundColor = mic ? '#000' : pad.color;
    p.inn.style.border = mic ? '5px solid ' + pad.color : '';
    p.inn.style.color = fg;
    p.inn.style.boxShadow = lit ? 'inset 0 0 0 6px ' + fg : '';
    p.ico.innerHTML = mic ? MIC_SVG : '';
    if (fx) p.ico.textContent = 'FX';
    p.name.className = 'name' + (longest > 11 || nm.length > 22 ? ' s3' : longest > 8 || nm.length > 14 ? ' s2' : '');
    p.name.textContent = nm;
    p.tag.textContent = mic ? t(pad.micMode === 'live' ? 'micLive' : 'micAfter') : t('mode.' + pad.mode) + (pad.loop ? ' · ' + t('loop') : '');
    setProg(p, v);
  }

  function renderGrid() {
    el.grid.style.background = shade(page().color, 0.3);
    for (var i = 0; i < B.SLOTS; i++) renderPad(i);
  }

  function renderTabs() {
    var live = {}, n = B.cfg.pages.length;
    B.eachPad(function (p, pi) { if (A.voices[p.id] || A.fxPads[p.id]) live[pi] = 1; });
    el.tabs.innerHTML = '';
    B.cfg.pages.forEach(function (pg, k) {
      var t = h('div', 'tab' + (k === B.cfg.cur ? ' cur' : '') + (live[k] ? ' live' : ''));
      var inn = h('div', 'tabIn', pg.name || String(k + 1));
      t.setAttribute('data-k', k);
      if (k === B.cfg.cur) { inn.style.background = pg.color; inn.style.color = ink(pg.color); }
      else inn.style.borderBottomColor = pg.color;
      add(el.tabs, add(t, inn));
    });
    if (S.edit && n < B.MAX_PAGES) {
      var a = h('div', 'tab add');
      a.setAttribute('data-k', 'add');
      add(el.tabs, add(a, h('div', 'tabIn', '+')));
    }
  }

  function renderFx() {
    el.fxLbl.textContent = t('fx.' + B.cfg.fx.type);
    el.fxFill.style.width = (B.cfg.fx.amt * 100) + '%';
    el.fxFill.style.borderRightWidth = B.cfg.fx.amt > 0 ? '5px' : '0';
  }
  function renderHint() {
    el.hint.textContent = t(S.moving ? 'bar.move' : 'bar.edit');
  }
  function renderAll() {
    document.body.className = S.edit ? 'editing' : '';
    el.editLbl.textContent = S.edit ? 'OK' : t('edit');
    el.menuBtn.textContent = t('menu');
    renderHint(); renderFx(); renderGrid(); renderTabs();
  }

  A.onChange = function (id) {
    var pg = page().pads, i;
    for (i = 0; i < B.SLOTS; i++) if (pg[i] && pg[i].id === id) renderPad(i);
    renderTabs();
    if (S.onVoice) S.onVoice(id);
  };

  // ====================== Micro ======================
  var MIC_SVG = '<svg viewBox="0 0 24 24" width="30" height="30"><rect x="9" y="2" width="6" height="12" rx="3" fill="currentColor"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4" stroke="currentColor" stroke-width="2" fill="none"/></svg>';
  var BIN_SVG = '<svg viewBox="0 0 24 24" width="64" height="64"><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var rec = null; // prise en cours

  function recDraw() {
    if (!rec) return;
    var c = el.recWave, dpr = window.devicePixelRatio || 1, W = c.clientWidth * dpr, H = c.clientHeight * dpr;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    var g = c.getContext('2d'), pk = B.mic.peaks, bw = 3 * dpr, gap = dpr, n = Math.floor(W / (bw + gap)), k;
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#fff';
    for (k = 0; k < n; k++) {
      var v = pk[pk.length - 1 - k];
      if (v === undefined) break;
      var hh = Math.max(2 * dpr, Math.min(1, Math.sqrt(v) * 1.3) * H * 0.9);
      g.fillRect(W - (k + 1) * (bw + gap), (H - hh) / 2, bw, hh);
    }
    var sec = Math.floor(B.mic.seconds);
    el.recTxt.textContent = !rec.ready ? '…' : (rec.live ? t('live') : 'REC') + ' ' + Math.floor(sec / 60) + ':' + (sec % 60 < 10 ? '0' : '') + (sec % 60);
    rec.raf = window.requestAnimationFrame(recDraw);
  }
  function recShow() {
    var r = rec.rect, st = el.recBox.style;
    st.left = r.left + 'px'; st.top = r.top + 'px'; st.width = r.width + 'px'; st.height = r.height + 'px';
    el.recBox.style.borderColor = rec.color;
    el.rec.className = (rec.tap ? 'tap' : 'hold') + (rec.inside ? '' : ' out');
    el.recHint.textContent = rec.tap ? t('recTap') : rec.inside ? t('recHold') : t('recDrop');
    el.rec.style.display = 'block';
  }
  function recBegin(o) {
    rec = o;
    rec.inside = true; rec.ready = false;
    recShow();
    rec.raf = window.requestAnimationFrame(recDraw);
    var mine = rec;
    B.mic.peaks = []; B.mic.seconds = 0;
    B.mic.start({ denoise: o.denoise, live: o.live, vol: o.vol }).then(function () {
      if (rec !== mine) { B.mic.stop(true); return; }
      mine.ready = true;
    }, function () {
      if (rec === mine) recEnd(true);
      toast(t('noMic'), 3500);
    });
  }
  function recEnd(cancel) {
    var r = rec;
    if (!r) return;
    rec = null;
    window.cancelAnimationFrame(r.raf);
    el.rec.style.display = 'none';
    var pcm = B.mic.stop(cancel || !r.inside);
    if (r.done) r.done(pcm);
  }
  function recMove(x, y) {
    if (!rec || rec.tap) return;
    var r = rec.rect, inside = x >= r.left - 8 && x <= r.right + 8 && y >= r.top - 8 && y <= r.bottom + 8;
    if (inside !== rec.inside) { rec.inside = inside; buzz(); recShow(); }
  }
  // Case micro : on parle tant qu'on appuie ; glisser hors de la case annule.
  function recHold(pad, i, key) {
    recBegin({
      key: key, rect: pads[i].inn.getBoundingClientRect(), color: pad.color, live: pad.micMode === 'live',
      denoise: pad.denoise, vol: pad.vol,
      done: function (pcm) {
        if (pcm && pcm.length > A.ctx.sampleRate * 0.15) A.play(pad, undefined, A.pcmBuffer(pcm));
      }
    });
  }
  // Prise pour un sample (éditeur) : un appui démarre, un appui termine.
  function recTap(done) {
    var w = window.innerWidth, hgt = window.innerHeight;
    recBegin({ tap: true, rect: { left: w * 0.08, top: hgt * 0.3, width: w * 0.84, height: 190 }, color: '#E53935', denoise: 0, done: done });
  }

  // ====================== Jeu ======================
  function padDown(i, key) {
    var pad = page().pads[i];
    if (!pad) return;
    var type = pad.type || 'sample';
    if (type === 'sample' && !A.buffers[pad.sample]) return;
    if (type === 'mic' && rec) return;
    buzz();
    held[key] = { pad: pad, i: i, pg: B.cfg.cur };
    if (type === 'fx') A.padFx(pad.id, pad.fx, pad.mode === 'toggle' ? !A.fxPads[pad.id] : true);
    else if (type === 'mic') recHold(pad, i, key);
    else if (pad.mode === 'toggle' && A.voices[pad.id]) A.stop(pad.id);
    else A.play(pad);
    renderPad(i);
  }
  function padUp(key) {
    var hd = held[key];
    if (!hd) return;
    delete held[key];
    var type = hd.pad.type || 'sample';
    if (type === 'fx') { if (hd.pad.mode !== 'toggle') A.padFx(hd.pad.id, hd.pad.fx, false); }
    else if (type === 'mic') { if (rec && rec.key === key) recEnd(false); }
    else if (hd.pad.mode === 'gate') A.stop(hd.pad.id);
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
    on(el.grid, 'touchmove', function (ev) {
      if (!rec) return;
      for (var k = 0; k < ev.changedTouches.length; k++) {
        var tc = ev.changedTouches[k];
        if (rec && rec.key === 't' + tc.identifier) recMove(tc.clientX, tc.clientY);
      }
    });
    on(window, 'mousemove', function (ev) { if (rec && rec.key === 'm') recMove(ev.clientX, ev.clientY); });
    on(el.rec, 'click', function () { if (rec && rec.tap && rec.ready) recEnd(false); });
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
      var list = B.cfg.fxList, k = Math.max(0, list.indexOf(B.cfg.fx.type));
      buzz();
      setFx(list[(k + 1) % list.length], 0);
    });

    // ÉDIT : appui long pour entrer (pas d'entrée par accident), simple appui pour sortir.
    var holdT = null;
    function holdStart() {
      if (S.edit) { setEdit(false); return; }
      el.editBtn.className = 'tbtn holding';
      holdT = setTimeout(function () { holdT = null; el.editBtn.className = 'tbtn'; buzz(); setEdit(true); }, 275);
    }
    function holdEnd() {
      if (!holdT) return;
      clearTimeout(holdT); holdT = null;
      el.editBtn.className = 'tbtn';
      toast(t('hold'), 1400);
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
    newPad(i);
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
      if (f.size > B.MAX_BYTES) { toast(t('tooHeavy'), 3500); return; }
      busy(t('importing'));
      readFile(f).then(A.importAudio).then(function (res) {
        idle();
        cb(res, cleanName(f.name));
      }, function (e) {
        idle();
        toast(t(e && e.tooLong ? 'tooLong' : 'badAudio'), 3500);
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
    var buf, W = 0, H = 0, peaks = null, drag = null, headAt = null, dpr = window.devicePixelRatio || 1;
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
      if (headAt !== null) {
        g.fillStyle = '#E53935';
        g.fillRect(headAt / buf.duration * W - dpr, 0, 2 * dpr, H);
      }
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
      reload: function () { headAt = null; compute(); draw(); },
      // tête de lecture (secondes dans le son, ou null pour la cacher)
      head: function (sec) {
        if (sec === undefined) sec = null;
        if (sec === headAt) return;
        headAt = sec; draw();
      },
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
    if (!buf || pad.rawSample || buf.duration <= B.KEEP_SEC) return Promise.resolve();
    var rg = A.range(pad, buf);
    if (rg[0] < 0.05 && rg[1] > buf.duration - 0.05) return Promise.resolve();
    return A.storeBuffer(buf, rg[0], rg[1]).then(function (r) {
      pad.sample = r.id; pad.start = 0; pad.end = r.buffer.duration;
      return B.saveNow();
    });
  }

  // Valeurs de départ d'une case, par type (le nom et la couleur sont gardés).
  function setType(pad, type, extra) {
    var keep = { id: pad.id, name: pad.name, color: pad.color }, k;
    for (k in pad) delete pad[k];
    for (k in keep) pad[k] = keep[k];
    pad.type = type;
    if (type === 'mic') { pad.micMode = 'after'; pad.denoise = 0.5; pad.vol = 1; if (!pad.name) pad.name = t('typeMic'); }
    else if (type === 'fx') { pad.fx = 'brake'; pad.mode = 'gate'; if (!pad.name) pad.name = t('pfx.brake'); }
    else { pad.mode = 'oneshot'; pad.loop = false; pad.vol = 1; pad.fadeIn = 0; pad.fadeOut = 0; }
    for (k in extra || {}) pad[k] = extra[k];
    return pad;
  }
  function sampleFields(res) {
    var tr = A.autoTrim(res.buffer);
    return { sample: res.id, start: tr[0], end: tr[1] };
  }

  // Case vide : on choisit d'abord ce qu'on y met.
  function newPad(i) {
    var pg = page(), pi = B.cfg.cur;
    function make(type, extra, name) {
      pg.pads[i] = setType({ id: B.uid('p'), name: name || '', color: B.COLORS[i % B.COLORS.length] }, type, extra);
      B.saveNow();
    }
    sheet(t('newPad'), function (body, sh) {
      function big(label, note, fn) {
        var b = h('button', 'btn big');
        add(b, h('div', '', label), h('div', 'note', note));
        on(b, 'click', fn);
        sec(body, '', b);
      }
      function open() { sh.close(); renderAll(); editPad(pi, i); }
      big(t('typeSample'), t('noteSample'), function () {
        pickAudio(function (res, name) { make('sample', sampleFields(res), name); open(); });
      });
      big(t('typeMic'), t('noteMic'), function () { make('mic'); open(); });
      big(t('typeFx'), t('noteFx'), function () { make('fx'); open(); });
    });
  }

  function editPad(pi, i) {
    var pg = B.cfg.pages[pi], pad = pg.pads[i];
    if (!pad) return;
    var type = pad.type || 'sample';
    var pausedAt = null, raf = null, wave = null, playLbl, playIco, times = function () {};
    function show() { if (pi === B.cfg.cur) renderPad(i); B.save(); }
    function halt() { pausedAt = null; A.stop(pad.id, false, true); }
    function playShow() {
      if (!playIco) return;
      var on = !!A.voices[pad.id];
      playIco.className = on ? 'ico pause' : 'ico play';
      playLbl.textContent = t(on ? 'pause' : 'play');
    }
    // Tête de lecture : redessinée à chaque image tant que la feuille est ouverte.
    function tick() {
      var v = A.voices[pad.id];
      wave.head(v ? A.pos(v) : pausedAt);
      raf = window.requestAnimationFrame(tick);
    }
    function range01(cls, get, set, label) {
      var s = h('div', 'slider' + (cls ? ' ' + cls : '')), f = h('div', 'fill'), l = h('div', 'lbl');
      function paint() { f.style.width = (get() * 100) + '%'; l.textContent = label(); }
      paint();
      slider(s, function (v) { set(v); paint(); });
      return add(s, f, l);
    }
    function volume(body) {
      sec(body, t('volume'), range01('slim', function () { return pad.vol / 1.5; }, function (v) {
        v = Math.round(v * 30) / 20;
        pad.vol = Math.abs(v - 1) <= 0.1 ? 1 : v; // aimanté à 100 %
        var cur = A.voices[pad.id];
        if (cur) cur.g.gain.setTargetAtTime(pad.vol, A.ctx.currentTime, 0.02);
        B.save();
      }, function () { return Math.round(pad.vol * 100) + ' %'; }));
    }

    // Prise micro d'un sample : on garde la prise brute pour régler le débruiteur après coup.
    var denT = null;
    function reprocess() {
      return A.load(pad.rawSample).then(function (raw) {
        if (!raw) return;
        var out = B.denoise(raw.getChannelData(0), raw.sampleRate, pad.denoise || 0);
        return A.storeBuffer(A.pcmBuffer(out, raw.sampleRate)).then(function (r) {
          var first = !pad.sample;
          pad.sample = r.id;
          if (first || pad.end === undefined) { var tr = A.autoTrim(r.buffer); pad.start = tr[0]; pad.end = tr[1]; }
          if (wave) wave.reload();
          times(); show();
        });
      });
    }

    sheet(t('pad') + ' ' + (i + 1), function (body, sh) {
      function reopen() { sh.close(); editPad(pi, i); }

      if (type === 'sample') {
        var change = h('button', 'btn accent', t('change')), micB = h('button', 'btn accent micBtn');
        micB.innerHTML = MIC_SVG;
        on(change, 'click', function () {
          pickAudio(function (res, name) {
            halt();
            var f = sampleFields(res);
            pad.sample = f.sample; pad.start = f.start; pad.end = f.end;
            delete pad.rawSample; delete pad.denoise;
            if (!pad.name) pad.name = name;
            B.saveNow(); reopen();
          });
        });
        on(micB, 'click', function () {
          halt();
          recTap(function (pcm) {
            if (!pcm || pcm.length < 2000) return;
            busy(t('importing'));
            A.storeBuffer(A.pcmBuffer(pcm)).then(function (r) {
              pad.rawSample = r.id; pad.sample = null; pad.end = undefined;
              if (pad.denoise === undefined) pad.denoise = 0.5;
              return reprocess();
            }).then(function () { idle(); B.saveNow(); reopen(); }, function () { idle(); toast(t('noMic'), 3000); });
          });
        });
        var top = add(h('div', 'row'), change, micB);
        sec(body, '', top);
      }

      sec(body, t('name'), field(pad.name, 24, function (v) { pad.name = v; show(); }));
      sec(body, t('color'), swatches(pad.color, function (c) { pad.color = c; show(); }));

      if (type === 'mic') {
        var mh = h('div', 'note', t('hint.' + pad.micMode));
        sec(body, t('micMode'), choice([['after', t('micAfter')], ['live', t('micLive')]], pad.micMode, function (m) {
          pad.micMode = m; mh.textContent = t('hint.' + m); show();
        }), mh);
        sec(body, t('denoiser'), range01('', function () { return pad.denoise; }, function (v) { pad.denoise = Math.round(v * 20) / 20; B.save(); },
          function () { return Math.round(pad.denoise * 100) + ' %'; }), h('div', 'note', t('denoiseNote')));
        volume(body);
      } else if (type === 'fx') {
        var grid = h('div', 'sw two'), fxBtns = [];
        B.PAD_FX.forEach(function (f) {
          var b = h('button', 'btn' + (f === pad.fx ? ' on' : ''), t('pfx.' + f));
          on(b, 'click', function () {
            A.padFx(pad.id, pad.fx, false);
            if (!pad.name || pad.name === t('pfx.' + pad.fx)) pad.name = t('pfx.' + f);
            pad.fx = f;
            fxBtns.forEach(function (x) { x.className = 'btn'; });
            b.className = 'btn on';
            fxNote.textContent = t('pfxNote.' + f);
            B.saveNow(); show();
            body.querySelector('.field').value = pad.name;
          });
          fxBtns.push(b);
          add(grid, add(h('div'), b));
        });
        var fxNote = h('div', 'note', t('pfxNote.' + pad.fx));
        sec(body, t('effect'), grid, fxNote);
        var fh = h('div', 'note', t('hint.fx' + pad.mode));
        sec(body, t('trigger'), choice([['gate', t('mode.gate')], ['toggle', t('mode.toggle')]], pad.mode, function (m) {
          A.padFx(pad.id, pad.fx, false); pad.mode = m; fh.textContent = t('hint.fx' + m); show();
        }), fh);
      } else {
        var hint = h('div', 'note', t('hint.' + pad.mode));
        var loop = h('button', 'btn gap');
        var loopLbl = function () { loop.textContent = t(pad.loop ? 'loopOn' : 'loopOff'); loop.className = 'btn gap' + (pad.loop ? ' on' : ''); };
        loopLbl();
        on(loop, 'click', function () { halt(); pad.loop = !pad.loop; loopLbl(); show(); });
        sec(body, t('trigger'), choice(modes(), pad.mode, function (m) {
          halt(); pad.mode = m; hint.textContent = t('hint.' + m); show();
        }), hint, loop);

        var canvas = h('canvas', 'wave'), tS = h('div', 'time'), tE = h('div', 'time'), keep = h('div', 'note');
        times = function () {
          var buf = A.buffers[pad.sample];
          if (!buf) { tS.textContent = tE.textContent = '—'; keep.textContent = ''; return; }
          var rg = A.range(pad, buf);
          tS.textContent = t('start') + ' ' + rg[0].toFixed(2) + ' s';
          tE.textContent = t('end') + ' ' + rg[1].toFixed(2) + ' s';
          keep.textContent = t('cropNote', (rg[1] - rg[0]).toFixed(2)) + (buf.duration > B.KEEP_SEC && !pad.rawSample ? t('keepNote') : '');
        };
        wave = waveform(canvas, pad, function () { halt(); times(); B.save(); });
        var nudge = function (which, dt, lbl) {
          var b = h('button', 'btn nudge', lbl);
          repeat(b, function () { wave.nudge(which, dt); });
          return b;
        };
        var playBtn = h('button', 'btn gap playBtn');
        playIco = h('span', 'ico play'); playLbl = h('span');
        add(playBtn, playIco, playLbl);
        on(playBtn, 'click', function () {
          var v = A.voices[pad.id];
          if (v) { pausedAt = A.pos(v); A.stop(pad.id, false, true); }
          else { var from = pausedAt; pausedAt = null; A.play(pad, from); }
        });
        var rowS = add(h('div', 'row'), nudge('start', -0.01, '−'), tS, nudge('start', 0.01, '+'));
        var rowE = add(h('div', 'row'), nudge('end', -0.01, '−'), tE, nudge('end', 0.01, '+'));
        rowS.style.marginTop = rowE.style.marginTop = '8px';
        sec(body, t('crop'), canvas, playBtn, rowS, rowE, keep);

        if (pad.rawSample) {
          sec(body, t('denoiser'), range01('', function () { return pad.denoise || 0; }, function (v) {
            pad.denoise = Math.round(v * 20) / 20;
            halt();
            if (denT) clearTimeout(denT);
            denT = setTimeout(function () { denT = null; reprocess()['catch'](function () {}); }, 350);
          }, function () { return Math.round((pad.denoise || 0) * 100) + ' %'; }), h('div', 'note', t('denoiseNote')));
        }

        var fades = function (key) {
          return choice(B.FADES.map(function (f) { return [f, f ? f + ' s' : t('none')]; }), pad[key] || 0, function (f) {
            halt(); pad[key] = f; B.save();
          });
        };
        sec(body, t('fadeIn'), fades('fadeIn'));
        sec(body, t('fadeOut'), fades('fadeOut'));
        volume(body);
      }

      // Type de case : on peut en changer à tout moment.
      sec(body, t('padType'), choice([['sample', t('typeSample')], ['mic', t('typeMic')], ['fx', t('typeFx')]], type, function (ty) {
        if (ty === type) return;
        halt(); A.padFx(pad.id, pad.fx, false);
        if (ty === 'sample') {
          pickAudio(function (res, name) {
            if (pad.name === t('typeMic') || B.PAD_FX.some(function (f) { return pad.name === t('pfx.' + f); })) pad.name = name;
            setType(pad, 'sample', sampleFields(res)); B.saveNow(); reopen();
          });
          return;
        }
        if (type !== 'sample' && (pad.name === t('typeMic') || B.PAD_FX.some(function (f) { return pad.name === t('pfx.' + f); }))) pad.name = '';
        setType(pad, ty); B.saveNow(); reopen();
      }));

      var move = h('button', 'btn', t('move')), clear = h('button', 'btn gap danger', t('clear'));
      on(move, 'click', function () {
        sh.close();
        S.moving = { pg: pi, i: i, pad: pad };
        renderAll();
      });
      on(clear, 'click', function () {
        ask(t('askClear', pad.name || i + 1), t('doClear'), function () {
          halt(); A.padFx(pad.id, pad.fx, false);
          pg.pads[i] = null;
          sh.close();
        });
      });
      sec(body, t('padSec'), move, clear);

      if (wave) {
        S.onVoice = function (id) { if (id === pad.id) { if (!A.voices[id] && pausedAt === null) wave.head(null); playShow(); } };
        wave.reload(); times(); playShow();
        raf = window.requestAnimationFrame(tick);
      }
    }, function () {
      S.onVoice = null;
      if (raf) window.cancelAnimationFrame(raf);
      if (denT) { clearTimeout(denT); reprocess()['catch'](function () {}); }
      A.stop(pad.id, false, true);
      var still = pg.pads[i] === pad && (pad.type || 'sample') === 'sample';
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
    sheet(t('page') + ' ' + (k + 1), function (body, sh) {
      sec(body, t('name'), field(pg.name, 12, function (v) { pg.name = v; renderTabs(); B.save(); }));
      sec(body, t('color'), swatches(pg.color, function (c) { pg.color = c; renderGrid(); renderTabs(); B.save(); }));
      var left = h('button', 'btn', t('left')), right = h('button', 'btn', t('right'));
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
      sec(body, t('order'), add(h('div', 'row'), left, right));
      var del = h('button', 'btn danger', t('delPage'));
      on(del, 'click', function () {
        if (B.cfg.pages.length < 2) { toast(t('keepOne')); return; }
        ask(t('askDelPage', pg.name), t('doDel'), function () {
          pg.pads.forEach(function (p) { if (p) { A.stop(p.id, false, true); A.padFx(p.id, p.fx, false); } });
          B.cfg.pages.splice(B.cfg.pages.indexOf(pg), 1);
          B.cfg.cur = Math.min(B.cfg.cur, B.cfg.pages.length - 1);
          sh.close();
          B.saveNow().then(B.gc);
        });
      });
      sec(body, t('del'), del);
    }, renderAll);
  }

  // ====================== Menu : export / import ======================
  function closeSheets() { S.sheets.slice().forEach(function (s) { s.close(); }); }

  function loadBuffers() {
    var ids = [], seen = {};
    function take(p) { if (p.sample && !seen[p.sample]) { seen[p.sample] = 1; ids.push(p.sample); } }
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
    busy(t('makingFile'));
    setTimeout(function () {
      (NATIVE ? B.nativeExport(action) : B.webExport()).then(function () {
        idle();
        if (!NATIVE) toast(t('downloaded'));
      }, function (e) {
        idle();
        toast(t('exportFail') + (e && e.message || e), 4000);
      });
    }, 60);
  }

  function doImport() {
    pick(el.fileConfig, function (f) {
      busy(t('readingFile'));
      readFile(f).then(function (ab) {
        var parsed = B.parseExport(ab);
        idle();
        ask(t('askImport'), t('doImport'), function () {
          busy(t('importingCfg'));
          B.applyImport(parsed).then(function () {
            B.lang = B.cfg.lang; tellLang();
            A.setFx(B.cfg.fx.type, B.cfg.fx.amt);
            closeSheets();
            S.edit = false; S.moving = null;
            renderAll(); idle();
            toast(t('imported'));
            return loadBuffers();
          })['catch'](function (e) { idle(); toast(t('importFail') + (e && e.message || e), 4000); });
        });
      })['catch'](function () { idle(); toast(t('notBoucan'), 3500); });
    });
  }

  function factoryReset() {
    busy(t('preparing') + '…');
    A.stopAll();
    A.buffers = {};
    return B.db.clear('samples').then(function () {
      return B.buildFactory(function (i, n) { busy(t('preparing') + ' ' + i + '/' + n); });
    }).then(function (cfg) {
      B.cfg = cfg;
      return B.saveNow();
    });
  }

  function openMenu() {
    sheet('BOUCAN', function (body, sh) {
      function btn(label, cls, fn) { var b = h('button', 'btn gap' + (cls ? ' ' + cls : ''), label); on(b, 'click', fn); return b; }
      if (NATIVE) {
        sec(body, t('transfer'),
          btn(t('send'), '', function () { doExport('share'); }),
          btn(t('saveFile'), '', function () { doExport('save'); }),
          btn(t('importCfg'), '', doImport),
          h('div', 'note', t('transferNote')));
      } else {
        sec(body, t('transfer'),
          btn(t('exportCfg'), '', function () { doExport('save'); }),
          btn(t('importCfg'), '', doImport),
          h('div', 'note', t('transferNote')));
      }

      // Effets proposés par le bouton FX.
      var fxBox = h('div', 'sw two');
      B.FX.forEach(function (f) {
        var cell = h('div'), b = h('button', 'btn', t('fx.' + f));
        function paint() { b.className = 'btn' + (B.cfg.fxList.indexOf(f) >= 0 ? ' on' : ''); }
        paint();
        on(b, 'click', function () {
          var k = B.cfg.fxList.indexOf(f);
          if (k >= 0) {
            if (B.cfg.fxList.length < 2) { toast(t('keepFx')); return; }
            B.cfg.fxList.splice(k, 1);
            if (B.cfg.fx.type === f) setFx(B.cfg.fxList[0], 0);
          } else {
            B.cfg.fxList = B.FX.filter(function (x) { return x === f || B.cfg.fxList.indexOf(x) >= 0; });
          }
          paint(); B.save();
        });
        add(fxBox, add(cell, b));
      });
      sec(body, t('fxList'), fxBox, h('div', 'note', t('fxNote')));

      sec(body, t('lang'), choice(B.LANGS, B.lang, function (l) {
        B.lang = B.cfg.lang = l;
        B.save(); tellLang();
        sh.close(); renderAll(); openMenu();
      }));

      var vib = btn('', '', function () { B.cfg.vibrate = !B.cfg.vibrate; vibLbl(); B.save(); buzz(); });
      function vibLbl() { vib.textContent = t(B.cfg.vibrate ? 'vibOn' : 'vibOff'); vib.className = 'btn' + (B.cfg.vibrate ? ' on' : ''); }
      vibLbl();
      sec(body, t('settings'), vib);

      sec(body, t('reset'), btn(t('resetBtn'), 'danger', function () {
        ask(t('askReset'), t('doReset'), function () {
          factoryReset().then(function () {
            A.setFx(B.cfg.fx.type, B.cfg.fx.amt);
            closeSheets();
            S.edit = false;
            renderAll(); idle();
            return loadBuffers();
          })['catch'](function (e) { idle(); toast(t('error') + (e && e.message || e), 4000); });
        });
      }));
      var cred = [h('div', 'note', t('creditsNote'))];
      (B.CREDITS || []).forEach(function (c) { cred.push(h('div', 'note', c)); });
      sec.apply(null, [body, t('credits')].concat(cred));
      add(body, h('div', 'note', t('about', B.VERSION)));
    });
  }

  // ====================== Ponts natifs (Android) ======================
  B.nativeMsg = function (key) { idle(); if (key) toast(t('n.' + key), 3000); };
  // Bouton retour : vrai si l'app a consommé l'appui.
  B.back = function () {
    if (rec) { recEnd(true); return true; }
    if (S.ask) { S.ask(); return true; }
    if (S.sheets.length) { S.sheets[S.sheets.length - 1].close(); return true; }
    if (S.moving) { S.moving = null; renderAll(); return true; }
    if (S.edit) { setEdit(false); return true; }
    return false;
  };

  // ====================== Démarrage ======================
  function fatal(msg) { el.busyTxt.textContent = msg; el.busy.style.display = 'flex'; }

  function boot() {
    ['grid', 'tabs', 'toast', 'busy', 'busyTxt', 'fx', 'rec', 'recBox', 'recWave', 'recTxt', 'recHint', 'recBin', 'fxLbl', 'fxBtn', 'menuBtn', 'stopBtn', 'editBtn', 'editLbl', 'hint', 'fileAudio', 'fileConfig']
      .forEach(function (id) { el[id] = $(id); });
    el.fxFill = el.fx.querySelector('.fill');
    el.recBin.innerHTML = BIN_SVG;
    buildGrid();
    try { A.init(); } catch (e) { fatal(t('noAudio')); return; }
    on(document, 'touchstart', A.resume);
    on(document, 'visibilitychange', function () { if (!document.hidden) A.resume(); });

    B.db.open().then(function () {
      return B.db.get('kv', 'config');
    }).then(function (raw) {
      if (raw && raw.pages && raw.pages.length) { B.cfg = B.sanitize(raw); B.lang = B.cfg.lang; return null; }
      return factoryReset();
    }).then(function () {
      bindPlay();
      tellLang();
      A.setFx(B.cfg.fx.type, B.cfg.fx.amt);
      renderAll();
      idle();
      if (B.volatile) toast(t('noStore'), 6000);
      return loadBuffers();
    })['catch'](function (e) {
      fatal(t('bootFail') + (e && e.message || e));
    });
  }

  if (document.readyState === 'loading') on(document, 'DOMContentLoaded', boot); else boot();
})(window.Boucan);
