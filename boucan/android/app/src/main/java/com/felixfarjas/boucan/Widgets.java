package com.felixfarjas.boucan;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.app.PendingIntent;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Widgets de l'écran d'accueil : le lecteur de musique et une petite grille de cases.
 *
 * Quand l'appli tourne, un toucher est une simple diffusion transmise à la page
 * (rapide, l'appli reste en arrière-plan). Sinon il passe par une activité-relais
 * invisible (WidgetTap) qui relance l'appli et lui laisse la commande en attente.
 */
final class Widgets {
    static final String ACTION = "com.felixfarjas.boucan.WIDGET";
    private static final String PREFS = "widgets";
    private static Bitmap art;
    private static String musicSig = "";

    private Widgets() {
    }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static int res(Context c, String name, String type) {
        return c.getResources().getIdentifier(name, type, c.getPackageName());
    }

    private static int vid(Context c, String name) {
        return res(c, name, "id");
    }

    private static int flags() {
        return PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
    }

    /** Toucher d'un bouton : cmd (commande du lecteur, "page") ou pad (id d'une case). */
    private static PendingIntent action(Context c, Class<?> provider, int wid, String cmd, String pad, boolean direct) {
        Uri u = Uri.parse("boucan://w/" + wid + "/" + (cmd != null ? cmd : "") + "/" + (pad != null ? pad : ""));
        if (direct || MainActivity.live != null) {
            Intent i = new Intent(ACTION).setClass(c, provider).setData(u).putExtra("cmd", cmd).putExtra("pad", pad).putExtra("wid", wid);
            return PendingIntent.getBroadcast(c, 0, i, flags());
        }
        Intent i = new Intent(c, WidgetTap.class).setData(u).putExtra("cmd", cmd).putExtra("pad", pad)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_ANIMATION);
        return PendingIntent.getActivity(c, 0, i, flags());
    }

    private static PendingIntent openApp(Context c) {
        Intent i = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, 7, i, flags());
    }

    /** Transmet un toucher à l'appli si elle tourne ; sinon le garde pour son démarrage. Vrai si transmis. */
    static boolean dispatch(Context c, String cmd, String pad) {
        MainActivity a = MainActivity.live;
        if (a != null) {
            a.fromWidget(cmd, pad);
            return true;
        }
        try {
            JSONObject o = new JSONObject();
            if (cmd != null) o.put("cmd", cmd);
            if (pad != null) o.put("pad", pad);
            prefs(c).edit().putString("pending", o.toString()).putLong("pendingAt", System.currentTimeMillis()).apply();
        } catch (Exception ignored) {
        }
        return false;
    }

    /** Commande en attente (lancée depuis un widget appli fermée), lue une seule fois. */
    static String takePending(Context c) {
        SharedPreferences p = prefs(c);
        String s = p.getString("pending", "");
        if (s.length() == 0) return "";
        p.edit().remove("pending").apply();
        // un toucher resté en attente plus de 30 s (appli ouverte plus tard à la main) est oublié
        return System.currentTimeMillis() - p.getLong("pendingAt", 0) < 30000 ? s : "";
    }

    static void refreshAll(Context c) {
        try {
            AppWidgetManager m = AppWidgetManager.getInstance(c);
            for (int id : m.getAppWidgetIds(new ComponentName(c, MusicWidget.class))) updateMusic(c, m, id);
            for (int id : m.getAppWidgetIds(new ComponentName(c, PadWidget.class))) updatePads(c, m, id);
        } catch (Exception ignored) {
        }
    }

    // ------------------------------------------------------------ Lecteur

    /** Morceau en cours (appelé par MainActivity à chaque changement). */
    static void setMusic(Context c, boolean active, String title, String artist, boolean playing, Bitmap cover) {
        String sig = active + "|" + title + "|" + artist + "|" + playing + "|" + (cover != null ? cover.hashCode() : 0);
        if (sig.equals(musicSig)) return;
        musicSig = sig;
        art = cover;
        prefs(c).edit().putBoolean("np_on", active).putString("np_t", title).putString("np_a", artist).putBoolean("np_p", playing).apply();
        try {
            AppWidgetManager m = AppWidgetManager.getInstance(c);
            for (int id : m.getAppWidgetIds(new ComponentName(c, MusicWidget.class))) updateMusic(c, m, id);
        } catch (Exception ignored) {
        }
    }

    static void updateMusic(Context c, AppWidgetManager m, int wid) {
        SharedPreferences p = prefs(c);
        boolean on = p.getBoolean("np_on", false), playing = on && p.getBoolean("np_p", false);
        RemoteViews v = new RemoteViews(c.getPackageName(), res(c, "w_music", "layout"));
        v.setTextViewText(vid(c, "wTitle"), on ? p.getString("np_t", "") : "Boucan");
        v.setTextViewText(vid(c, "wArtist"), on ? p.getString("np_a", "") : "");
        if (on && art != null) {
            v.setImageViewBitmap(vid(c, "wArt"), art);
            v.setViewPadding(vid(c, "wArt"), 0, 0, 0, 0);
        } else {
            v.setImageViewResource(vid(c, "wArt"), res(c, "ic_note", "drawable"));
        }
        v.setImageViewResource(vid(c, "wPlay"), playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play);
        v.setOnClickPendingIntent(vid(c, "wPrev"), action(c, MusicWidget.class, wid, "prev", null, false));
        v.setOnClickPendingIntent(vid(c, "wPlay"), action(c, MusicWidget.class, wid, "toggle", null, false));
        v.setOnClickPendingIntent(vid(c, "wNext"), action(c, MusicWidget.class, wid, "next", null, false));
        v.setOnClickPendingIntent(vid(c, "wOpen"), openApp(c));
        m.updateAppWidget(wid, v);
    }

    // ------------------------------------------------------------ Grille

    /** Pages et cases envoyées par la page web (JSON : {pages:[{n,c,pads:[{id,n,c,k}]}]}). */
    static void setPads(Context c, String json) {
        prefs(c).edit().putString("pads", json).apply();
        try {
            AppWidgetManager m = AppWidgetManager.getInstance(c);
            for (int id : m.getAppWidgetIds(new ComponentName(c, PadWidget.class))) updatePads(c, m, id);
        } catch (Exception ignored) {
        }
    }

    /** Page suivante dans ce widget. */
    static void nextPage(Context c, int wid) {
        SharedPreferences p = prefs(c);
        p.edit().putInt("page_" + wid, p.getInt("page_" + wid, 0) + 1).apply();
        updatePads(c, AppWidgetManager.getInstance(c), wid);
    }

    private static int ink(int color) {
        return (Color.red(color) * 299 + Color.green(color) * 587 + Color.blue(color) * 114) / 1000 > 150 ? Color.BLACK : Color.WHITE;
    }

    static void updatePads(Context c, AppWidgetManager m, int wid) {
        RemoteViews v = new RemoteViews(c.getPackageName(), res(c, "w_pads", "layout"));
        SharedPreferences p = prefs(c);
        JSONArray pages = null;
        try {
            pages = new JSONObject(p.getString("pads", "{}")).optJSONArray("pages");
        } catch (Exception ignored) {
        }
        // taille du widget (dp, en portrait) -> colonnes et rangées : 4 colonnes sur toute la largeur de l'écran
        Bundle o = m.getAppWidgetOptions(wid);
        int w = o != null ? o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH) : 0;
        int h = o != null ? o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT) : 0;
        if (w <= 0) w = 320;
        if (h <= 0) h = 180;
        int cols = Math.max(1, Math.min(4, Math.round(w / 82f)));
        int rows = Math.max(1, Math.min(4, (h - 30) / 52));

        int np = pages != null ? pages.length() : 0;
        int pi = np > 0 ? ((p.getInt("page_" + wid, 0) % np) + np) % np : 0;
        JSONObject pg = np > 0 ? pages.optJSONObject(pi) : null;
        JSONArray pads = pg != null ? pg.optJSONArray("pads") : null;
        int n = pads != null ? pads.length() : 0;
        String head = pg == null ? "BOUCAN" : np > 1 ? "◂  " + pg.optString("n") + "  ▸" : pg.optString("n");
        v.setTextViewText(vid(c, "wPage"), head);
        v.setOnClickPendingIntent(vid(c, "wPage"), pg != null && np > 1 ? action(c, PadWidget.class, wid, "page", null, true) : openApp(c));
        // pas plus de rangées qu'il n'en faut pour les cases de la page
        int used = Math.max(1, Math.min(rows, (Math.min(n, cols * rows) + cols - 1) / cols));
        for (int r = 0; r < 4; r++) {
            v.setViewVisibility(vid(c, "r" + r), r < used ? View.VISIBLE : View.GONE);
            for (int k = 0; k < 4; k++) {
                int cell = r * 4 + k, idx = r * cols + k;
                int cv = vid(c, "c" + cell);
                if (k >= cols) {
                    v.setViewVisibility(cv, View.GONE);
                    continue;
                }
                JSONObject pad = r < used && idx < n ? pads.optJSONObject(idx) : null;
                if (pad == null) {
                    v.setViewVisibility(cv, View.INVISIBLE);
                    continue;
                }
                int col;
                try {
                    col = Color.parseColor(pad.optString("c", "#424242"));
                } catch (Exception e) {
                    col = Color.DKGRAY;
                }
                String kind = pad.optString("k"), name = pad.optString("n");
                v.setViewVisibility(cv, View.VISIBLE);
                v.setInt(vid(c, "i" + cell), "setColorFilter", col);
                v.setTextViewText(vid(c, "t" + cell), kind.length() > 0 ? kind + "\n" + name : name);
                v.setTextColor(vid(c, "t" + cell), ink(col));
                v.setOnClickPendingIntent(cv, action(c, PadWidget.class, wid, null, pad.optString("id"), false));
            }
        }
        m.updateAppWidget(wid, v);
    }
}
