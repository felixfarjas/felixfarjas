package com.felixfarjas.boucan;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.audiofx.AudioEffect;
import android.os.Build;
import android.provider.Settings;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Les lecteurs de musique annoncent leur session audio aux égaliseurs
 * (« OPEN_AUDIO_EFFECT_CONTROL_SESSION »). Boucan retient ces sessions pour
 * pouvoir y brancher ses effets sans toucher au reste du téléphone.
 */
public class SessionReceiver extends BroadcastReceiver {

    private static final String PREFS = "sessions";
    private static final int MAX = 6;
    /** Prévenu (sur un fil quelconque) quand la liste change. */
    static volatile Runnable listener;

    @Override
    public void onReceive(Context context, Intent intent) {
        note(context, intent);
    }

    /** Lit une annonce d'ouverture / fermeture de session, ou une demande d'égaliseur. */
    static void note(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        int session = intent.getIntExtra(AudioEffect.EXTRA_AUDIO_SESSION, -1);
        String pkg = intent.getStringExtra(AudioEffect.EXTRA_PACKAGE_NAME);
        if (session <= 0) return;
        if (pkg == null) pkg = "?";
        if (pkg.equals(context.getPackageName())) return;
        boolean close = AudioEffect.ACTION_CLOSE_AUDIO_EFFECT_CONTROL_SESSION.equals(intent.getAction());
        synchronized (SessionReceiver.class) {
            LinkedHashMap<Integer, String> map = load(context);
            map.remove(session);
            if (!close) {
                map.put(session, pkg);
                while (map.size() > MAX) map.remove(map.keySet().iterator().next());
            }
            StringBuilder sb = new StringBuilder();
            for (Map.Entry<Integer, String> e : map.entrySet()) {
                sb.append(e.getKey()).append(':').append(e.getValue()).append('\n');
            }
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                    .putInt("boot", boot(context)).putString("list", sb.toString()).apply();
        }
        Runnable l = listener;
        if (l != null) l.run();
    }

    /** Sessions connues (numéro -> nom court de l'appli). Vidée à chaque redémarrage du téléphone. */
    static synchronized LinkedHashMap<Integer, String> load(Context context) {
        LinkedHashMap<Integer, String> map = new LinkedHashMap<Integer, String>();
        SharedPreferences p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (p.getInt("boot", -1) != boot(context)) return map;
        for (String line : p.getString("list", "").split("\n")) {
            int k = line.indexOf(':');
            if (k <= 0) continue;
            try {
                map.put(Integer.parseInt(line.substring(0, k)), label(line.substring(k + 1)));
            } catch (NumberFormatException ignored) {
            }
        }
        return map;
    }

    // "com.spotify.music" -> "spotify"
    private static String label(String pkg) {
        String[] parts = pkg.split("\\.");
        if (parts.length >= 2 && parts[0].length() <= 3) return parts[1];
        return pkg;
    }

    // Les numéros de session repartent de zéro à chaque démarrage du téléphone.
    private static int boot(Context context) {
        if (Build.VERSION.SDK_INT < 24) return 0;
        try {
            return Settings.Global.getInt(context.getContentResolver(), Settings.Global.BOOT_COUNT);
        } catch (Exception e) {
            return 0;
        }
    }
}
