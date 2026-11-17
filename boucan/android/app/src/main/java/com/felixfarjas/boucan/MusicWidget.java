package com.felixfarjas.boucan;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;

/** Widget lecteur de musique. */
public class MusicWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        for (int id : ids) Widgets.updateMusic(c, m, id);
    }

    @Override
    public void onReceive(Context c, Intent i) {
        if (Widgets.ACTION.equals(i.getAction())) {
            WidgetTap.handle(c, i.getStringExtra("cmd"), null);
            return;
        }
        super.onReceive(c, i);
    }
}
