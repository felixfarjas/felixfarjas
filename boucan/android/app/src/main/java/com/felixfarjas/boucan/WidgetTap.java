package com.felixfarjas.boucan;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

/**
 * Relais invisible des widgets quand l'appli n'est pas lancée : il la démarre
 * avec la commande en attente (Android interdit de lancer une appli depuis
 * une simple diffusion), puis disparaît aussitôt.
 */
public class WidgetTap extends Activity {
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Intent i = getIntent();
        handle(this, i.getStringExtra("cmd"), i.getStringExtra("pad"));
        finish();
        overridePendingTransition(0, 0);
    }

    /** Commande d'un widget : transmise à l'appli si elle tourne, sinon l'appli est lancée et la reçoit au démarrage. */
    static void handle(Context c, String cmd, String pad) {
        if (Widgets.dispatch(c, cmd, pad)) return;
        // l'appli a été fermée sans prévenir : les widgets repassent par ce relais
        Widgets.refreshAll(c);
        try {
            c.startActivity(new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_ANIMATION));
        } catch (Exception ignored) {
        }
    }
}
