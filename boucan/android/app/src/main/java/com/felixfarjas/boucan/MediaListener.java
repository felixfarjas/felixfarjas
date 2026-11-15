package com.felixfarjas.boucan;

import android.service.notification.NotificationListenerService;

/**
 * Service vide. Android n'autorise une app à voir et piloter le lecteur de
 * musique en cours (titre, pochette, lecture/pause) que si elle possède un
 * service d'accès aux notifications activé par l'utilisateur. Boucan ne lit
 * aucune notification.
 */
public class MediaListener extends NotificationListenerService {
}
