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
  // Une « vue » : les éléments d'un bouton (grande case ou petit bouton de hub).
  function viewDom() {
    var v = { inn: h('div', 'padIn'), prog: h('div', 'prog'), name: h('div', 'name'), tag: h('div', 'tag'), ico: h('div', 'padIco') };
    add(v.inn, v.prog, v.ico, v.name, v.tag);
    return v;
  }
  function buildGrid() {
    for (var i = 0; i < B.SLOTS; i++) {
      var p = viewDom(), k;
      p.el = h('div', 'pad'); p.pl = playerDom(); p.dk = deckDom(); p.kb = B.midiUI.keysDom(); p.bc = bpmDom(); p.hub = { el: h('div', 'hub'), v: [] };
      for (k = 0; k < 4; k++) {
        var m = viewDom(), box = h('div', 'mini');
        box.style.left = (k % 2 * 50) + '%';
        box.style.top = (Math.floor(k / 2) * 50) + '%';
        box.setAttribute('data-s', k);
        add(p.hub.el, add(box, m.inn));
        p.hub.v.push(m);
      }
      p.el.style.left = (i % 2 * 50) + '%';
      p.el.style.top = (Math.floor(i / 2) * 25) + '%';
      p.el.setAttribute('data-i', i);
      add(el.grid, add(p.el, add(p.inn, p.pl.el, p.dk.el, p.kb.el, p.bc.el, p.hub.el)));
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

  // s : numéro du petit bouton dans un hub, -1 pour une case entière.
  function isHeld(i, s) {
    for (var k in held) if (held[k].i === i && held[k].s === s && held[k].pg === B.cfg.cur) return true;
    return false;
  }
  // Vrai si la case, ou l'un des boutons de son hub, satisfait le test.
  function inCell(c, test) {
    return !!c && (test(c) || (c.type === 'hub' && c.subs.some(function (q) { return !!q && test(q); })));
  }

  // Dessine un bouton (sample, micro ou FX) dans une vue.
  // quick : la case peut proposer l'ajout rapide (réglage du menu) hors édition.
  function paint(p, pad, down, quick) {
    var cls = 'padIn', st = p.inn.style;
    st.background = ''; st.boxShadow = ''; st.border = '';
    if (!pad) {
      p.inn.className = cls + ' empty';
      st.color = ''; st.backgroundColor = '';
      p.name.className = 'name';
      p.name.textContent = S.edit || (quick && B.cfg.quickAdd) ? '+' : '';
      if (!S.edit && quick && B.cfg.quickAdd) p.inn.className = cls + ' empty quick';
      p.tag.textContent = ''; p.ico.innerHTML = '';
      setProg(p, null);
      return;
    }
    var type = pad.type || 'sample', mic = type === 'mic', fx = type === 'fx', midi = type === 'midi';
    var mst = midi ? B.midi.state(pad) : '';
    var v = midi ? B.midi.info(pad) : A.voices[pad.id], lit = fx ? !!A.fxPads[pad.id] : !!v;
    var fg = mic ? pad.color : ink(pad.color), nm = pad.name || '', longest = 0;
    nm.split(/\s+/).forEach(function (w) { if (w.length > longest) longest = w.length; });
    if (type === 'sample' && !A.buffers[pad.sample]) cls += ' loading';
    if (mic) cls += ' mic';
    if (fx) cls += ' fx' + (lit ? ' lit' : '');
    if (midi) cls += ' midi' + (mst === 'queued' ? ' queued' : '');
    if (down) cls += ' down';
    if (S.moving && S.moving.pad === pad) cls += ' src';
    p.inn.className = cls;
    // micro : case noire cerclée de couleur ; FX : case hachurée très arrondie
    st.backgroundColor = mic ? '#000' : pad.color;
    st.border = mic ? '5px solid ' + pad.color : '';
    st.color = fg;
    st.boxShadow = lit ? 'inset 0 0 0 6px ' + fg : '';
    p.ico.innerHTML = mic ? MIC_SVG : '';
    if (fx) p.ico.textContent = 'FX';
    if (midi) p.ico.textContent = 'MIDI';
    p.name.className = 'name' + (longest > 11 || nm.length > 22 ? ' s3' : longest > 8 || nm.length > 14 ? ' s2' : '');
    p.name.textContent = nm;
    p.tag.textContent = midi ? pad.bars + ' ' + t(pad.bars > 1 ? 'mdBarsN' : 'mdBar1') + (mst === 'queued' ? ' · ' + t('mdWait') : '') :
      mic ? t(pad.micMode === 'live' ? 'micLive' : 'micAfter') : t('mode.' + pad.mode) + (pad.loop ? ' · ' + t('loop') : '');
    setProg(p, v);
  }

  function renderPad(i) {
    var p = pads[i], pad = page().pads[i], st = p.inn.style, k;
    var wide = pad ? B.ROWS[pad.type] || 0 : 0, covered = B.cover(page(), i) >= 0, hub = !!pad && pad.type === 'hub';
    p.el.style.display = covered ? 'none' : '';
    p.el.style.width = wide ? '100%' : '50%';
    p.el.style.height = ((wide || 1) * 25) + '%';
    p.pl.el.style.display = wide && pad.type === 'player' ? '' : 'none';
    p.dk.el.style.display = wide && pad.type === 'deck' ? '' : 'none';
    p.kb.el.style.display = wide && pad.type === 'keys' ? '' : 'none';
    p.hub.el.style.display = hub ? '' : 'none';
    p.bc.el.style.display = pad && pad.type === 'bpm' ? '' : 'none';
    if (covered) return;
    if (pad && pad.type === 'bpm') {
      p.inn.className = 'padIn pl';
      st.background = ''; st.border = ''; st.boxShadow = '';
      st.backgroundColor = pad.color; st.color = ink(pad.color);
      p.name.textContent = ''; p.tag.textContent = ''; p.ico.innerHTML = '';
      setProg(p, null);
      bpmPaint(p.bc);
      return;
    }
    if (wide || hub) {
      p.inn.className = wide ? 'padIn pl' : 'padIn hubIn';
      st.background = ''; st.border = ''; st.boxShadow = '';
      st.backgroundColor = wide ? pad.color : 'transparent'; st.color = wide ? ink(pad.color) : '';
      p.name.textContent = ''; p.tag.textContent = ''; p.ico.innerHTML = '';
      setProg(p, null);
      if (hub) for (k = 0; k < 4; k++) paint(p.hub.v[k], pad.subs[k], isHeld(i, k), true);
      else if (pad.type === 'player') playerPaint(p.pl);
      else if (pad.type === 'keys') B.midiUI.keysPaint(p.kb, pad);
      else { p.dk.fg = ink(pad.color); deckPaint(p.dk); }
      return;
    }
    paint(p, pad, isHeld(i, -1), true);
  }

  function renderGrid() {
    el.grid.style.background = shade(page().color, 0.3);
    for (var i = 0; i < B.SLOTS; i++) renderPad(i);
  }

  // Les onglets sont mis à jour sur place : un doigt posé dessus garde sa cible.
  var tabEls = [];
  function renderTabs() {
    var live = {}, n = B.cfg.pages.length, want = n + (S.edit && n < B.MAX_PAGES ? 1 : 0), k;
    var music = B.deck.playing();
    B.eachPad(function (p, pi) { if (A.voices[p.id] || A.fxPads[p.id] || (music && p.type === 'deck') || (p.type === 'midi' && B.midi.state(p))) live[pi] = 1; });
    if (tabEls.length !== want) {
      el.tabs.innerHTML = ''; tabEls = [];
      for (k = 0; k < want; k++) {
        var e = { t: h('div', 'tab'), inn: h('div', 'tabIn'), lbl: h('span'), eq: h('span', 'eq') };
        e.eq.innerHTML = '<i></i>';
        add(el.tabs, add(e.t, add(e.inn, e.lbl, e.eq)));
        tabEls.push(e);
      }
    }
    tabEls.forEach(function (e, k) {
      var pg = B.cfg.pages[k], cur = k === B.cfg.cur, st = e.inn.style;
      var cls = !pg ? 'tab add' : 'tab' + (cur ? ' cur' : '') + (live[k] ? ' live' : '');
      if (e.t.className !== cls) e.t.className = cls;
      e.t.setAttribute('data-k', pg ? k : 'add');
      e.lbl.textContent = pg ? pg.name || String(k + 1) : '+';
      st.background = pg && cur ? pg.color : '';
      st.color = pg && cur ? ink(pg.color) : '';
      st.borderBottomColor = pg && !cur ? pg.color : '';
    });
  }

  function renderFx() {
    // sous le nom de l'effet, en petit : sa cible quand ce n'est pas « les deux »
    el.fxFill.style.background = el.fxBand.style.background = B.FX_COLOR[B.cfg.fx.type] || '';
    var only = B.cfg.fxTarget !== 'all', key = B.cfg.fx.type + '|' + B.cfg.fxTarget + '|' + B.lang;
    el.fxFill.style.width = (B.cfg.fx.amt * 100) + '%';
    el.fxFill.style.borderRightWidth = B.cfg.fx.amt > 0 ? '5px' : '0';
    // le libellé n'est refait que s'il change : le doigt posé dessus ne perd pas sa cible
    if (el.fxLbl.shown === key) return;
    el.fxLbl.shown = key;
    el.fxLbl.className = only ? 'lbl two' : 'lbl';
    el.fxLbl.textContent = t('fx.' + B.cfg.fx.type);
    if (only) add(el.fxLbl, h('small', '', t('tg.' + B.cfg.fxTarget)));
    el.fxFill.style.width = (B.cfg.fx.amt * 100) + '%';
    el.fxFill.style.borderRightWidth = B.cfg.fx.amt > 0 ? '5px' : '0';
  }
  function renderHint() {
    el.hint.textContent = t(S.moving ? 'bar.move' : 'bar.edit');
  }
  function renderAll() {
    document.body.className = (S.edit ? 'editing' : '') + (S.moving ? ' moving' : '');
    el.editLbl.textContent = S.edit ? 'OK' : t('edit');
    el.menuBtn.textContent = t('menu');
    renderHint(); renderFx(); renderGrid(); renderTabs();
  }

  A.onChange = function (id) {
    var pg = page().pads, i;
    function is(q) { return q.id === id; }
    for (i = 0; i < B.SLOTS; i++) if (inCell(pg[i], is)) renderPad(i);
    renderTabs();
    if (S.onVoice) S.onVoice(id);
  };

  // ====================== Widgets de musique ======================
  // PHONE CONTROL (une rangée) : pilote le lecteur de musique du téléphone par le
  // natif — titre, pochette, lecture/pause, suivant, précédent.
  var PL = { st: null, art: '', artKey: null };
  var SVG_PREV = '<svg viewBox="0 0 24 24" width="30" height="30"><path d="M6 5h3v14H6zM20 5v14l-10-7z" fill="currentColor"/></svg>';
  var SVG_NEXT = '<svg viewBox="0 0 24 24" width="30" height="30"><path d="M15 5h3v14h-3zM4 5v14l10-7z" fill="currentColor"/></svg>';
  var SVG_FIND = '<svg viewBox="0 0 24 24" width="24" height="24"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" stroke-width="2.5" fill="none"/><path d="M15.5 15.5L21 21" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>';
  var SVG_PLAY = '<svg viewBox="0 0 24 24" width="36" height="36"><path d="M7 4v16l13-8z" fill="currentColor"/></svg>';
  var SVG_PAUSE = '<svg viewBox="0 0 24 24" width="36" height="36"><path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="currentColor"/></svg>';

  function cmdBtn(cls, cmd, html) {
    var b = h('div', cls);
    b.setAttribute('data-cmd', cmd);
    if (html) b.innerHTML = html;
    return b;
  }
  function playerDom() {
    var d = { el: h('div', 'player'), art: h('div', 'plArt'), title: h('div', 'plTitle'), artist: h('div', 'plArtist'),
      play: cmdBtn('plBtn plPlay', 'toggle'), msg: cmdBtn('plMsg', 'perm') };
    add(d.el, d.art, add(h('div', 'plRight'), add(h('div', 'plTxt'), d.title, d.artist),
      add(h('div', 'plBtns'), cmdBtn('plBtn', 'prev', SVG_PREV), d.play, cmdBtn('plBtn', 'next', SVG_NEXT))), d.msg);
    return d;
  }
  // N'écrit dans la page que si la valeur a changé.
  function setText(e, v) { if (e.shownText !== v) { e.shownText = v; e.textContent = v; } }
  function setHtml(e, v) { if (e.shownHtml !== v) { e.shownHtml = v; e.innerHTML = v; } }
  function setShown(e, on) { var v = on ? '' : 'none'; if (e.shownDisp !== v) { e.shownDisp = v; e.style.display = v; } }
  function playerPaint(d) {
    var st = PL.st, ok = !!(st && st.perm && st.app);
    setShown(d.msg, !ok);
    setText(d.msg, !NATIVE || !window.BoucanNative.playerState ? t('plNoNative') : !st || st.perm ? t('plNone') : t('plPerm'));
    setText(d.title, ok ? st.title || st.app : '');
    setText(d.artist, ok ? st.artist : '');
    setHtml(d.play, ok && st.playing ? SVG_PAUSE : SVG_PLAY);
    var art = ok && PL.art ? PL.art : '';
    if (d.shownArt !== art) { d.shownArt = art; d.art.style.backgroundImage = art ? 'url(data:image/jpeg;base64,' + art + ')' : ''; }
  }
  function shown(type) {
    return page().pads.some(function (p) { return p && p.type === type; });
  }
  function playerPoll() {
    if (!B.cfg || document.hidden) return;
    if (shown('deck')) deckPaintAll();
    B.deck.pump(); // ondes d'avance, quand rien ne joue
    // mode sync : tempo du morceau en cours analysé si besoin, et effets calés qui suivent le tempo
    if (B.cfg.sync && B.deck.analyse()) deckPaintAll();
    if (B.cfg.autoKey && B.deck.analyseKey()) deckPaintAll();
    B.midi.poll();
    if (!NATIVE || !window.BoucanNative.playerState || !shown('player')) return;
    var st;
    try { st = JSON.parse(window.BoucanNative.playerState()); } catch (e) { return; }
    var key = st.app ? st.app + '|' + st.title + '|' + st.artist : null;
    if (key !== PL.artKey) {
      PL.artKey = key; PL.art = '';
      PL.artTry = key ? 3 : 0;
    }
    // la pochette arrive parfois un instant après le titre
    if (PL.artTry > 0 && !PL.art) {
      PL.artTry--;
      try { PL.art = window.BoucanNative.playerArt() || ''; } catch (e2) {}
    }
    PL.st = st;
    page().pads.forEach(function (p, i) { if (p && p.type === 'player') playerPaint(pads[i].pl); });
  }

  // LECTEUR (trois rangées) : lit les fichiers de musique du téléphone, par
  // dossier, album ou artiste, avec son propre volume (voir deck.js).
  function clock(sec) { var m = Math.floor(sec / 60), s = Math.floor(sec - m * 60); return m + ':' + (s < 10 ? '0' : '') + s; }
  function deckDom() {
    var d = { el: h('div', 'deck'), head: cmdBtn('dkHead', 'dlist'), list: h('div', 'dkList'), msg: cmdBtn('dkMsg', 'dperm'),
      now: h('div', 'dkNow'), time: h('div', 'dkTime'), wave: h('canvas', 'dkWave'), play: cmdBtn('plBtn plPlay', 'dtoggle'), vol: h('div', 'dkVol'), fill: h('div', 'fill'),
      rev: -1, cur: -1, seekF: null, fg: '#fff' };
    add(d.el, add(h('div', 'dkTop'), d.head, cmdBtn('dkFind', 'dfind', SVG_FIND)), add(h('div', 'dkMid'), d.list, d.msg), add(h('div', 'dkLine'), d.time, d.now), d.wave,
      add(h('div', 'dkBtns'), cmdBtn('plBtn', 'dprev', SVG_PREV), d.play, cmdBtn('plBtn', 'dnext', SVG_NEXT)), add(d.vol, d.fill, h('div', 'lbl', 'VOL')));
    slider(d.vol, function (v) {
      if (S.edit) return;
      B.deck.setVol(v);
      d.shownVol = (v * 100) + '%';
      d.fill.style.width = d.shownVol;
    });
    // la liste défile : un morceau se choisit par un vrai "click"
    // appui long sur un morceau : lui donner une couleur
    var lpT = null, lpRow = null, lpX = 0, lpY = 0;
    function rowOf(e) {
      while (e && e !== d.list && e.getAttribute('data-ti') === null) e = e.parentNode;
      return e && e !== d.list ? e : null;
    }
    on(d.list, 'touchstart', function (ev) {
      var row = rowOf(ev.target), tc = ev.targetTouches[0];
      lpRow = null;
      if (lpT) clearTimeout(lpT);
      if (!row || S.edit) return;
      lpX = tc.clientX; lpY = tc.clientY;
      lpT = setTimeout(function () { lpT = null; lpRow = row; buzz(); row.style.opacity = '0.5'; }, 480);
    });
    on(d.list, 'touchmove', function (ev) {
      var tc = ev.targetTouches[0];
      if (lpT && tc && (Math.abs(tc.clientX - lpX) > 8 || Math.abs(tc.clientY - lpY) > 8)) { clearTimeout(lpT); lpT = null; }
    });
    on(d.list, 'touchend', function (ev) {
      if (lpT) { clearTimeout(lpT); lpT = null; }
      if (!lpRow) return;
      ev.preventDefault(); // pas de "click" : le morceau ne démarre pas
      var row = lpRow;
      lpRow = null;
      row.style.opacity = '';
      openColor(B.deck.queue[parseInt(row.getAttribute('data-ti'), 10)]);
    });
    on(d.list, 'touchcancel', function () { if (lpT) { clearTimeout(lpT); lpT = null; } if (lpRow) { lpRow.style.opacity = ''; lpRow = null; } });
    on(d.list, 'click', function (ev) {
      if (S.edit) return;
      var e = ev.target;
      while (e && e !== d.list && e.getAttribute('data-ti') === null) e = e.parentNode;
      if (!e || e === d.list) return;
      buzz();
      B.deck.play(B.deck.queue[parseInt(e.getAttribute('data-ti'), 10)]);
    });
    // mini-pochettes : chargées seulement pour les lignes visibles
    var thT = null;
    d.thumbs = function () {
      var rows = d.list.childNodes, a = Math.max(0, Math.floor(d.list.scrollTop / 42) - 2), b = Math.min(rows.length, a + Math.ceil(d.list.clientHeight / 42) + 5), k;
      for (k = a; k < b; k++) {
        if (rows[k].done) continue;
        rows[k].done = true;
        rows[k].th.style.backgroundImage = 'url(' + B.deck.base + 'a/' + B.deck.queue[k].id + ')';
      }
    };
    on(d.list, 'scroll', function () {
      if (thT) return;
      thT = setTimeout(function () { thT = null; d.thumbs(); }, 150);
    });
    // onde du morceau : glisser dessus pour avancer ou reculer
    function seekAt(x) {
      var r = d.wave.getBoundingClientRect();
      d.seekHold = 0;
      d.seekF = Math.max(0, Math.min(1, (x - r.left) / r.width));
      waveDraw(d);
    }
    function seekEnd() {
      if (d.seekF === null) return;
      B.deck.seek(d.seekF);
      d.seekHold = Date.now() + 700; // le temps que le lecteur saute
      waveDraw(d);
    }
    on(d.wave, 'touchstart', function (ev) { ev.preventDefault(); if (!S.edit && B.deck.track) seekAt(ev.targetTouches[0].clientX); });
    on(d.wave, 'touchmove', function (ev) { ev.preventDefault(); if (d.seekF !== null && ev.targetTouches[0]) seekAt(ev.targetTouches[0].clientX); });
    on(d.wave, 'touchend', seekEnd);
    on(d.wave, 'touchcancel', function () { d.seekF = null; });
    on(d.wave, 'mousedown', function (ev) { if (!S.edit && B.deck.track) { seekAt(ev.clientX); seekEnd(); } });
    return d;
  }
  function waveDraw(d) {
    var D = B.deck, c = d.wave, dpr = window.devicePixelRatio || 1, cw = c.clientWidth, W = Math.floor(cw * dpr), H = Math.floor(c.clientHeight * dpr);
    if (!W || !H) return;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    if (d.seekF !== null && d.seekHold && Date.now() > d.seekHold) { d.seekF = null; d.seekHold = 0; }
    var g = c.getContext('2d'), w = D.wave, nb = Math.floor(cw / 3), prog = d.seekF !== null ? d.seekF : D.progress(), k;
    g.clearRect(0, 0, W, H);
    g.fillStyle = d.fg;
    for (k = 0; k < nb; k++) {
      var v = 0.12;
      if (w) {
        var a = Math.floor(k * w.length / nb), b = Math.max(a + 1, Math.floor((k + 1) * w.length / nb)), m = 0, q;
        for (q = a; q < b; q++) if (w[q] > m) m = w[q];
        v = Math.max(0.06, m / 255);
      }
      var hh = Math.max(dpr, v * H);
      g.globalAlpha = (k + 0.5) / nb <= prog ? 1 : 0.32;
      g.fillRect(k * 3 * dpr, (H - hh) / 2, 2 * dpr, hh);
    }
    g.globalAlpha = 1;
    if (D.track) g.fillRect(Math.min(W - 2 * dpr, prog * W), 0, 2 * dpr, H);
  }
  function deckPaint(d) {
    var D = B.deck, ok = D.state === 'ok' && D.queue.length > 0, k;
    setShown(d.msg, !ok);
    setText(d.msg, D.state === 'none' ? t('plNoNative') : D.state === 'perm' ? t('dkPerm') : t('dkEmpty'));
    setText(d.head, (D.listName() || t('dkAll')) + '  \u25be');
    if (d.rev !== D.rev) {
      d.rev = D.rev; d.cur = -1;
      d.list.innerHTML = '';
      for (k = 0; k < D.queue.length && k < 500; k++) {
        var row = h('div', 'dkRow');
        row.setAttribute('data-ti', k);
        row.note = h('span', 'dkNote'); row.th = h('span', 'dkTh');
        rowTint(row, D.queue[k]);
        add(d.list, add(row, row.note, row.th, h('span', '', D.queue[k].t + (D.queue[k].a ? '  ·  ' + D.queue[k].a : ''))));
      }
      d.list.scrollTop = 0;
    }
    d.thumbs();
    var cur = D.track ? D.queue.indexOf(D.track) : -1;
    if (cur !== d.cur) {
      if (d.list.childNodes[d.cur]) d.list.childNodes[d.cur].className = 'dkRow';
      if (d.list.childNodes[cur]) d.list.childNodes[cur].className = 'dkRow cur';
      d.cur = cur;
    }
    setText(d.now, D.track ? D.track.t + (D.track.a ? ' — ' + D.track.a : '') : '');
    // temps écoulé / durée, à droite du titre
    var tm = D.track ? D.times() : null;
    var bp = B.cfg.sync && D.track ? D.bpmOf(D.track) : 0, ky = B.cfg.autoKey && D.track ? D.keyFor(D.track) : null;
    setText(d.time, D.loading() ? '\u2026' : tm && tm[1] > 0 ? (bp ? Math.round(bp) + ' BPM · ' : '') + (ky ? B.midi.KEYS[ky[0]] + (ky[1] ? 'm' : '') + (ky[1] === 2 ? ' harm.' : '') + ' · ' : '') + clock(tm[0]) + ' / ' + clock(tm[1]) : '');
    setHtml(d.play, D.wanted() ? SVG_PAUSE : SVG_PLAY);
    var vw = (B.cfg.deck.vol * 100) + '%';
    if (d.shownVol !== vw) { d.shownVol = vw; d.fill.style.width = vw; }
    waveDraw(d);
  }
  // Couleur et commentaire d'un morceau sur sa ligne.
  function rowTint(row, track) {
    var k = B.deck.key(track), c = B.cfg.deck.colors[k];
    row.style.backgroundColor = c ? 'rgba(' + parseInt(c.substr(1, 2), 16) + ',' + parseInt(c.substr(3, 2), 16) + ',' + parseInt(c.substr(5, 2), 16) + ',0.55)' : '';
    row.style.boxShadow = c ? 'inset 5px 0 0 ' + c : '';
    if (row.note) row.note.textContent = B.cfg.deck.notes[k] || '';
  }
  function mmss(sec) {
    var m = Math.floor(sec / 60), s = sec - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  }
  // Point de départ d'un morceau : on le pose sur l'onde ; doigt immobile, l'onde zoome (x5).
  function cueEditor(body, track, key) {
    var D = B.deck, dur = (track.ms || 0) / 1000;
    if (!(dur > 1)) return;
    var cu = { s: D.cue(track).s, f: D.cue(track).f }, wave = null, v0 = 0, v1 = dur, zoomed = false, holdT = null, lastX = 0, sx = 0, down = false;
    var c = h('canvas', 'wave cue'), lbl = h('div', 'note'), dpr = window.devicePixelRatio || 1;
    function store() {
      if (cu.s < 0.05 && !cu.f) delete B.cfg.deck.cues[key]; else B.cfg.deck.cues[key] = { s: Math.round(cu.s * 100) / 100, f: cu.f };
      B.save();
    }
    function draw() {
      var W = c.width = Math.max(50, Math.floor(c.clientWidth * dpr)), H = c.height = Math.max(20, Math.floor(c.clientHeight * dpr));
      var g = c.getContext('2d'), nb = Math.floor(c.clientWidth / 3), k;
      g.fillStyle = '#161616'; g.fillRect(0, 0, W, H);
      for (k = 0; k < nb; k++) {
        var tm = v0 + (k + 0.5) / nb * (v1 - v0), lv = 0.15;
        if (wave) lv = Math.max(0.05, wave[Math.min(wave.length - 1, Math.floor(tm / dur * wave.length))] / 255);
        g.fillStyle = tm >= cu.s ? '#fff' : '#555';
        g.fillRect(k * 3 * dpr, (1 - lv) * H / 2, 2 * dpr, Math.max(dpr, lv * H));
      }
      var x = (cu.s - v0) / (v1 - v0) * W;
      g.fillStyle = '#FDD835';
      g.fillRect(x - 1.5 * dpr, 0, 3 * dpr, H); g.fillRect(x, 0, 14 * dpr, 14 * dpr);
      if (zoomed) { g.font = 'bold ' + Math.round(12 * dpr) + 'px sans-serif'; g.textAlign = 'center'; g.fillText('ZOOM \u00d75', W / 2, 15 * dpr); }
      lbl.textContent = t('cueAt', mmss(cu.s));
    }
    function frac(x) { var r = c.getBoundingClientRect(); return Math.max(0, Math.min(1, (x - r.left) / r.width)); }
    function put(x) { cu.s = Math.max(0, Math.min(dur - 1, v0 + frac(x) * (v1 - v0))); draw(); }
    function zoomIn() {
      holdT = null;
      if (!down || zoomed) return;
      var span = dur / 5;
      v0 = Math.max(0, Math.min(dur - span, cu.s - frac(lastX) * span)); v1 = v0 + span;
      zoomed = true; buzz(); draw();
    }
    function arm(x) { sx = lastX = x; if (holdT) clearTimeout(holdT); holdT = zoomed ? null : setTimeout(zoomIn, 380); }
    function start(x) { down = true; put(x); arm(x); }
    function move(x) { if (!down) return; lastX = x; if (Math.abs(x - sx) > 5) arm(x); put(x); }
    function end() {
      if (!down) return;
      down = false;
      if (holdT) { clearTimeout(holdT); holdT = null; }
      if (zoomed) { zoomed = false; v0 = 0; v1 = dur; }
      draw(); store();
    }
    on(c, 'touchstart', function (ev) { ev.preventDefault(); start(ev.targetTouches[0].clientX); });
    on(c, 'touchmove', function (ev) { ev.preventDefault(); if (ev.targetTouches[0]) move(ev.targetTouches[0].clientX); });
    on(c, 'touchend', end); on(c, 'touchcancel', end);
    on(c, 'mousedown', function (ev) { start(ev.clientX); end(); });
    var zero = h('button', 'btn', t('cueZero')), play = h('button', 'btn accent', '');
    function playLbl() { play.textContent = t(D.track === track && D.wanted() ? 'pause' : 'cuePlay'); }
    on(zero, 'click', function () { cu.s = 0; draw(); store(); });
    on(play, 'click', function () {
      if (D.track === track && D.wanted()) D.pause(); else D.play(track);
      playLbl();
    });
    playLbl();
    var row = add(h('div', 'row'), zero, play);
    row.style.marginTop = '8px';
    sec(body, t('cueSec'), c, lbl, row, h('div', 'note', t('cueNote')));
    sec(body, t('fadeIn'), rangeS(function () { return Math.min(1, cu.f); }, function (v) { cu.f = Math.round(v * 20) / 20; store(); },
      function () { return cu.f ? cu.f.toFixed(2) + ' s' : t('none'); }));
    setTimeout(draw, 0);
    D.waveOf(track).then(function (w) { if (w && w.length) { wave = w; draw(); } })['catch'](function () {});
  }
  // Appui long sur un morceau : sa couleur et un court commentaire.
  function openColor(track) {
    if (!track) return;
    var key = B.deck.key(track);
    function refresh() {
      B.save();
      page().pads.forEach(function (p, i) {
        if (!p || p.type !== 'deck') return;
        var rows = pads[i].dk.list.childNodes, k = B.deck.queue.indexOf(track);
        if (rows[k]) rowTint(rows[k], track);
      });
    }
    sheet(track.t, function (body, sh) {
      sec(body, t('trackNote'), field(B.cfg.deck.notes[key] || '', 16, function (v) {
        if (v) B.cfg.deck.notes[key] = v; else delete B.cfg.deck.notes[key];
      }), h('div', 'note', t('trackNoteHelp')));
      cueEditor(body, track, key);
      var none = h('button', 'btn gap', t('noColor'));
      function set(c) { if (c) B.cfg.deck.colors[key] = c; else delete B.cfg.deck.colors[key]; refresh(); sh.close(); }
      on(none, 'click', function () { set(''); });
      sec(body, t('color'), swatches(B.cfg.deck.colors[key] || '', set), none);
      // tempo du morceau (mode sync) : corrigeable s'il a été lu à la moitié ou au double
      var bpmL = h('div', 'time'), bpmRow = h('div', 'row');
      var bpmShow = function () { var bi = B.cfg.deck.bpm[key]; bpmL.textContent = bi ? bi[0] + ' BPM' : t('bpmNone'); };
      var bpmMul = function (k) {
        var b = h('button', 'btn', k > 1 ? '\u00d72' : '\u00f72');
        on(b, 'click', function () { var bi = B.cfg.deck.bpm[key]; if (bi) { bi[0] = Math.round(Math.max(40, Math.min(240, bi[0] * k)) * 100) / 100; B.save(); bpmShow(); } });
        return b;
      };
      var bpmRe = h('button', 'btn gap', t('bpmRedo'));
      on(bpmRe, 'click', function () {
        if (B.deck.track !== track) B.deck.play(track);
        setTimeout(function () { toast(B.deck.analyse(true) ? t('bpmDone') : t('bpmWait'), 2500); bpmShow(); }, 400);
      });
      bpmShow();
      sec(body, t('bpmSec'), add(bpmRow, bpmMul(0.5), bpmL, bpmMul(2)), bpmRe, h('div', 'note', t('bpmNote')));
      // gamme du morceau (gamme automatique)
      var keyL = h('div', 'secVal');
      var keyShow = function () { var k2 = B.deck.keyFor(track); keyL.textContent = k2 ? B.midi.KEYS[k2[0]] + ' ' + t(['sc.major', 'sc.minor', 'sc.harm'][k2[1]] || 'sc.major') : t('keyNone'); };
      var keyRe = h('button', 'btn', t('keyRedo'));
      on(keyRe, 'click', function () {
        if (B.deck.track !== track) B.deck.play(track);
        setTimeout(function () { toast(B.deck.analyseKey(true) ? t('keyDone') : t('bpmWait'), 2500); keyShow(); B.midi.poll(); }, 400);
      });
      keyShow();
      sec(body, t('keySec'), keyL, keyRe);
      var hideB = h('button', 'btn danger', t('trackHide'));
      on(hideB, 'click', function () { B.deck.hide(track, true); sh.close(); toast(t('trackHidden'), 3000); });
      sec(body, t('trackHideSec'), hideB, h('div', 'note', t('trackHideNote')));
    }, refresh);
  }
  // Recherche d'un titre dans le dossier source.
  function openSearch() {
    var D = B.deck;
    sheet(t('dkFind'), function (body, sh) {
      var box = h('div'), f = h('input', 'field');
      f.type = 'text'; f.setAttribute('autocomplete', 'off'); f.setAttribute('autocorrect', 'off'); f.setAttribute('spellcheck', 'false');
      f.placeholder = t('dkFindHint');
      function fill() {
        var res = D.search(f.value, 40);
        box.innerHTML = '';
        res.forEach(function (tr) {
          var b = h('button', 'btn gap lst', tr.t + (tr.a ? '  ·  ' + tr.a : ''));
          rowTint(b, tr);
          on(b, 'click', function () { sh.close(); D.play(tr); });
          add(box, b);
        });
        if (f.value && !res.length) add(box, h('div', 'note', t('dkFindNone')));
      }
      on(f, 'input', fill);
      on(f, 'keydown', function (ev) { if (ev.keyCode === 13) f.blur(); });
      sec(body, '', f, box);
      setTimeout(function () { try { f.focus(); } catch (e) {} }, 150);
    }, deckPaintAll);
  }
  var deckWas = false;
  function deckPaintAll() {
    if (!B.cfg) return;
    page().pads.forEach(function (p, i) { if (p && p.type === 'deck') deckPaint(pads[i].dk); });
    // l'onglet de la page du lecteur s'anime quand la musique joue
    if (B.deck.playing() !== deckWas) { deckWas = B.deck.playing(); renderTabs(); }
  }
  function lstBtn(label, n, cur, fn) {
    var b = h('button', 'btn gap lst' + (cur ? ' on' : ''), label + '  (' + n + ')');
    on(b, 'click', fn);
    return b;
  }
  // Liste à lire : tout le dossier source, ou l'un de ses sous-dossiers.
  function openLists() {
    var D = B.deck;
    D.load();
    sheet(t('dkLists'), function (body, sh) {
      var s = sec(body, ''), rb = h('button', 'btn accent', t('dkRootBtn', rootLabel(B.cfg.deck.root)));
      on(rb, 'click', function () { sh.close(); openRoots(openLists); });
      add(s, rb);
      function item(key, label, n) { add(s, lstBtn(label, n, B.cfg.deck.sub === key, function () { D.setSub(key); sh.close(); })); }
      item('', t('dkAll'), D.count());
      D.subs().forEach(function (x) { item(x.key, x.key === '.' ? t('dkHere') : D.leaf(x.key), x.n); });
      // morceaux retirés : un toucher les rétablit
      var gone = D.hiddenList();
      if (gone.length) {
        var hs = sec(body, t('trackGone', gone.length), h('div', 'note', t('trackGoneNote')));
        gone.forEach(function (tr) {
          var b = h('button', 'btn gap lst', tr.t + (tr.a ? '  ·  ' + tr.a : ''));
          on(b, 'click', function () { D.hide(tr, false); b.style.display = 'none'; toast(t('trackBack'), 2000); });
          add(hs, b);
        });
      }
    }, deckPaintAll);
  }
  function rootLabel(path) {
    var D = B.deck, base = D.common + '/';
    return !path || path === D.common ? t('dkRootAuto') : path.indexOf(base) === 0 ? path.substr(base.length) : path;
  }
  // Dossier source des musiques (réglage du menu).
  function openRoots(done) {
    var D = B.deck;
    D.load();
    sheet(t('dkRoot'), function (body, sh) {
      var s = sec(body, '');
      if (D.state === 'perm') {
        var pb = h('button', 'btn accent', t('dkPerm'));
        on(pb, 'click', function () { D.ask(); sh.close(); });
        add(s, pb);
        return;
      }
      add(s, lstBtn(t('dkRootAuto'), D.tracks.length, !B.cfg.deck.root, function () { D.setRoot(''); sh.close(); }));
      D.roots().forEach(function (r) {
        if (r.key === D.common) return; // c'est « toutes les musiques »
        add(s, lstBtn(rootLabel(r.key), r.n, B.cfg.deck.root === r.key, function () { D.setRoot(r.key); sh.close(); }));
      });
    }, function () { deckPaintAll(); if (done) done(); });
  }

  // Appui sur un bouton d'un widget.
  function widgetTap(target) {
    var cmd = null, N = window.BoucanNative, D = B.deck;
    while (target && target !== el.grid && !cmd) { cmd = target.getAttribute && target.getAttribute('data-cmd'); target = target.parentNode; }
    if (!cmd) return;
    buzz();
    if (cmd === 'dlist') openLists();
    else if (cmd === 'dfind') { if (D.state === 'ok') openSearch(); }
    else if (cmd === 'dperm') { if (D.state === 'perm') D.ask(); else if (D.state === 'ok') openLists(); }
    else if (cmd === 'dtoggle') D.toggle();
    else if (cmd === 'dnext') D.next();
    else if (cmd === 'dprev') D.prev();
    else if (NATIVE && N.playerCmd) {
      try { N.playerCmd(cmd); } catch (e) {}
      setTimeout(playerPoll, 350);
      setTimeout(playerPoll, 900);
    }
  }
  // Baisse (ou met en pause) la musique pendant qu'on parle : celle du
  // lecteur intégré, et celle des autres applis par le natif.
  var duckT = null;
  function duck(on, forSec) {
    if (duckT) { clearTimeout(duckT); duckT = null; }
    var mode = B.cfg.duck === 'pause' ? 2 : B.cfg.duck === 'duck' ? 1 : 0;
    function send(m) {
      B.deck.duck(m);
      try { if (NATIVE && window.BoucanNative.duck) window.BoucanNative.duck(m); } catch (e) {}
    }
    if (on) { if (mode) send(mode); return; }
    if (forSec) duckT = setTimeout(function () { duckT = null; send(0); }, forSec * 1000); else send(0);
  }

  // ====================== BPM control ======================
  // Une case : le tempo en grand, un voyant qui bat les temps (rouge sur le 1),
  // − / + pour le tempo, SYNC pour recaler les clips à la main.
  function bpmDom() {
    var d = { el: h('div', 'bpmc'), val: h('div', 'bcVal'), tag: h('div', 'bcTag'), dot: h('div', 'bcDot') };
    add(d.el, d.tag, d.dot, d.val, add(h('div', 'bcRow'), cmdBtn('bcBtn', 'bminus', '\u2212'), cmdBtn('bcBtn bcSync', 'bsync', 'SYNC'), cmdBtn('bcBtn', 'bplus', '+')));
    return d;
  }
  function bpmPaint(d) {
    var v = B.midi.bpm(), lock = B.midi.musicLocked();
    setText(d.val, Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1));
    setText(d.tag, lock ? t(B.deck.manual() ? 'bcManual' : 'bcMusic') : 'BPM');
  }
  // Voyant des temps et valeur affichée : rafraîchis 20 fois par seconde, seulement si la page a une case BPM control.
  function bpmTick() {
    if (document.hidden || !B.cfg) return;
    var ph, got = false;
    page().pads.forEach(function (p, i) {
      if (!p || p.type !== 'bpm') return;
      if (!got) { ph = B.midi.phase(); got = true; }
      var d = pads[i].bc, cls = 'bcDot', b;
      if (ph !== null) { b = Math.floor(ph); if (ph - b < 0.22) cls += ((b % 4) + 4) % 4 === 0 ? ' on bar' : ' on'; }
      if (d.dot.className !== cls) d.dot.className = cls;
      bpmPaint(d);
    });
  }
  function bpmDown(i, key, target) {
    var cmd = null, e = target, d = pads[i].bc;
    while (e && e !== el.grid && !cmd) { cmd = e.getAttribute && e.getAttribute('data-cmd'); if (!cmd) e = e.parentNode; }
    if (!cmd) return;
    buzz();
    var hd = held[key] = { pad: page().pads[i], i: i, s: -1, pg: B.cfg.cur, view: pads[i], bc: { t: null } };
    e.className = e.className.replace(/ hit/g, '') + ' hit';
    setTimeout(function () { e.className = e.className.replace(/ hit/g, ''); }, 160);
    if (cmd === 'bsync') {
      // le sync part dès l'appui : c'est l'instant du toucher qui compte
      B.midi.resync();
      // appui long : on oublie le calage manuel, y compris celui qu'on vient de faire
      hd.bc.t = setTimeout(function () {
        hd.bc.t = null;
        buzz();
        toast(t(B.midi.unsync() ? 'bcReset' : 'bcNoManual'), 2500);
        bpmPaint(d);
      }, 700);
    } else {
      var dir = cmd === 'bplus' ? 1 : -1, n = 0;
      B.midi.nudge(dir);
      // tenu : ça défile, puis ça accélère
      hd.bc.t = setTimeout(function rep() {
        n++;
        B.midi.nudge(dir * (n > 10 ? 5 : 1));
        bpmPaint(d);
        hd.bc.t = setTimeout(rep, 90);
      }, 420);
    }
    bpmPaint(d);
  }
  function editBpm(ref) {
    var pad = refGet(ref);
    sheet('BPM CONTROL', function (body, sh) {
      sec(body, '', h('div', 'note', t('bcHelp')));
      sec(body, t('color'), swatches(pad.color, function (c) { pad.color = c; renderGrid(); B.save(); }));
      var move = h('button', 'btn', t('move')), clear = h('button', 'btn gap danger', t('clear'));
      on(move, 'click', function () { sh.close(); S.moving = { ref: ref, pad: pad }; renderAll(); });
      on(clear, 'click', function () { ask(t('askClear', 'BPM CONTROL'), t('doClear'), function () { refSet(ref, null); sh.close(); }); });
      sec(body, t('padSec'), move, clear);
    }, function () { B.saveNow(); renderAll(); });
  }

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
    duck(true);
    recBegin({
      key: key, rect: pads[i].inn.getBoundingClientRect(), color: pad.color, live: pad.micMode === 'live',
      denoise: pad.denoise, vol: pad.vol,
      done: function (pcm) {
        var ok = pcm && pcm.length > A.ctx.sampleRate * 0.15;
        // la musique reste baissée jusqu'à la fin de la voix rejouée
        duck(false, ok && pad.micMode !== 'live' ? pcm.length / A.ctx.sampleRate + 0.3 : 0);
        if (ok && pad.enhance) pcm = B.enhance(pcm, A.ctx.sampleRate);
        if (ok) A.play(pad, undefined, A.pcmBuffer(pcm));
      }
    });
  }
  // Prise pour un sample (éditeur) : un appui démarre, un appui termine.
  function recTap(done) {
    var w = window.innerWidth, hgt = window.innerHeight;
    recBegin({ tap: true, rect: { left: w * 0.08, top: hgt * 0.3, width: w * 0.84, height: 190 }, color: '#E53935', denoise: 0, done: done });
  }

  // ====================== Jeu ======================
  function subIndex(target) {
    while (target && target !== el.grid) {
      if (target.getAttribute && target.getAttribute('data-s') !== null) return parseInt(target.getAttribute('data-s'), 10);
      target = target.parentNode;
    }
    return -1;
  }
  // Valeur affichée d'un réglage de case FX.
  function parLabel(pad, key) {
    var v = B.padFxVal(pad);
    if (key === 'brakeTime') return v.time.toFixed(1) + ' s';
    if (key === 'echoTime') return Math.round(v.time * 1000) + ' ms';
    if (key === 'repeats') return Math.round((v.fb - 0.2) / 0.7 * 100) + ' %';
    if (key === 'sweep') return v.sweep.toFixed(2) + ' s';
    if (key === 'rate') return v.hz.toFixed(1) + ' Hz';
    if (key === 'loopLen') return Math.round(v.len * 1000) + ' ms';
    if (key === 'pitchSt') return (v.st > 0 ? '+' : '') + v.st + ' ' + t('semi');
    if (key === 'fade') return Math.round(v.sweep * 1000) + ' ms';
    return Math.round(v.amt * 100) + ' %';
  }
  function padP1(pad) { return typeof pad.p1 === 'number' ? pad.p1 : B.PAD_FX_DEF[pad.fx][0]; }

  // Case FX « réglable en glissant » : doigt tenu, monter ou descendre change
  // la valeur. L'écran s'assombrit, un camembert et le contour montrent le dosage.
  // Jauge affichée pendant un réglage au glissé : écran légèrement assombri, camembert, contour qui s'épaissit.
  function gauge(r, color, v, txt, name) {
    var size = 190, st = el.adjBox.style;
    st.left = Math.max(8, Math.min(window.innerWidth - size - 8, r.left + r.width / 2 - size / 2)) + 'px';
    st.top = Math.max(8, Math.min(window.innerHeight - size - 8, r.top + r.height / 2 - size / 2)) + 'px';
    st.borderColor = color;
    st.borderWidth = Math.round(4 + 14 * v) + 'px';
    var c = el.adjPie, dpr = window.devicePixelRatio || 1, n = Math.round(84 * dpr), g = c.getContext('2d'), a0 = -Math.PI / 2;
    if (c.width !== n) { c.width = n; c.height = n; }
    g.clearRect(0, 0, n, n);
    g.fillStyle = color;
    g.beginPath(); g.moveTo(n / 2, n / 2); g.arc(n / 2, n / 2, n / 2 - 3 * dpr, a0, a0 + Math.PI * 2 * Math.max(0.001, v)); g.closePath(); g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = 2 * dpr;
    g.beginPath(); g.arc(n / 2, n / 2, n / 2 - 3 * dpr, 0, Math.PI * 2); g.stroke();
    el.adjTxt.textContent = txt;
    el.adjName.textContent = name;
    el.adj.className = 'on';
  }
  function adjShow(hd) {
    var a = hd.adj;
    gauge(hd.view.inn.getBoundingClientRect(), hd.pad.color, a.get(), a.label(), a.name);
  }
  function adjHide() { el.adj.className = ''; }
  // Jauge discrète : une fine barre au-dessus de l'élément, sans assombrir l'écran (clavier).
  function gaugeMini(r, color, v, txt) {
    var m = el.adjMini, st = m.style, w = Math.min(280, r.width - 16);
    st.width = w + 'px';
    st.left = Math.round(r.left + (r.width - w) / 2) + 'px';
    st.top = Math.max(4, Math.round(r.top - 34)) + 'px';
    m.firstChild.style.width = Math.round(Math.max(0, Math.min(1, v)) * 100) + '%';
    m.firstChild.style.background = color;
    m.lastChild.textContent = txt;
    m.className = 'on';
  }
  function gaugeMiniHide() { el.adjMini.className = ''; }
  function adjMove(hd, y) {
    var a = hd.adj, pad = hd.pad;
    if (!a.on) {
      if (Math.abs(y - a.y) < 14) return false;
      a.on = true; a.y = y;
      buzz();
      if (a.begin) a.begin();
    }
    if (a.delta) a.delta(-(y - a.y) / 170); // plusieurs réglages bougent ensemble, chacun depuis sa valeur
    else a.set(Math.round(Math.max(0, Math.min(1, a.p0 - (y - a.y) / 170)) * 100) / 100);
    adjShow(hd);
    return true;
  }
  function adjEnd(hd) {
    if (!hd.adj || !hd.adj.on) return;
    adjHide();
    B.save();
  }

  function padDown(i, key, target, y) {
    var cell = page().pads[i], s = -1, pad = cell;
    if (!cell) return;
    if (B.ROWS[cell.type]) { widgetTap(target); return; }
    if (cell.type === 'bpm') { bpmDown(i, key, target); return; }
    if (cell.type === 'hub') { s = subIndex(target); pad = s >= 0 ? cell.subs[s] : null; if (!pad) return; }
    var type = pad.type || 'sample';
    if (type === 'sample' && !A.buffers[pad.sample]) return;
    if (type === 'mic' && rec) return;
    buzz();
    var hd = held[key] = { pad: pad, i: i, s: s, pg: B.cfg.cur, view: s >= 0 ? pads[i].hub.v[s] : pads[i] };
    // "was" : l'état d'avant, pour pouvoir annuler l'appui si c'était un swipe
    if (type === 'fx') {
      hd.was = !!A.fxPads[pad.id];
      A.padFx(pad, pad.mode === 'toggle' ? !hd.was : true);
      if (pad.live && typeof y === 'number') hd.adj = { y: y, p0: padP1(pad), on: false, name: pad.name || t('pfx.' + pad.fx),
        get: function () { return padP1(pad); }, label: function () { return parLabel(pad, B.PAD_FX_PAR[pad.fx][0]); },
        begin: function () { if (!A.fxPads[pad.id]) A.padFx(pad, true); },
        set: function (x) { pad.p1 = x; A.padFxUpdate(pad); } };
    }
    else if (type === 'midi') {
      // clip MIDI : il se lance au lâcher (un simple toucher) ; glisser règle les réglages choisis dans l'éditeur
      var tg = (pad.live || []).filter(function (l) { return !!pad.voices[l[0]]; }).map(function (l) {
        var mv = pad.voices[l[0]];
        return { v: mv, k: l[1], s: l[1] === 4 ? mv.oct || 0 : mv.m[l[1]], key: l[1] === 4 ? 'mdOct' : 'mm.' + B.midi.INST[mv.inst].macros[l[1]] };
      });
      if (tg.length && typeof y === 'number') hd.adj = { y: y, on: false,
        name: tg.map(function (x) { return t(x.key); }).join(' + '),
        get: function () { return tg[0].k === 4 ? ((tg[0].v.oct || 0) + 1) / 2 : tg[0].v.m[tg[0].k]; },
        label: function () { return tg[0].k === 4 ? ((tg[0].v.oct || 0) > 0 ? '+' : '') + (tg[0].v.oct || 0) : Math.round(tg[0].v.m[tg[0].k] * 100) + ' %'; },
        delta: function (d) {
          tg.forEach(function (x) {
            if (x.k === 4) x.v.oct = Math.max(-1, Math.min(1, x.s + Math.round(d * 2.5)));
            else x.v.m[x.k] = Math.round(Math.max(0, Math.min(1, x.s + d)) * 100) / 100;
          });
        } };
    }
    else if (type === 'mic') recHold(pad, i, key);
    else if (pad.mode === 'toggle' && A.voices[pad.id]) { hd.was = A.pos(A.voices[pad.id]); A.stop(pad.id); }
    else A.play(pad);
    renderPad(i);
  }
  function padUp(key) {
    var hd = held[key];
    if (!hd) return;
    delete held[key];
    adjEnd(hd);
    if (hd.bc) { if (hd.bc.t) clearTimeout(hd.bc.t); return; }
    var type = hd.pad.type || 'sample';
    if (type === 'fx') { if (hd.pad.mode !== 'toggle') A.padFx(hd.pad, false); }
    else if (type === 'midi') { if (!hd.adj || !hd.adj.on) B.midi.toggle(hd.pad, hd.pg); }
    else if (type === 'mic') { if (rec && rec.key === key) recEnd(false); }
    else if (hd.pad.mode === 'gate') A.stop(hd.pad.id);
    if (hd.pg === B.cfg.cur) renderPad(hd.i);
  }
  // Le geste était un swipe, pas un appui : on défait ce que l'appui a lancé.
  function padUndo(key) {
    var hd = held[key];
    if (!hd) return;
    delete held[key];
    adjEnd(hd);
    if (hd.bc) { if (hd.bc.t) clearTimeout(hd.bc.t); return; }
    var pad = hd.pad, type = pad.type || 'sample';
    if (type === 'fx') A.padFx(pad, !!hd.was && pad.mode === 'toggle');
    else if (type === 'midi') { /* rien n'a encore été lancé */ }
    else if (type === 'mic') { if (rec && rec.key === key) recEnd(true); }
    else if (typeof hd.was === 'number') A.play(pad, hd.was);
    else A.stop(pad.id, false, true);
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
  // dir : +1 la page arrive par la droite, -1 par la gauche.
  function goPage(k, dir) {
    if (k === B.cfg.cur || !B.cfg.pages[k]) return;
    if (dir === undefined) dir = k > B.cfg.cur ? 1 : -1;
    B.cfg.cur = k;
    renderGrid(); renderTabs(); playerPoll();
    B.save();
    slide(dir * el.grid.clientWidth * 0.45, 0.35);
  }
  function gridX(x, anim) {
    var st = el.grid.style, tr = anim ? 'transform .17s ease-out, opacity .17s ease-out' : 'none';
    st.webkitTransition = anim ? '-webkit-' + tr : tr; st.transition = tr;
    st.webkitTransform = st.transform = x ? 'translateX(' + x + 'px)' : '';
  }
  // Place la grille en x puis la laisse glisser à sa place.
  function slide(x, opacity) {
    gridX(x, false);
    el.grid.style.opacity = opacity;
    void el.grid.offsetWidth;
    gridX(0, true);
    el.grid.style.opacity = '';
  }

  function setFx(type, amt) {
    B.cfg.fx.type = type;
    B.cfg.fx.amt = amt;
    A.setFx(type, amt);
    renderFx();
    B.save();
  }

  // Curseur horizontal : set(v), v de 0 à 1.
  // guard : curseur placé dans une feuille qui défile. Il ne réagit qu'à un
  // geste franchement horizontal (ou à un simple toucher), jamais à un défilement.
  function slider(e, set, guard) {
    var down = false, sx = 0, sy = 0, st = 0; // st : 0 indécis, 1 curseur, 2 défilement
    function at(x) {
      var r = e.getBoundingClientRect(), v = (x - r.left - 10) / (r.width - 20);
      set(v < 0.03 ? 0 : v > 0.97 ? 1 : v);
    }
    on(e, 'touchstart', function (ev) {
      var tc = ev.targetTouches[0];
      A.resume();
      if (!guard) { ev.preventDefault(); at(tc.clientX); return; }
      sx = tc.clientX; sy = tc.clientY; st = 0;
    });
    on(e, 'touchmove', function (ev) {
      var tc = ev.targetTouches[0];
      if (!tc) return;
      if (guard && st === 0) {
        var dx = Math.abs(tc.clientX - sx), dy = Math.abs(tc.clientY - sy);
        if (dy > 8 && dy >= dx) st = 2; else if (dx > 10) st = 1;
      }
      if (guard && st !== 1) return;
      ev.preventDefault();
      at(tc.clientX);
    });
    on(e, 'touchend', function (ev) {
      if (guard && st === 0 && ev.changedTouches[0]) { ev.preventDefault(); at(ev.changedTouches[0].clientX); }
      st = 0;
    });
    on(e, 'touchcancel', function () { st = 2; });
    on(e, 'mousedown', function (ev) { down = true; at(ev.clientX); });
    on(window, 'mousemove', function (ev) { if (down) at(ev.clientX); });
    on(window, 'mouseup', function () { down = false; });
  }

  // ====================== Mode édition ======================
  function setEdit(v) {
    S.edit = v;
    S.moving = null;
    if (v) Object.keys(held).forEach(padUp);
    // en quittant l'édition, un hub resté vide disparaît
    else B.cfg.pages.forEach(function (pg) {
      pg.pads.forEach(function (p, i) { if (p && p.type === 'hub' && !p.subs.some(function (q) { return !!q; })) pg.pads[i] = null; });
    });
    renderAll();
  }

  function bindPlay() {
    // Swipe horizontal franc et rapide = page voisine. sw.on : le geste est reconnu.
    var sw = null, qa = null;
    function inCls(e, cls) {
      while (e && e !== el.grid) { if (e.className === cls) return true; e = e.parentNode; }
      return false;
    }
    function touchOf(list, id) {
      for (var k = 0; k < list.length; k++) if (list[k].identifier === id) return list[k];
      return null;
    }
    on(el.grid, 'touchstart', function (ev) {
      A.resume();
      if (sw && sw.on) { ev.preventDefault(); return; }
      var list = inCls(ev.target, 'dkList'), first = ev.changedTouches[0];
      var own = inCls(ev.target, 'dkVol') || inCls(ev.target, 'dkWave') || inCls(ev.target, 'kbd'); // zones qui ont leur propre geste horizontal
      // ajout rapide : une case vide touchée (sans glisser) ouvre le choix de son contenu
      var qi = padIndex(first.target);
      var qc = qi >= 0 ? page().pads[qi] : null, qs = qc && qc.type === 'hub' ? subIndex(first.target) : -1;
      // case vide, ou emplacement vide d'un hub
      var qok = qi >= 0 && (qc ? qs >= 0 && !qc.subs[qs] : B.cover(page(), qi) < 0);
      qa = !S.edit && B.cfg.quickAdd && ev.touches.length === 1 && qok ?
        { id: first.identifier, i: qi, s: qs, x: first.clientX, y: first.clientY, t: Date.now() } : null;
      if (!S.edit && !list) ev.preventDefault();
      sw = B.cfg.swipe && !own && ev.touches.length === 1 && B.cfg.pages.length > 1 && !S.moving ?
        { id: first.identifier, x: first.clientX, y: first.clientY, t: Date.now(), on: false, dx: 0 } : null;
      if (S.edit || list) return;
      for (var k = 0; k < ev.changedTouches.length; k++) {
        var t = ev.changedTouches[k], i = padIndex(t.target);
        if (i >= 0) padDown(i, 't' + t.identifier, t.target, t.clientY);
      }
    });
    function end(ev) {
      var qt = qa && touchOf(ev.changedTouches, qa.id);
      if (qt) {
        var q = qa;
        qa = null;
        if (ev.type === 'touchend' && !(sw && sw.on) && Date.now() - q.t < 700 && Math.abs(qt.clientX - q.x) < 12 && Math.abs(qt.clientY - q.y) < 12) {
          buzz();
          newPad({ pi: B.cfg.cur, i: q.i, s: q.s });
        }
      }
      if (sw && touchOf(ev.changedTouches, sw.id)) {
        var s = sw, to = B.cfg.cur + (s.dx < 0 ? 1 : -1);
        sw = null;
        if (s.on) {
          if (ev.type === 'touchend' && Math.abs(s.dx) > 55 && B.cfg.pages[to]) { buzz(); goPage(to, s.dx < 0 ? 1 : -1); }
          else gridX(0, true);
        }
      }
      for (var k = 0; k < ev.changedTouches.length; k++) padUp('t' + ev.changedTouches[k].identifier);
    }
    on(el.grid, 'touchend', end);
    on(el.grid, 'touchcancel', end);
    on(el.grid, 'touchmove', function (ev) {
      var k, tc;
      // case FX réglable : le doigt qui monte ou descend dose l'effet
      for (k = 0; k < ev.changedTouches.length; k++) {
        var ct = ev.changedTouches[k], hd = held['t' + ct.identifier];
        if (hd && hd.adj && adjMove(hd, ct.clientY)) {
          ev.preventDefault();
          if (sw && sw.id === ct.identifier && !sw.on) sw = null;
        }
      }
      tc = sw && touchOf(ev.touches, sw.id);
      if (sw && tc) {
        var dx = tc.clientX - sw.x, dy = tc.clientY - sw.y;
        if (!sw.on) {
          if (Date.now() - sw.t > 260 || Math.abs(dy) > 28 || ev.touches.length > 1) sw = null;
          else if (Math.abs(dx) > 18 && Math.abs(dx) > 2 * Math.abs(dy)) {
            sw.on = true;
            Object.keys(held).forEach(padUndo); // l'appui qui a lancé le geste ne compte pas
          }
        }
        if (sw && sw.on) {
          ev.preventDefault();
          sw.dx = dx;
          // la grille suit le doigt ; elle résiste s'il n'y a pas de page de ce côté
          gridX(B.cfg.pages[B.cfg.cur + (dx < 0 ? 1 : -1)] ? dx : dx * 0.25, false);
          return;
        }
      }
      if (!rec) return;
      for (k = 0; k < ev.changedTouches.length; k++) {
        var rt = ev.changedTouches[k];
        if (rec && rec.key === 't' + rt.identifier) recMove(rt.clientX, rt.clientY);
      }
    });
    on(window, 'mousemove', function (ev) {
      if (rec && rec.key === 'm') recMove(ev.clientX, ev.clientY);
      if (held.m && held.m.adj) adjMove(held.m, ev.clientY);
    });
    on(el.rec, 'click', function () { if (rec && rec.tap && rec.ready) recEnd(false); });
    on(el.grid, 'mousedown', function (ev) {
      A.resume();
      if (S.edit) return;
      var i = padIndex(ev.target);
      if (i >= 0) padDown(i, 'm', ev.target, ev.clientY);
    });
    on(window, 'mouseup', function () { padUp('m'); });
    on(el.grid, 'click', function (ev) {
      if (!S.edit) return;
      var i = padIndex(ev.target);
      if (i >= 0) editTap(i, subIndex(ev.target));
    });

    on(el.tabs, 'touchstart', function (ev) {
      if (S.edit) return;
      ev.preventDefault();
      var k = tabKey(ev.changedTouches[0].target);
      if (k !== null && k !== 'add') { buzz(); goPage(parseInt(k, 10)); }
    });
    on(el.tabs, 'touchmove', function (ev) {
      if (S.edit) return;
      ev.preventDefault();
      var r = el.tabs.getBoundingClientRect(), tc = ev.changedTouches[0];
      var k = tabKey(document.elementFromPoint(tc.clientX, r.top + r.height / 2));
      if (k !== null && k !== 'add' && parseInt(k, 10) !== B.cfg.cur) { buzz(); goPage(parseInt(k, 10)); }
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
    // Bouton FX : appui court = effet suivant ; appui long = cible des effets.
    var fxT = null;
    function fxDown(ev) {
      if (ev.type === 'touchstart') ev.preventDefault();
      if (fxT) clearTimeout(fxT);
      fxT = setTimeout(function () { fxT = null; buzz(); openTarget(); }, 450);
    }
    function fxUp() {
      if (!fxT) return;
      clearTimeout(fxT); fxT = null;
      // Changer d'effet remet le dosage à zéro : jamais de surprise sonore.
      var list = B.cfg.fxList, k = Math.max(0, list.indexOf(B.cfg.fx.type));
      buzz();
      setFx(list[(k + 1) % list.length], 0);
    }
    on(el.fxBtn, 'touchstart', fxDown); on(el.fxBtn, 'touchend', fxUp);
    on(el.fxBtn, 'touchcancel', function () { if (fxT) { clearTimeout(fxT); fxT = null; } });
    on(el.fxBtn, 'mousedown', fxDown); on(el.fxBtn, 'mouseup', fxUp);

    // ÉDIT : appui long pour entrer (pas d'entrée par accident), simple appui pour sortir.
    var holdT = null;
    function holdStart() {
      if (S.edit) { setEdit(false); return; }
      if (!B.cfg.editHold) { buzz(); setEdit(true); return; } // sécurité désactivée (réglage du menu)
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

  // Une « ref » désigne un emplacement : page, case, et bouton de hub (s, ou -1).
  function refGet(r) {
    var c = B.cfg.pages[r.pi].pads[r.i];
    return r.s >= 0 ? (c && c.type === 'hub' ? c.subs[r.s] : null) : c;
  }
  function refSet(r, v) {
    var pg = B.cfg.pages[r.pi];
    if (r.s < 0) pg.pads[r.i] = v;
    else if (pg.pads[r.i] && pg.pads[r.i].type === 'hub') pg.pads[r.i].subs[r.s] = v;
  }
  function small(p) { return !p || (p.type || 'sample') === 'sample' || p.type === 'fx' || p.type === 'midi'; }

  function editTap(i, s) {
    var cell = page().pads[i], hub = !!cell && cell.type === 'hub';
    if (hub && s < 0) return;
    var ref = { pi: B.cfg.cur, i: i, s: hub ? s : -1 }, dst = refGet(ref);
    if (S.moving) {
      var m = S.moving;
      S.moving = null;
      if (dst && (B.ROWS[dst.type] || dst.type === 'hub')) toast(t('plNoSwap'));
      else if ((ref.s >= 0 && !small(m.pad)) || (m.ref.s >= 0 && !small(dst))) toast(t('hubOnly'), 3000);
      else if (refGet(m.ref) === m.pad && dst !== m.pad) {
        refSet(m.ref, dst);
        refSet(ref, m.pad);
        B.save();
      }
      renderAll();
      return;
    }
    if (dst) editPad(ref); else newPad(ref);
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
  // Type de case : chaque type a sa couleur, la même partout.
  function typeChoice(cur, sub, cb) {
    var row = h('div', 'row');
    [['sample', t('typeSample')], ['mic', t('typeMic')], ['fx', t('typeFx')]].forEach(function (o) {
      if (sub && o[0] === 'mic') return; // pas de micro dans un hub
      var b = h('button', 'btn type t' + o[0] + (o[0] === cur ? ' sel' : ''), o[1]);
      on(b, 'click', function () { cb(o[0]); });
      add(row, b);
    });
    return row;
  }
  // Case à cocher.
  function check(label, val, cb) {
    var b = h('button', 'btn chk' + (val ? ' ticked' : ''));
    add(b, h('span', 'box'), h('span', '', label));
    on(b, 'click', function () { val = !val; b.className = 'btn chk' + (val ? ' ticked' : ''); cb(val); });
    return b;
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

  // Forme d'onde avec deux poignées (début / fin). Garder le doigt immobile
  // sur l'onde zoome autour de la poignée, pour recadrer au centième près.
  function waveform(canvas, pad, changed) {
    var buf, W = 0, H = 0, peaks = null, drag = null, headAt = null, dpr = window.devicePixelRatio || 1;
    var v0 = 0, v1 = 0, top = 1, zoomed = false, holdT = null, sx = 0, lastX = 0;
    function compute() {
      buf = A.buffers[pad.sample];
      W = canvas.width = Math.max(50, Math.floor(canvas.clientWidth * dpr));
      H = canvas.height = Math.max(20, Math.floor(canvas.clientHeight * dpr));
      peaks = new Float32Array(W * 2);
      if (!buf) return;
      if (!zoomed) { v0 = 0; v1 = buf.duration; }
      var d = buf.getChannelData(0), n = d.length, sr = buf.sampleRate, x, i, mx = 0;
      var n0 = v0 * sr, per = (v1 - v0) * sr / W;
      for (x = 0; x < W; x++) {
        var a = Math.max(0, Math.floor(n0 + x * per)), b = Math.min(n, Math.max(a + 1, Math.floor(n0 + (x + 1) * per)));
        var step = Math.max(1, Math.floor((b - a) / 48)), lo = 0, hi = 0;
        for (i = a; i < b; i += step) { var v = d[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
        peaks[x * 2] = lo; peaks[x * 2 + 1] = hi;
        if (-lo > mx) mx = -lo;
        if (hi > mx) mx = hi;
      }
      // Un son faible reste lisible : l'onde est affichée à pleine hauteur
      // (échelle fixée sur le son entier, elle ne saute pas au zoom).
      if (!zoomed) top = mx > 0.001 ? mx : 1;
      for (x = 0; x < W * 2; x++) peaks[x] = Math.max(-1, Math.min(1, peaks[x] / top));
    }
    function tx(sec) { return (sec - v0) / (v1 - v0) * W; }
    function draw() {
      var g = canvas.getContext('2d'), x;
      g.fillStyle = '#161616'; g.fillRect(0, 0, W, H);
      if (!buf) return;
      var rg = A.range(pad, buf), xs = tx(rg[0]), xe = tx(rg[1]), hw = 3 * dpr;
      g.fillStyle = '#333'; g.fillRect(Math.max(0, xs), 0, Math.min(W, xe) - Math.max(0, xs), H);
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
        g.fillRect(tx(headAt) - dpr, 0, 2 * dpr, H);
      }
      if (zoomed) {
        g.fillStyle = '#FDD835';
        g.font = 'bold ' + Math.round(12 * dpr) + 'px sans-serif';
        g.textAlign = 'center';
        g.fillText('ZOOM \u00d7' + Math.round(buf.duration / (v1 - v0)), W / 2, 15 * dpr);
      }
    }
    function setEdge(which, t) {
      if (!buf) return;
      var rg = A.range(pad, buf);
      if (which === 'start') pad.start = Math.max(0, Math.min(t, rg[1] - 0.02));
      else pad.end = Math.max(rg[0] + 0.02, Math.min(t, buf.duration));
      draw(); changed();
    }
    function frac(x) {
      var r = canvas.getBoundingClientRect();
      return Math.max(0, Math.min(1, (x - r.left) / r.width));
    }
    function pos(x) { return buf ? v0 + frac(x) * (v1 - v0) : 0; }
    function zoomIn() {
      holdT = null;
      if (!drag || !buf || zoomed) return;
      var span = Math.min(2, buf.duration / 3), rg = A.range(pad, buf), t = drag === 'start' ? rg[0] : rg[1];
      if (span >= buf.duration || span <= 0) return;
      // la poignée reste sous le doigt
      v0 = Math.max(0, Math.min(buf.duration - span, t - frac(lastX) * span));
      v1 = v0 + span;
      zoomed = true;
      buzz();
      compute(); draw();
    }
    function arm(x) {
      sx = lastX = x;
      if (holdT) clearTimeout(holdT);
      holdT = zoomed ? null : setTimeout(zoomIn, 380);
    }
    function grab(x) {
      if (!buf) return;
      var rg = A.range(pad, buf), t = pos(x);
      drag = Math.abs(t - rg[0]) <= Math.abs(t - rg[1]) ? 'start' : 'end';
      setEdge(drag, t);
      arm(x);
    }
    function move(x) {
      if (!drag) return;
      lastX = x;
      if (Math.abs(x - sx) > 5) arm(x); // le doigt bouge : le compte à rebours du zoom repart
      setEdge(drag, pos(x));
    }
    function release() {
      drag = null;
      if (holdT) { clearTimeout(holdT); holdT = null; }
      if (zoomed) { zoomed = false; compute(); draw(); }
    }
    on(canvas, 'touchstart', function (ev) { ev.preventDefault(); grab(ev.targetTouches[0].clientX); });
    on(canvas, 'touchmove', function (ev) { ev.preventDefault(); if (ev.targetTouches[0]) move(ev.targetTouches[0].clientX); });
    on(canvas, 'touchend', release);
    on(canvas, 'touchcancel', release);
    on(canvas, 'mousedown', function (ev) { grab(ev.clientX); });
    on(window, 'mousemove', function (ev) { if (drag && S.sheets.length) move(ev.clientX); });
    on(window, 'mouseup', function () { if (drag) release(); });
    return {
      reload: function () { headAt = null; zoomed = false; compute(); draw(); },
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
  function newPad(ref) {
    var pi = ref.pi, i = ref.i, pg = B.cfg.pages[pi], sub = ref.s >= 0;
    function make(type, extra, name) {
      refSet(ref, setType({ id: B.uid('p'), name: name || '', color: B.COLORS[(i + (sub ? ref.s + 3 : 0)) % B.COLORS.length] }, type, extra));
      B.saveNow();
    }
    sheet(t(sub ? 'newSub' : 'newPad'), function (body, sh) {
      function big(type, label, note, fn) {
        var b = h('button', 'btn big type sel t' + type);
        add(b, h('div', '', label), h('div', 'note', note));
        on(b, 'click', fn);
        sec(body, '', b);
      }
      function open(opt) { sh.close(); renderAll(); editPad(ref, opt); }
      big('sample', t('newFile'), t('noteSample'), function () {
        pickAudio(function (res, name) { make('sample', sampleFields(res), name); open(); });
      });
      big('sample', t('newRec'), t('noteRec'), function () { make('sample', null, 'REC'); open({ rec: true }); });
      if (!sub) big('mic', t('newMic'), t('noteMic'), function () { make('mic'); open(); });
      big('fx', t('newFx'), t('noteFx'), function () { make('fx'); open(); });
      big('midi', t('newMidi'), t('noteMidi'), function () {
        refSet(ref, B.midi.newClip(B.uid('p'), B.COLORS[(i + 4) % B.COLORS.length]));
        B.saveNow(); open();
      });
      if (sub) {
        var del = h('button', 'btn danger', t('hubDel'));
        on(del, 'click', function () {
          ask(t('askHubDel'), t('doDel'), function () {
            pg.pads[i].subs.forEach(function (q) { if (q) { A.stop(q.id, false, true); A.padFx(q, false); } });
            pg.pads[i] = null;
            sh.close(); renderAll();
            B.saveNow().then(B.gc);
          });
        });
        sec(body, 'HUB', del);
        return;
      }
      // un widget prend toute la largeur : on cherche des rangées libres à partir de la case touchée
      function widget(type, name, color, extra) {
        var rows = B.ROWS[type], a, at = -1;
        function free(x) { for (var k = x; k < x + 2 * rows; k++) if (pg.pads[k] || B.cover(pg, k) >= 0) return false; return true; }
        for (a = Math.min(B.SLOTS - 2 * rows, i - i % 2); a >= 0 && at < 0; a -= 2) if (free(a)) at = a;
        if (at < 0) { toast(t('plRoom', rows * 2), 3500); return; }
        pg.pads[at] = { id: B.uid('p'), type: type, name: name, color: color };
        for (var xk in extra || {}) pg.pads[at][xk] = extra[xk];
        B.saveNow(); sh.close(); renderAll(); playerPoll();
      }
      big('deck', t('newDeck'), t('noteDeck'), function () { widget('deck', t('typeDeck'), '#37474F'); });
      big('player', 'PHONE CONTROL', t('notePlayer'), function () { widget('player', 'PHONE CONTROL', '#2E7D32'); });
      big('keys', t('typeKeys'), t('noteKeys'), function () { widget('keys', t('typeKeys'), '#263238', B.midiUI.newKeys()); });
      big('bpm', 'BPM CONTROL', t('noteBpm'), function () {
        pg.pads[i] = { id: B.uid('p'), type: 'bpm', name: 'BPM', color: '#212121' };
        B.saveNow(); sh.close(); renderAll();
      });
      big('hub', t('newHub'), t('noteHub'), function () {
        pg.pads[i] = { id: B.uid('p'), type: 'hub', name: '', color: '#000000', subs: [null, null, null, null] };
        B.saveNow(); sh.close(); renderAll();
      });
    });
  }

  // Sur quoi agissent les effets : soundboard, musique du lecteur, ou les deux.
  function targetChoice(done) {
    var row = choice([['pads', t('tg.pads')], ['music', t('tg.music')], ['all', t('tg.all')]], B.cfg.fxTarget, function (g) {
      B.cfg.fxTarget = g;
      A.setTarget(g);
      A.setFx(B.cfg.fx.type, B.cfg.fx.amt);
      renderFx(); B.save();
      if (done) done();
    });
    row.className = 'row tight';
    return row;
  }
  function fxParLabel(f, key) {
    var v = B.fxVal(f), set = B.cfg.fxSet[f] || B.FX_DEF[f];
    if (key === 'max') return Math.round(v.max * 100) + ' %';
    if (key === 'echoTime') return Math.round(v.time * 1000) + ' ms';
    if (key === 'flRate') return v.rate.toFixed(2) + ' Hz';
    if (key === 'rate') return v.hz.toFixed(1) + ' Hz';
    if (key === 'range') return '\u00b1 ' + v.st + ' ' + t('semi');
    return Math.round((key === 'repeats' ? set[1] : set[0]) * 100) + ' %';
  }
  // Liste des effets du curseur : chacun se coche, et se déplie pour ses réglages.
  function fxPanel(body) {
    var box = h('div');
    B.FX.forEach(function (f) {
      var row = h('div', 'row fxRow'), b = h('button', 'btn', t('fx.' + f)), more = h('button', 'btn more', '\u25be');
      var panel = h('div', 'fxSet'), paints = [];
      // coché : le bouton prend la couleur de l'effet
      function paint() {
        var act = B.cfg.fxList.indexOf(f) >= 0, c = B.FX_COLOR[f];
        b.className = 'btn';
        b.style.background = act ? c : ''; b.style.color = act ? ink(c) : '';
        b.style.boxShadow = act ? '' : 'inset 8px 0 0 ' + c;
      }
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
      B.FX_PAR[f].forEach(function (key, k) {
        var sl = rangeS(function () { return (B.cfg.fxSet[f] || B.FX_DEF[f])[k]; }, function (v) {
          var cur = (B.cfg.fxSet[f] || B.FX_DEF[f]).slice();
          cur[k] = Math.round(v * 100) / 100;
          B.cfg.fxSet[f] = cur;
          A.setFx(B.cfg.fx.type, B.cfg.fx.amt);
          B.save();
        }, function () { return fxParLabel(f, key); });
        paints.push(sl.paint);
        add(panel, h('div', 'secLbl', t('fxp.' + key)), sl);
      });
      var reset = h('button', 'btn gap', t('fxFactory'));
      on(reset, 'click', function () {
        delete B.cfg.fxSet[f];
        paints.forEach(function (p) { p(); });
        A.setFx(B.cfg.fx.type, B.cfg.fx.amt);
        B.save();
      });
      add(panel, reset);
      panel.style.display = 'none';
      on(more, 'click', function () {
        var open = panel.style.display === 'none';
        panel.style.display = open ? '' : 'none';
        more.textContent = open ? '\u25b4' : '\u25be';
        more.className = 'btn more' + (open ? ' on' : '');
      });
      add(box, add(row, b, more), panel);
    });
    sec(body, t('fxList'), box, h('div', 'note', t('fxNote')));
  }
  // Appui long sur le bouton FX : cible des effets, effets disponibles et leurs réglages.
  function openTarget() {
    sheet(t('fxSheet'), function (body) {
      sec(body, t('fxTarget'), targetChoice(), h('div', 'note', t('fxTargetNote')));
      fxPanel(body);
    }, renderFx);
  }

  // Curseur fin d'une feuille de réglages.
  function rangeS(get, set, label) {
    var s = h('div', 'slider slim'), f = h('div', 'fill'), l = h('div', 'lbl');
    function paint() { f.style.width = (get() * 100) + '%'; l.textContent = label(); }
    paint();
    slider(s, function (v) { set(v); paint(); }, true);
    s.paint = paint;
    return add(s, f, l);
  }

  // Éditeur des widgets de musique.
  function editWidget(pi, i) {
    var pg = B.cfg.pages[pi], pad = pg.pads[i], deck = pad.type === 'deck';
    sheet(deck ? t('typeDeck') : 'PHONE CONTROL', function (body, sh) {
      sec(body, '', h('div', 'note', t(deck ? 'dkHelp' : 'plHelp')));
      if (!deck && NATIVE && window.BoucanNative.playerCmd) {
        var pb = h('button', 'btn accent', t('plAllow'));
        on(pb, 'click', function () { window.BoucanNative.playerCmd('perm'); });
        sec(body, t('plAccess'), pb, h('div', 'note', t('plAccessNote')));
      }
      sec(body, t('color'), swatches(pad.color, function (c) { pad.color = c; renderGrid(); B.save(); }));
      if (deck) {
        sec(body, t('fxTarget'), targetChoice(), h('div', 'note', t('fxTargetNote')));
        var rootB = h('button', 'btn', '');
        var rootLbl = function () { rootB.textContent = rootLabel(B.cfg.deck.root); };
        on(rootB, 'click', function () { openRoots(rootLbl); });
        rootLbl();
        sec(body, t('dkRoot'), rootB, h('div', 'note', t('dkRootHelp')));
        sec(body, t('dkBrake'), rangeS(function () { return B.cfg.deck.brake / 2; }, function (v) {
          B.cfg.deck.brake = Math.round(v * 20) / 10; B.save();
        }, function () { return B.cfg.deck.brake ? B.cfg.deck.brake.toFixed(1) + ' s' : t('none'); }), h('div', 'note', t('dkBrakeNote')),
          check(t('dkXspin'), B.cfg.deck.xspin, function (v) { B.cfg.deck.xspin = v; B.save(); }));
      }
      sec(body, t('duckSec'), choice([['none', t('duckNone')], ['duck', t('duckDuck')], ['pause', t('duckPause')]], B.cfg.duck, function (m) {
        B.cfg.duck = m; B.save();
      }), h('div', 'note', t('duckNote')));
      sec(body, t('duckFade'), rangeS(function () { return B.cfg.duckFade / 2; }, function (v) {
        B.cfg.duckFade = Math.round(v * 40) / 20; B.save();
      }, function () { return B.cfg.duckFade.toFixed(2) + ' s'; }), h('div', 'note', t('duckFadeNote')));
      var clear = h('button', 'btn danger', t('clear'));
      on(clear, 'click', function () {
        ask(t('askClear', deck ? t('typeDeck') : 'PHONE CONTROL'), t('doClear'), function () { pg.pads[i] = null; sh.close(); });
      });
      sec(body, t('padSec'), clear);
    }, function () { B.saveNow(); renderAll(); });
  }

  function editPad(ref, opt) {
    var pi = ref.pi, i = ref.i, pad = refGet(ref);
    if (!pad) return;
    if (pad.type === 'midi') { B.midiUI.edit(ref); return; }
    if (pad.type === 'bpm') { editBpm(ref); return; }
    if (pad.type === 'keys') { B.midiUI.editKeys(ref); return; }
    if (B.ROWS[pad.type]) { editWidget(pi, i); return; }
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
      slider(s, function (v) { set(v); paint(); }, true);
      s.paint = paint;
      return add(s, f, l);
    }
    // Volume : à 100 % tant qu'on ne coche pas « volume personnalisé ».
    function volume(body) {
      function setVol(v) {
        pad.vol = v;
        var cur = A.voices[pad.id];
        if (cur) { try { A.freeze(cur.g.gain, A.ctx.currentTime); cur.g.gain.setTargetAtTime(v, A.ctx.currentTime, 0.02); } catch (e) {} }
        B.save();
      }
      var sl = range01('slim', function () { return pad.vol / 1.5; }, function (v) {
        v = Math.round(v * 30) / 20;
        setVol(Math.abs(v - 1) <= 0.1 ? 1 : v); // aimanté à 100 %
      }, function () { return Math.round(pad.vol * 100) + ' %'; });
      sl.style.marginTop = '8px';
      sl.style.display = pad.vol !== 1 ? '' : 'none';
      sec(body, t('volume'), check(t('volCustom'), pad.vol !== 1, function (v) {
        if (!v) setVol(1);
        sl.paint();
        sl.style.display = v ? '' : 'none';
      }), sl);
    }

    // Prise micro d'un sample : on garde la prise brute pour régler le débruiteur après coup.
    var denT = null;
    function reprocess() {
      return A.load(pad.rawSample).then(function (raw) {
        if (!raw) return;
        var out = B.denoise(raw.getChannelData(0), raw.sampleRate, pad.denoise || 0);
        if (pad.enhance) out = B.enhance(out, raw.sampleRate);
        return A.storeBuffer(A.pcmBuffer(out, raw.sampleRate)).then(function (r) {
          var first = !pad.sample;
          pad.sample = r.id;
          if (first || pad.end === undefined) { var tr = A.autoTrim(r.buffer); pad.start = tr[0]; pad.end = tr[1]; }
          if (wave) wave.reload();
          times(); show();
        });
      });
    }

    sheet(t('pad') + ' ' + (i + 1) + (ref.s >= 0 ? '.' + (ref.s + 1) : ''), function (body, sh) {
      function reopen() { sh.close(); editPad(ref); }

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
        sec(body, '', check(t('enhance'), !!pad.enhance, function (v) { pad.enhance = v; B.save(); }), h('div', 'note', t('enhanceMicNote')));
        volume(body);
      } else if (type === 'fx') {
        var grid = h('div', 'sw two'), fxBtns = [];
        B.PAD_FX.forEach(function (f) {
          var b = h('button', 'btn' + (f === pad.fx ? ' on' : ''), t('pfx.' + f));
          on(b, 'click', function () {
            A.padFx(pad, false);
            if (!pad.name || pad.name === t('pfx.' + pad.fx)) pad.name = t('pfx.' + f);
            pad.fx = f;
            delete pad.p1; delete pad.p2;
            fxParams();
            fxBtns.forEach(function (x) { x.className = 'btn'; });
            b.className = 'btn on';
            fxNote.textContent = t('pfxNote.' + f);
            B.saveNow(); show();
            body.querySelector('.field').value = pad.name;
          });
          fxBtns.push(b);
          add(grid, add(h('div'), b));
        });
        var fxNote = h('div', 'note', t('pfxNote.' + pad.fx)), parBox = h('div');
        var fxParams = function () {
          parBox.innerHTML = '';
          B.PAD_FX_PAR[pad.fx].forEach(function (key, k) {
            var pk = 'p' + (k + 1), def = B.PAD_FX_DEF[pad.fx][k] || 0;
            var lbl = h('div', 'secLbl', t('par.' + key));
            lbl.style.marginTop = '12px';
            add(parBox, lbl, range01('slim', function () { return typeof pad[pk] === 'number' ? pad[pk] : def; }, function (v) {
              A.padFx(pad, false);
              pad[pk] = Math.round(v * 50) / 50;
              B.save();
            }, function () { return parLabel(pad, key);             }));
          });
        };
        fxParams();
        sec(body, t('effect'), grid, fxNote, parBox);
        var fh = h('div', 'note', t('hint.fx' + pad.mode));
        sec(body, t('trigger'), choice([['gate', t('mode.gate')], ['toggle', t('mode.toggle')]], pad.mode, function (m) {
          A.padFx(pad, false); pad.mode = m; fh.textContent = t('hint.fx' + m); show();
        }), fh);
        sec(body, '', check(t('fxLive'), !!pad.live, function (v) { pad.live = v; B.save(); }), h('div', 'note', t('fxLiveNote')));
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
          sec(body, '', check(t('enhance'), !!pad.enhance, function (v) {
            pad.enhance = v; halt();
            reprocess()['catch'](function () {});
          }), h('div', 'note', t('enhanceNote')));
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
      sec(body, t('padType'), typeChoice(type, ref.s >= 0, function (ty) {
        if (ty === type) return;
        halt(); A.padFx(pad, false);
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
        S.moving = { ref: ref, pad: pad };
        renderAll();
      });
      on(clear, 'click', function () {
        ask(t('askClear', pad.name || i + 1), t('doClear'), function () {
          refSet(ref, null);
          halt(); A.padFx(pad, false);
          sh.close();
        });
      });
      sec(body, t('padSec'), move, clear);
      // « sample depuis le micro » : la prise démarre tout de suite
      if (opt && opt.rec && type === 'sample') micB.click();

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
      var still = refGet(ref) === pad && (pad.type || 'sample') === 'sample';
      // sample créé pour une prise micro qui n'a pas eu lieu : la case redevient vide
      if (still && !pad.sample) { refSet(ref, null); still = false; }
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
          pg.pads.forEach(function (p) { if (p) { A.stop(p.id, false, true); A.padFx(p, false); if (p.type === 'midi') B.midi.stop(p); } });
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
          page().pads.forEach(function (p, i) { if (inCell(p, function (q) { return q.sample === id; })) renderPad(i); });
        })['catch'](function () {}).then(function () { setTimeout(next, 0); });
      })();
    });
  }

  // withMusic : joindre aussi les morceaux du dossier source du lecteur.
  // withMusic : joindre aussi les morceaux du dossier source du lecteur.
  // tagsOnly : seulement les couleurs, commentaires et points de départ des morceaux.
  function doExport(action, withMusic, tagsOnly) {
    var music = withMusic && !tagsOnly ? B.deck.exportList() : [];
    busy(t('makingFile'));
    setTimeout(function () {
      (NATIVE ? B.nativeExport(action, music, function (k, n) { busy(t('exMusic') + ' ' + k + '/' + n); }, tagsOnly) : B.webExport(tagsOnly)).then(function () {
        if (!NATIVE) { idle(); toast(t('downloaded')); }
      }, function (e) {
        idle();
        toast(t('exportFail') + (e && e.message || e), 4000);
      });
    }, 60);
  }

  function doImport() {
    pick(el.fileConfig, function (f) {
      busy(t('readingFile'));
      B.readExport(f).then(function (parsed) {
        idle();
        if (parsed.tags) {
          // fichier d'étiquettes seules : on les fusionne, le reste de la config ne bouge pas
          ask(t('askTags'), t('doTags'), function () {
            B.applyTags(parsed.tags).then(function (n) { B.deck.load(); closeSheets(); renderAll(); toast(t('tagsDone', n), 3000); });
          });
          return;
        }
        ask(t('askImport') + (parsed.music.length ? ' ' + t('askImportMusic', parsed.music.length) : ''), t('doImport'), function () {
          busy(t('importingCfg'));
          B.applyImport(parsed).then(function () {
            return B.importMusic(parsed.music, function (k, n) { busy(t('imMusic') + ' ' + k + '/' + n); });
          }).then(function (n) {
            if (n || parsed.music.length) B.deck.afterImport(parsed.music); else B.deck.load();
            B.lang = B.cfg.lang; tellLang();
            A.setTarget(B.cfg.fxTarget);
            A.setFx(B.cfg.fx.type, B.cfg.fx.amt);
            closeSheets();
            S.edit = false; S.moving = null;
            renderAll(); idle();
            toast(parsed.music.length && !n && !(NATIVE && window.BoucanNative.musicImportBegin) ? t('imNoMusic') : t('imported'), 3500);
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

  // Petite feuille pour saisir un nom.
  function askName(title, value, cb) {
    var name = value;
    sheet(title, function (body) {
      var f = field(value, 16, function (v) { name = v; });
      sec(body, t('name'), f);
      setTimeout(function () { try { f.focus(); } catch (e) {} }, 150);
    }, function () { if (name) cb(name); });
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  // Remplace toutes les pages (chargement d'un set, set vide).
  function swapPages(pages) {
    A.stopAll();
    B.cfg.pages = pages;
    B.cfg.cur = 0;
    S.moving = null;
    return B.saveNow().then(B.gc).then(function () { closeSheets(); renderAll(); return loadBuffers(); });
  }
  // Sets de pages : toutes les pages d'un coup, à enregistrer et à recharger.
  function setsSection(body, refresh) {
    var box = h('div');
    function b(label, cls, fn) { var e = h('button', 'btn gap' + (cls ? ' ' + cls : ''), label); on(e, 'click', fn); return e; }
    B.cfg.sets.forEach(function (st, k) {
      add(box, b(st.name + '  (' + st.pages.length + ' ' + t('setPages') + ')', 'lst', function () {
        sheet(st.name, function (bd, sh) {
          sec(bd, '', b(t('setLoad'), 'accent', function () {
            ask(t('askSetLoad', st.name), t('setLoad'), function () { swapPages(clone(st.pages)); });
          }), b(t('setOver'), '', function () {
            ask(t('askSetOver', st.name), t('setOver'), function () { st.pages = clone(B.cfg.pages); B.saveNow(); sh.close(); refresh(); toast(t('setSaved')); });
          }), b(t('setDel'), 'danger', function () {
            ask(t('askSetDel', st.name), t('doDel'), function () { B.cfg.sets.splice(k, 1); B.saveNow().then(B.gc); sh.close(); refresh(); });
          }), h('div', 'note', t('setNote')));
        });
      }));
    });
    sec(body, t('sets'), b(t('setSave'), '', function () {
      if (B.cfg.sets.length >= B.MAX_SETS) { toast(t('setMax')); return; }
      askName(t('setSave'), 'SET ' + (B.cfg.sets.length + 1), function (name) {
        B.cfg.sets.push({ name: name, pages: clone(B.cfg.pages) });
        B.saveNow(); refresh(); toast(t('setSaved'));
      });
    }), b(t('setNew'), '', function () {
      ask(t('askSetNew'), t('setNew'), function () { swapPages([B.newPage(1)]); });
    }), box, h('div', 'note', t('setsNote')));
  }

  function openMenu() {
    sheet('BOUCAN', function (body, sh) {
      function btn(label, cls, fn) { var b = h('button', 'btn gap' + (cls ? ' ' + cls : ''), label); on(b, 'click', fn); return b; }
      if (NATIVE) {
        var exList = B.deck.state === 'ok' ? B.deck.exportList() : [], exSize = 0, exOn = false;
        exList.forEach(function (m) { exSize += m.size; });
        var exChk = check(t('exWith', exList.length + ' ' + t('tracks') + ', ' + Math.max(1, Math.round(exSize / 1048576))), false, function (v) { exOn = v; });
        if (!exList.length) exChk.style.display = 'none';
        sec(body, t('transfer'), exChk,
          btn(t('send'), '', function () { doExport('share', exOn); }),
          btn(t('saveFile'), '', function () { doExport('save', exOn); }),
          btn(t('exTags'), '', function () { doExport('share', false, true); }),
          btn(t('importCfg'), '', doImport),
          h('div', 'note', t('transferNote')));
      } else {
        sec(body, t('transfer'),
          btn(t('exportCfg'), '', function () { doExport('save'); }),
          btn(t('exTags'), '', function () { doExport('save', false, true); }),
          btn(t('importCfg'), '', doImport),
          h('div', 'note', t('transferNote')));
      }

      var mdB = btn('', '', function () { B.midiUI.openSettings(mdLbl); });
      function mdLbl() { mdB.textContent = B.cfg.midi.bpm + ' BPM  ·  ' + B.midi.KEYS[B.cfg.midi.root] + ' ' + t('sc.' + B.cfg.midi.scale); }
      mdLbl();
      sec(body, t('mdSet'), mdB, h('div', 'note', t('mdSetNote')),
        check(t('syncMode'), B.cfg.sync, function (v) { B.cfg.sync = v; B.save(); if (v) B.deck.analyse(); B.midi.poll(); }),
        h('div', 'note', t('syncNote')),
        check(t('fxSync'), B.cfg.fxSync, function (v) { B.cfg.fxSync = v; B.save(); A.refx(); }),
        h('div', 'note', t('fxSyncNote')),
        check(t('autoKey'), B.cfg.autoKey, function (v) { B.cfg.autoKey = v; B.save(); if (v) B.deck.analyseKey(); B.midi.poll(); }),
        h('div', 'note', t('autoKeyNote')));

      setsSection(body, function () { sh.close(); openMenu(); });

      sec(body, t('fxTarget'), targetChoice(), h('div', 'note', t('fxTargetNote')));

      fxPanel(body);

      sec(body, t('lang'), choice(B.LANGS, B.lang, function (l) {
        B.lang = B.cfg.lang = l;
        B.save(); tellLang();
        sh.close(); renderAll(); openMenu();
      }));

      var vib = btn('', '', function () { B.cfg.vibrate = !B.cfg.vibrate; vibLbl(); B.save(); buzz(); });
      function vibLbl() { vib.textContent = t(B.cfg.vibrate ? 'vibOn' : 'vibOff'); vib.className = 'btn' + (B.cfg.vibrate ? ' on' : ''); }
      vibLbl();
      var swp = btn('', '', function () { B.cfg.swipe = !B.cfg.swipe; swpLbl(); B.save(); });
      function swpLbl() { swp.textContent = t(B.cfg.swipe ? 'swipeOn' : 'swipeOff'); swp.className = 'btn gap' + (B.cfg.swipe ? ' on' : ''); }
      swpLbl();
      var eh = btn('', '', function () { B.cfg.editHold = !B.cfg.editHold; ehLbl(); B.save(); });
      function ehLbl() { eh.textContent = t(B.cfg.editHold ? 'editHoldOn' : 'editHoldOff'); eh.className = 'btn gap' + (B.cfg.editHold ? ' on' : ''); }
      ehLbl();
      var sm = btn('', '', function () { B.cfg.stopMusic = !B.cfg.stopMusic; smLbl(); B.save(); });
      function smLbl() { sm.textContent = t(B.cfg.stopMusic ? 'stopMusicOn' : 'stopMusicOff'); sm.className = 'btn gap' + (B.cfg.stopMusic ? ' on' : ''); }
      smLbl();
      var qk = btn('', '', function () { B.cfg.quickAdd = !B.cfg.quickAdd; qkLbl(); B.save(); renderGrid(); });
      function qkLbl() { qk.textContent = t(B.cfg.quickAdd ? 'quickOn' : 'quickOff'); qk.className = 'btn gap' + (B.cfg.quickAdd ? ' on' : ''); }
      qkLbl();
      sec(body, t('settings'), vib, swp, eh, sm, qk);

      // Audio : tampon et fréquence, propres à ce téléphone (hors config exportée).
      var ap = B.audioPrefs(), setAudio = function (k, v) {
        ap[k] = v;
        if (!B.setAudioPrefs(ap)) { toast(t('saveFail')); return; }
        // le moteur audio se recrée au redémarrage de la page
        busy(t('auRestart'));
        A.stopAll();
        B.saveNow().then(function () { setTimeout(function () { window.location.reload(); }, 300); });
      };
      var latRow = choice([['low', t('au.low')], ['mid', t('au.mid')], ['high', t('au.high')]], ap.lat, function (v) { setAudio('lat', v); });
      var srRow = choice(B.RATES.map(function (r) { return [r, r ? (r / 1000) + ' k' : 'AUTO']; }), ap.sr, function (v) { setAudio('sr', v); });
      latRow.className = srRow.className = 'row tight';
      var lat = A.ctx.baseLatency ? ', ' + Math.round(((A.ctx.baseLatency || 0) + (A.ctx.outputLatency || 0)) * 1000) + ' ms' : '';
      sec(body, t('auLat'), latRow, h('div', 'note', t('auLatNote')));
      sec(body, t('auRate'), srRow, h('div', 'note', t('auRateNote', A.ctx.sampleRate + ' Hz' + lat)));

      sec(body, t('reset'), btn(t('resetBtn'), 'danger', function () {
        ask(t('askReset'), t('doReset'), function () {
          factoryReset().then(function () {
            A.setTarget(B.cfg.fxTarget);
            A.setFx(B.cfg.fx.type, B.cfg.fx.amt);
            closeSheets();
            S.edit = false;
            renderAll(); idle();
            return loadBuffers();
          })['catch'](function (e) { idle(); toast(t('error') + (e && e.message || e), 4000); });
        });
      }));
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
    ['grid', 'tabs', 'toast', 'busy', 'busyTxt', 'fx', 'rec', 'recBox', 'recWave', 'recTxt', 'recHint', 'recBin', 'adj', 'adjMini', 'adjBox', 'adjPie', 'adjTxt', 'adjName', 'fxBand', 'fxLbl', 'fxBtn', 'menuBtn', 'stopBtn', 'editBtn', 'editLbl', 'hint', 'fileAudio', 'fileConfig']
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
      A.setTarget(B.cfg.fxTarget);
      A.setFx(B.cfg.fx.type, B.cfg.fx.amt);
      renderAll();
      idle();
      if (B.volatile) toast(t('noStore'), 6000);
      B.deck.onChange = deckPaintAll;
      B.deck.load();
      setInterval(playerPoll, 1000);
      setInterval(bpmTick, 50);
      on(document, 'visibilitychange', function () { playerPoll(); if (!document.hidden) B.deck.pump(); });
      return loadBuffers();
    })['catch'](function (e) {
      fatal(t('bootFail') + (e && e.message || e));
    });
  }

  // Boîte à outils pour les modules d'interface chargés après celui-ci (midiui.js).
  B.ui = { h: h, add: add, on: on, sheet: sheet, sec: sec, choice: choice, check: check, rangeS: rangeS, swatches: swatches, field: field,
    toast: toast, ask: ask, buzz: buzz, ink: ink, refGet: refGet, refSet: refSet, renderAll: renderAll, state: S };
  B.ui.playSvg = SVG_PLAY; B.ui.pauseSvg = SVG_PAUSE; B.ui.gauge = gauge; B.ui.gaugeHide = adjHide; B.ui.gaugeMini = gaugeMini; B.ui.gaugeMiniHide = gaugeMiniHide;
  // gamme automatique : quand la gamme change, les noms des touches et des notes suivent
  B.midi.onKey = function () { if (B.cfg) renderGrid(); };

  if (document.readyState === 'loading') on(document, 'DOMContentLoaded', boot); else boot();
})(window.Boucan);
