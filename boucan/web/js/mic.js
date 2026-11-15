/*
 * Boucan — micro : débruiteur spectral et capture.
 *
 * Débruiteur : transformée de Fourier à court terme (fenêtres de 512
 * échantillons, recouvrement 50 %), estimation du bruit de fond par suivi des
 * minima, gain de Wiener avec lissage « decision-directed » (peu de bruit
 * musical). Pensé pour une voix proche du micro dans un environnement bruyant :
 * plus l'intensité monte, plus ce qui n'émerge pas nettement du fond est éteint.
 * ES5 uniquement.
 */
(function (B) {
  'use strict';

  var N = 512, HOP = 256, HALF = N / 2;
  var cosT = new Float32Array(HALF), sinT = new Float32Array(HALF), rev = new Uint16Array(N), win = new Float32Array(N);
  (function () {
    var i, j, k;
    for (i = 0; i < HALF; i++) { cosT[i] = Math.cos(2 * Math.PI * i / N); sinT[i] = Math.sin(2 * Math.PI * i / N); }
    for (i = 0; i < N; i++) {
      for (j = 0, k = i, rev[i] = 0; j < 9; j++) { rev[i] = (rev[i] << 1) | (k & 1); k >>= 1; }
      win[i] = Math.sqrt(0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)); // racine de Hann
    }
  })();

  // FFT radix 2 en place (inv : transformée inverse, normalisée).
  function fft(re, im, inv) {
    var i, j, k, len, half, step, tr, ti, wr, wi;
    for (i = 0; i < N; i++) {
      j = rev[i];
      if (j > i) { tr = re[i]; re[i] = re[j]; re[j] = tr; tr = im[i]; im[i] = im[j]; im[j] = tr; }
    }
    for (len = 2; len <= N; len <<= 1) {
      half = len >> 1; step = N / len;
      for (i = 0; i < N; i += len) {
        for (j = 0, k = 0; j < half; j++, k += step) {
          wr = cosT[k]; wi = inv ? sinT[k] : -sinT[k];
          tr = re[i + j + half] * wr - im[i + j + half] * wi;
          ti = re[i + j + half] * wi + im[i + j + half] * wr;
          re[i + j + half] = re[i + j] - tr; im[i + j + half] = im[i + j] - ti;
          re[i + j] += tr; im[i + j] += ti;
        }
      }
    }
    if (inv) for (i = 0; i < N; i++) { re[i] /= N; im[i] /= N; }
  }

  // Débruiteur en flux : process(entrée, sortie) sur des blocs de taille quelconque.
  // Retard : N échantillons (environ 11 ms).
  B.denoiser = function (sr, strength) {
    var s = Math.max(0, Math.min(1, strength));
    var hist = new Float32Array(N), ola = new Float32Array(N), inQ = new Float32Array(HOP), outQ = new Float32Array(HOP);
    var re = new Float32Array(N), im = new Float32Array(N), q = 0, frames = 0;
    var bins = HALF + 1, S = new Float32Array(bins), Smin = new Float32Array(bins), Stmp = new Float32Array(bins);
    var Gp = new Float32Array(bins), postP = new Float32Array(bins), i;
    for (i = 0; i < bins; i++) Gp[i] = 1;
    var over = 1.5 + 6 * s;                     // sur-estimation du bruit
    var floor = Math.pow(10, -(34 * s) / 20);   // atténuation maximale (jusqu'à -34 dB)
    var cutBin = Math.floor(90 * N / sr);       // coupe le grondement / le vent
    var span = Math.max(8, Math.round(0.8 * sr / HOP)); // fenêtre de suivi des minima (0,8 s)

    function frame() {
      var k, p, n, post, prio, g;
      hist.set(hist.subarray(HOP)); hist.set(inQ, N - HOP);
      for (k = 0; k < N; k++) { re[k] = hist[k] * win[k]; im[k] = 0; }
      if (s > 0) {
        fft(re, im, false);
        for (k = 0; k < bins; k++) {
          p = re[k] * re[k] + im[k] * im[k];
          if (frames === 0) { S[k] = Smin[k] = Stmp[k] = p; }
          S[k] = 0.8 * S[k] + 0.2 * p;
          if (frames % span === 0) { Smin[k] = Math.min(Stmp[k], S[k]); Stmp[k] = S[k]; }
          else { if (S[k] < Smin[k]) Smin[k] = S[k]; if (S[k] < Stmp[k]) Stmp[k] = S[k]; }
          n = Smin[k] * over + 1e-12;
          post = p / n;
          prio = 0.92 * Gp[k] * Gp[k] * postP[k] + 0.08 * (post > 1 ? post - 1 : 0);
          g = prio / (1 + prio);
          if (g < floor) g = floor;
          if (k < cutBin) g = 0;
          Gp[k] = g; postP[k] = post;
          re[k] *= g; im[k] *= g;
          if (k > 0 && k < HALF) { re[N - k] *= g; im[N - k] *= g; }
        }
        fft(re, im, true);
      }
      for (k = 0; k < N; k++) ola[k] += re[k] * win[k];
      outQ.set(ola.subarray(0, HOP));
      ola.set(ola.subarray(HOP)); for (k = N - HOP; k < N; k++) ola[k] = 0;
      frames++;
    }
    return {
      process: function (inp, out) {
        for (var k = 0; k < inp.length; k++) {
          inQ[q] = inp[k];
          out[k] = outQ[q];
          if (++q === HOP) { q = 0; frame(); }
        }
      }
    };
  };

  // Débruitage d'un enregistrement entier (compense le retard du flux).
  B.denoise = function (pcm, sr, strength) {
    if (!(strength > 0)) return pcm;
    var d = B.denoiser(sr, strength), padded = new Float32Array(pcm.length + N), out = new Float32Array(pcm.length + N);
    padded.set(pcm);
    d.process(padded, out);
    return out.subarray(N);
  };

  // ====================== Capture ======================
  var A = B.audio;
  var M = B.mic = { stream: null, on: false, peaks: [], seconds: 0 };
  var src = null, proc = null, out = null, den = null, chunks = null, live = false, closeT = null, tmp = null;
  var MAX_SEC = 90;

  function open() {
    if (M.stream) return Promise.resolve();
    var md = navigator.mediaDevices;
    if (!md || !md.getUserMedia) return Promise.reject(new Error('nomic'));
    // Pas de traitement « appel téléphonique » d'Android : il coupe la musique
    // et dégrade le son. Le débruitage est fait ici.
    return md.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false }).then(function (st) {
      var ctx = A.ctx;
      M.stream = st;
      src = ctx.createMediaStreamSource(st);
      proc = ctx.createScriptProcessor(1024, 1, 1);
      out = ctx.createGain();
      proc.onaudioprocess = function (ev) {
        var inp = ev.inputBuffer.getChannelData(0), o = ev.outputBuffer.getChannelData(0), k, pk = 0, v;
        if (!M.on) { for (k = 0; k < o.length; k++) o[k] = 0; return; }
        if (!tmp || tmp.length !== inp.length) tmp = new Float32Array(inp.length);
        den.process(inp, tmp);
        for (k = 0; k < tmp.length; k++) { v = tmp[k]; if (v < 0) v = -v; if (v > pk) pk = v; }
        M.peaks.push(pk);
        M.seconds += inp.length / ctx.sampleRate;
        if (live) { o.set(tmp); return; }
        for (k = 0; k < o.length; k++) o[k] = 0;
        if (M.seconds < MAX_SEC) chunks.push(new Float32Array(tmp));
      };
      src.connect(proc); proc.connect(out); out.connect(A.bus);
    });
  }
  function close() {
    closeT = null;
    if (M.on || !M.stream) return;
    try { M.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
    try { src.disconnect(); proc.disconnect(); out.disconnect(); proc.onaudioprocess = null; } catch (e2) {}
    M.stream = src = proc = out = null;
  }

  // o : denoise 0..1, live (retour direct dans les enceintes), vol.
  M.start = function (o) {
    A.resume();
    if (closeT) { clearTimeout(closeT); closeT = null; }
    return open().then(function () {
      den = B.denoiser(A.ctx.sampleRate, o.denoise || 0);
      chunks = []; M.peaks = []; M.seconds = 0;
      live = !!o.live;
      out.gain.value = live ? (o.vol === undefined ? 1 : o.vol) : 0;
      if (live && A.unkill) A.unkill();
      M.on = true;
    });
  };

  // Arrête la capture ; renvoie l'enregistrement (null en direct ou si annulé).
  M.stop = function (cancel) {
    var was = M.on, got = chunks, n = 0, k, off = 0, pcm = null;
    M.on = false; chunks = null;
    if (closeT) clearTimeout(closeT);
    closeT = setTimeout(close, 20000); // le micro se referme après 20 s sans usage
    if (!was || cancel || live || !got || !got.length) return null;
    for (k = 0; k < got.length; k++) n += got[k].length;
    pcm = new Float32Array(n);
    for (k = 0; k < got.length; k++) { pcm.set(got[k], off); off += got[k].length; }
    return pcm;
  };
})(window.Boucan);
