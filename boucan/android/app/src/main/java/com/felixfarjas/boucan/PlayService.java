package com.felixfarjas.boucan;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/**
 * Service de premier plan qui porte la notification du lecteur de musique :
 * tant que la musique joue, Android garde l'app en vie et affiche ses
 * commandes (lecture, pause, suivant, précédent) dans les notifications.
 */
public class PlayService extends Service {

    static final int ID = 7;
    /** Notification à afficher, préparée par l'activité. */
    static volatile Notification current;

    @Override
    @SuppressWarnings("deprecation")
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification n = current;
        if (n == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        try {
            if (intent != null && intent.getBooleanExtra("fg", false)) {
                if (Build.VERSION.SDK_INT >= 29) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
                else startForeground(ID, n);
            } else {
                // en pause : la notification reste, mais on peut la balayer
                if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_DETACH);
                else stopForeground(false);
                ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(ID, n);
                stopSelf();
            }
        } catch (RuntimeException e) {
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
