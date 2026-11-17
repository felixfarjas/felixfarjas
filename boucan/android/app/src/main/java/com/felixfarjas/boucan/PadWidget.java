package com.felixfarjas.boucan;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

/** Widget grille de cases : s'adapte à sa taille (jusqu'à 4 x 4). */
public class PadWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        for (int id : ids) Widgets.updatePads(c, m, id);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context c, AppWidgetManager m, int id, Bundle options) {
        Widgets.updatePads(c, m, id);
    }

    @Override
    public void onReceive(Context c, Intent i) {
        if (Widgets.ACTION.equals(i.getAction())) {
            String cmd = i.getStringExtra("cmd");
            if ("page".equals(cmd)) Widgets.nextPage(c, i.getIntExtra("wid", 0));
            else WidgetTap.handle(c, null, i.getStringExtra("pad"));
            return;
        }
        super.onReceive(c, i);
    }
}
