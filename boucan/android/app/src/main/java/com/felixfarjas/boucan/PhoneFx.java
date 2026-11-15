package com.felixfarjas.boucan;

import android.content.Context;
import android.media.audiofx.DynamicsProcessing;
import android.media.audiofx.EnvironmentalReverb;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Map;

/**
 * Effets sur le son des AUTRES applis (Spotify, lecteur de musique…).
 *
 * Une app ne peut pas toucher directement au son d'une autre. Android offre
 * deux portes, toutes deux utilisées ici :
 *  - la session audio d'une appli, quand celle-ci l'annonce (voir
 *    {@link SessionReceiver}) : l'effet ne touche que cette appli ;
 *  - la session 0, le mélange de sortie de tout le téléphone : l'effet touche
 *    tout ce qui sort, Boucan compris.
 *
 * Les filtres, le hachoir, le cut et le freinage passent par un
 * DynamicsProcessing (égaliseur + gain d'entrée), la reverb par un
 * EnvironmentalReverb. Android 9 (API 28) au minimum.
 */
final class PhoneFx {

    /** Bord haut de chaque bande de l'égaliseur, en Hz. */
    private static final float[] EDGE = {40, 80, 160, 300, 500, 800, 1200, 1800, 2700, 4000, 6000, 9000, 13000, 20000};
    private static final int TICK_MS = 20;
    private static final int PRIORITY = 1000;

    private static final class Chain {
        DynamicsProcessing dp;
        EnvironmentalReverb rv;
    }

    private final Context ctx;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ArrayList<Chain> chains = new ArrayList<Chain>();
    private String mode = "off";
    private String apps = "";
    private String err = "";

    // consignes venues de la page
    private float tHc, tLc, tRev, gateHz, gateDepth;
    private boolean kill;
    private int brakeMs, sweepMs = 30;
    // état courant (lissé)
    private float cHc, cLc, cRev, brakeP, gatePhase;
    // dernières valeurs envoyées aux effets
    private final float[] sentBand = new float[EDGE.length];
    private float sentGain, sentRev;
    private boolean sentOn, sentRevOn;
    private boolean ticking;
    private long lastTick;

    PhoneFx(Context ctx) {
        this.ctx = ctx.getApplicationContext();
    }

    private final Runnable ticker = new Runnable() {
        @Override
        public void run() {
            tick();
        }
    };

    /** Prépare (ou libère) les effets. Renvoie l'état en JSON pour la page. */
    synchronized String setup(boolean on, boolean forceGlobal) {
        release();
        if (on) {
            if (!forceGlobal) {
                StringBuilder names = new StringBuilder();
                for (Map.Entry<Integer, String> e : SessionReceiver.load(ctx).entrySet()) {
                    if (add(e.getKey())) {
                        if (names.length() > 0) names.append(", ");
                        names.append(e.getValue());
                    }
                }
                if (!chains.isEmpty()) {
                    mode = "session";
                    apps = names.toString();
                }
            }
            if (chains.isEmpty()) mode = add(0) ? "global" : "fail";
            resetSent();
            apply();
            if (moving()) startTick();
        }
        return info();
    }

    synchronized String info() {
        try {
            JSONObject o = new JSONObject();
            o.put("mode", mode);
            o.put("apps", apps);
            o.put("err", err);
            return o.toString();
        } catch (Exception e) {
            return "{\"mode\":\"fail\"}";
        }
    }

    synchronized void release() {
        handler.removeCallbacks(ticker);
        ticking = false;
        for (Chain c : chains) {
            try {
                if (c.dp != null) c.dp.release();
            } catch (RuntimeException ignored) {
            }
            try {
                if (c.rv != null) c.rv.release();
            } catch (RuntimeException ignored) {
            }
        }
        chains.clear();
        mode = "off";
        apps = "";
        err = "";
    }

    private boolean add(int session) {
        Chain c = new Chain();
        try {
            DynamicsProcessing.Config cfg = new DynamicsProcessing.Config.Builder(
                    DynamicsProcessing.VARIANT_FAVOR_TIME_RESOLUTION, 2,
                    true, EDGE.length, false, 0, false, 0, false).build();
            c.dp = new DynamicsProcessing(PRIORITY, session, cfg);
            for (int i = 0; i < EDGE.length; i++) {
                c.dp.setPreEqBandAllChannelsTo(i, new DynamicsProcessing.EqBand(true, EDGE[i], 0f));
            }
            c.dp.setInputGainAllChannelsTo(0f);
            c.dp.setEnabled(false);
        } catch (Throwable e) {
            err = String.valueOf(e.getMessage());
            release(c.dp);
            c.dp = null;
        }
        try {
            c.rv = new EnvironmentalReverb(PRIORITY, session);
            c.rv.setEnabled(false);
        } catch (Throwable e) {
            c.rv = null;
        }
        if (c.dp == null && c.rv == null) return false;
        chains.add(c);
        return true;
    }

    private static void release(DynamicsProcessing dp) {
        try {
            if (dp != null) dp.release();
        } catch (RuntimeException ignored) {
        }
    }

    /** Consignes : dosages 0..1, hachoir en Hz (0 = arrêt), freinage en ms (0 = relâché). */
    synchronized void set(float hc, float lc, float rev, float gateHz, float gateDepth, boolean kill, int brakeMs, int sweepMs) {
        tHc = clamp(hc);
        tLc = clamp(lc);
        tRev = clamp(rev);
        this.gateHz = Math.max(0f, Math.min(40f, gateHz));
        this.gateDepth = clamp(gateDepth);
        this.kill = kill;
        this.brakeMs = Math.max(0, brakeMs);
        this.sweepMs = Math.max(1, sweepMs);
        if (chains.isEmpty()) return;
        if (moving()) startTick();
        else apply();
    }

    private static float clamp(float v) {
        return v != v ? 0f : Math.max(0f, Math.min(1f, v));
    }

    private boolean moving() {
        return cHc != tHc || cLc != tLc || cRev != tRev || gateHz > 0 || brakeP != (brakeMs > 0 ? 1f : 0f);
    }

    private void startTick() {
        if (ticking) return;
        ticking = true;
        lastTick = SystemClock.uptimeMillis();
        handler.postDelayed(ticker, TICK_MS);
    }

    private static float glide(float cur, float target, float k) {
        float v = cur + (target - cur) * k;
        return Math.abs(v - target) < 0.004f ? target : v;
    }

    private synchronized void tick() {
        if (!ticking) return;
        long now = SystemClock.uptimeMillis();
        float dt = Math.max(1, Math.min(200, now - lastTick));
        lastTick = now;
        float k = 1f - (float) Math.exp(-dt / sweepMs);
        cHc = glide(cHc, tHc, k);
        cLc = glide(cLc, tLc, k);
        cRev = glide(cRev, tRev, 1f - (float) Math.exp(-dt / 40f));
        if (brakeMs > 0) brakeP = Math.min(1f, brakeP + dt / brakeMs);
        else brakeP = Math.max(0f, brakeP - dt / 300f);
        if (gateHz > 0) gatePhase = (gatePhase + gateHz * dt / 1000f) % 1f;
        else gatePhase = 0f;
        apply();
        if (moving() && !chains.isEmpty()) handler.postDelayed(ticker, TICK_MS);
        else ticking = false;
    }

    private void resetSent() {
        for (int i = 0; i < sentBand.length; i++) sentBand[i] = 0f;
        sentGain = 0f;
        sentRev = -1f;
        sentOn = false;
        sentRevOn = false;
    }

    private static float log2(double x) {
        return (float) (Math.log(x) / Math.log(2));
    }

    /** Traduit l'état courant en réglages d'égaliseur, de gain et de reverb. */
    private void apply() {
        // mêmes courbes que le moteur de la page : à fond, il ne reste presque rien
        double hcF = 20000 * Math.pow(0.006, cHc) * Math.pow(0.18, cRev) * Math.pow(0.01, brakeP);
        double lcF = 20 * Math.pow(400, cLc);
        float gain = 0f;
        if (kill) gain -= 100f;
        if (gateHz > 0 && gatePhase >= 0.5f) gain += 20f * (float) Math.log10(Math.max(0.0001, 1.0 - gateDepth));
        gain -= 90f * brakeP * brakeP;
        boolean active = cHc > 0.005f || cLc > 0.005f || cRev > 0.005f || brakeP > 0f || gain < 0f || gateHz > 0;

        for (int i = 0; i < EDGE.length; i++) {
            double mid = Math.sqrt(EDGE[i] * (i == 0 ? 20.0 : EDGE[i - 1]));
            float g = 0f;
            if (mid > hcF) g -= Math.min(80f, 30f * log2(mid / hcF));
            if (mid < lcF) g -= Math.min(80f, 30f * log2(lcF / mid));
            bandWant[i] = g;
        }
        for (Chain c : chains) {
            if (c.dp == null) continue;
            try {
                for (int i = 0; i < EDGE.length; i++) {
                    float g = bandWant[i];
                    if (Math.abs(g - sentBand[i]) >= 0.5f || (g == 0f && sentBand[i] != 0f)) {
                        c.dp.setPreEqBandAllChannelsTo(i, new DynamicsProcessing.EqBand(true, EDGE[i], g));
                    }
                }
                if (gain != sentGain) c.dp.setInputGainAllChannelsTo(gain);
                if (active != sentOn) c.dp.setEnabled(active);
            } catch (RuntimeException e) {
                err = String.valueOf(e.getMessage());
            }
        }
        for (int i = 0; i < EDGE.length; i++) {
            if (Math.abs(bandWant[i] - sentBand[i]) >= 0.5f || bandWant[i] == 0f) sentBand[i] = bandWant[i];
        }
        sentGain = gain;
        sentOn = active;

        boolean revOn = cRev > 0.02f;
        if (Math.abs(cRev - sentRev) > 0.02f || revOn != sentRevOn) {
            for (Chain c : chains) {
                if (c.rv == null) continue;
                try {
                    if (revOn) {
                        c.rv.setRoomLevel((short) 0);
                        c.rv.setRoomHFLevel((short) -600);
                        c.rv.setDecayTime(Math.round(1200 + 5800 * cRev));
                        c.rv.setDecayHFRatio((short) 900);
                        c.rv.setReverbLevel((short) Math.round(-3500 + 5500 * cRev));
                        c.rv.setDiffusion((short) 1000);
                        c.rv.setDensity((short) 1000);
                    }
                    if (revOn != sentRevOn) c.rv.setEnabled(revOn);
                } catch (RuntimeException ignored) {
                }
            }
            sentRev = cRev;
            sentRevOn = revOn;
        }
    }

    private final float[] bandWant = new float[EDGE.length];
}
