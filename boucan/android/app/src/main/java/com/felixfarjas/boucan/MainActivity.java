package com.felixfarjas.boucan;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.IntentFilter;
import android.media.session.MediaSession;
import android.content.ComponentName;
import android.content.ContentUris;
import android.content.ContentValues;
import android.webkit.MimeTypeMap;
import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.provider.MediaStore;
import android.util.Size;
import android.webkit.WebResourceResponse;
import android.graphics.Bitmap;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.provider.Settings;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Insets;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.FilterInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Boucan : une WebView plein écran qui affiche l'app embarquée dans les assets.
 * Le natif ne fait que ce que la page ne peut pas faire seule : choisir un
 * fichier, enregistrer ou partager l'export, garder l'écran allumé.
 */
public class MainActivity extends Activity {

    private static final String START_URL = "file:///android_asset/index.html";
    private static final int REQ_FILE = 1;
    private static final int REQ_SAVE = 2;
    private static final int REQ_MIC = 3;
    private static final int REQ_MUSIC = 4;
    private static final int REQ_NOTIF = 5;
    private static final String ACTION_NP = "com.felixfarjas.boucan.NOW_PLAYING";
    private static final String CHANNEL = "music";
    private MediaSession session;
    private boolean npService, npAsked, npReceiverOn;
    private long npArtId = -1;
    private Bitmap npArt;
    /** Adresse fictive sous laquelle la page lit les fichiers de musique du téléphone. */
    private static final String MUSIC_HOST = "boucan.music";
    private Uri musicInUri;
    private OutputStream musicInOut;
    private boolean musicInFailed;

    /** L'appli en cours (pour les widgets), ou null. */
    static volatile MainActivity live;

    private FrameLayout root;
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private File exportFile;
    private OutputStream exportOut;
    private boolean exportFailed;
    private long lastBack;
    private PermissionRequest micRequest;
    private volatile boolean french = true;
    private Vibrator vibrator;
    private AudioManager audio;
    private int focusMode; // 0 rien, 1 musique baissée, 2 musique en pause
    private final AudioManager.OnAudioFocusChangeListener focusListener = new AudioManager.OnAudioFocusChangeListener() {
        @Override
        public void onAudioFocusChange(int change) {
        }
    };

    @Override
    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setVolumeControlStream(AudioManager.STREAM_MUSIC);
        vibrator = (Vibrator) getSystemService(VIBRATOR_SERVICE);

        audio = (AudioManager) getSystemService(AUDIO_SERVICE);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        // Android 15 dessine sous les barres système : on rend la marge à la main.
        root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                if (Build.VERSION.SDK_INT >= 30) {
                    Insets i = insets.getInsets(WindowInsets.Type.systemBars()
                            | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                    v.setPadding(i.left, i.top, i.right, i.bottom);
                } else {
                    v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                            insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
                }
                return insets;
            }
        });

        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.setHapticFeedbackEnabled(false);
        web.setOnLongClickListener(new View.OnLongClickListener() {
            @Override
            public boolean onLongClick(View v) {
                return true; // pas de menu de sélection sur un appui long
            }
        });

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setSupportZoom(false);
        s.setTextZoom(100); // la taille de police du système ne casse pas la grille

        web.addJavascriptInterface(new Bridge(), "BoucanNative");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());

        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        web.loadUrl(START_URL);
        live = this;
        Widgets.refreshAll(this);
    }

    /** Toucher d'un widget : une commande du lecteur, ou l'id d'une case à jouer. */
    void fromWidget(final String cmd, final String pad) {
        if (pad == null) {
            deckCmd(cmd, 0);
            return;
        }
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (web != null) web.evaluateJavascript("window.Boucan&&Boucan.widgetTap&&Boucan.widgetTap(" + JSONObject.quote(pad) + ")", null);
            }
        });
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            // Barre de navigation masquée : pas de sortie de l'app par accident.
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        web.evaluateJavascript("(window.Boucan&&Boucan.back&&Boucan.back())?1:0", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String v) {
                if ("1".equals(v)) return;
                long now = SystemClock.elapsedRealtime();
                if (now - lastBack < 2000) {
                    finish();
                } else {
                    lastBack = now;
                    Toast.makeText(MainActivity.this, french ? "Encore une fois pour quitter" : "Press back again to quit", Toast.LENGTH_SHORT).show();
                }
            }
        });
    }

    @Override
    protected void onDestroy() {
        if (live == this) live = null;
        focus(0);
        clearNowPlaying();
        Widgets.refreshAll(this);
        closeExport();
        if (web != null) {
            root.removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    /** Message pour la page : une clé de texte (traduite côté page), ou "" pour seulement lever l'attente. */
    private void tell(final String msg) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (web != null) web.evaluateJavascript("Boucan.nativeMsg(" + JSONObject.quote(msg) + ")", null);
            }
        });
    }

    // ---------------------------------------------------------------- WebView

    private final class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return true; // l'app ne navigue jamais ailleurs
        }

        @Override
        @SuppressWarnings("deprecation")
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return true;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            if (u == null || !MUSIC_HOST.equals(u.getHost())) return null;
            return serveMusic(u, request.getRequestHeaders());
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // Le moteur de rendu a été tué (mémoire) : on repart proprement.
            if (web != null) {
                root.removeView(web);
                web.destroy();
                web = null;
            }
            recreate();
            return true;
        }
    }

    private final class Chrome extends WebChromeClient {
        // La page demande le micro : Android doit d'abord l'accorder à l'app.
        @Override
        public void onPermissionRequest(final PermissionRequest request) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    boolean audio = false;
                    for (String r : request.getResources()) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) audio = true;
                    }
                    if (!audio) {
                        request.deny();
                    } else if (Build.VERSION.SDK_INT < 23
                            || checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                    } else {
                        if (micRequest != null) micRequest.deny();
                        micRequest = request;
                        requestPermissions(new String[]{android.Manifest.permission.RECORD_AUDIO}, REQ_MIC);
                    }
                }
            });
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            boolean audio = false;
            String[] types = params.getAcceptTypes();
            if (types != null) {
                for (String t : types) if (t != null && t.startsWith("audio")) audio = true;
            }
            Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
            pick.addCategory(Intent.CATEGORY_OPENABLE);
            pick.setType(audio ? "audio/*" : "*/*");
            try {
                startActivityForResult(Intent.createChooser(pick, audio ? (french ? "Choisir un son" : "Pick a sound") : (french ? "Choisir un fichier .boucan" : "Pick a .boucan file")), REQ_FILE);
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                callback.onReceiveValue(null);
                tell("noPicker");
            }
            return true;
        }
    }

    @Override
    public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request == REQ_NOTIF) return;
        if (request == REQ_MUSIC) {
            if (web != null) web.evaluateJavascript("window.Boucan&&Boucan.deckPerm&&Boucan.deckPerm()", null);
            return;
        }
        if (request != REQ_MIC || micRequest == null) return;
        PermissionRequest r = micRequest;
        micRequest = null;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
            r.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        } else {
            r.deny();
        }
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == REQ_FILE) {
            ValueCallback<Uri[]> cb = fileCallback;
            fileCallback = null;
            if (cb == null) return;
            Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
            cb.onReceiveValue(uri != null ? new Uri[]{uri} : null);
        } else if (request == REQ_SAVE) {
            final Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
            if (uri == null) {
                tell("");
                return;
            }
            final File src = exportFile;
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        copy(src, uri);
                        tell("saved");
                    } catch (Exception e) {
                        tell("saveFail");
                    }
                }
            }).start();
        }
    }

    private void copy(File src, Uri dst) throws IOException {
        InputStream in = new FileInputStream(src);
        try {
            OutputStream out = getContentResolver().openOutputStream(dst);
            if (out == null) throw new IOException("open");
            try {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            } finally {
                out.close();
            }
        } finally {
            in.close();
        }
    }

    // ----------------------------------------------------------------- Export

    private void closeExport() {
        if (exportOut != null) {
            try {
                exportOut.close();
            } catch (IOException ignored) {
            }
            exportOut = null;
        }
    }

    private void saveExport() {
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("application/octet-stream");
        i.putExtra(Intent.EXTRA_TITLE, exportFile.getName());
        try {
            startActivityForResult(i, REQ_SAVE);
            tell("");
        } catch (ActivityNotFoundException e) {
            shareExport();
        }
    }

    private void shareExport() {
        Uri uri = ExportProvider.uriFor(this, exportFile);
        Intent i = new Intent(Intent.ACTION_SEND);
        i.setType("application/octet-stream");
        i.putExtra(Intent.EXTRA_STREAM, uri);
        i.putExtra(Intent.EXTRA_SUBJECT, exportFile.getName());
        i.setClipData(ClipData.newRawUri(exportFile.getName(), uri));
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            startActivity(Intent.createChooser(i, french ? "Envoyer la config Boucan" : "Send Boucan config"));
            tell("");
        } catch (ActivityNotFoundException e) {
            tell("noShare");
        }
    }

    // ------------------------------------------------- Fichiers de musique

    private String musicPermission() {
        return Build.VERSION.SDK_INT >= 33 ? "android.permission.READ_MEDIA_AUDIO" : android.Manifest.permission.READ_EXTERNAL_STORAGE;
    }

    private boolean musicAllowed() {
        return Build.VERSION.SDK_INT < 23 || checkSelfPermission(musicPermission()) == PackageManager.PERMISSION_GRANTED;
    }

    /** Tous les morceaux du téléphone, en JSON : id, titre, artiste, album, chemin du dossier, n° de piste. */
    @SuppressWarnings("deprecation")
    private String listMusic() {
        JSONArray out = new JSONArray();
        Cursor c = null;
        try {
            c = getContentResolver().query(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, new String[]{
                    MediaStore.Audio.Media._ID, MediaStore.Audio.Media.TITLE, MediaStore.Audio.Media.ARTIST,
                    MediaStore.Audio.Media.ALBUM, MediaStore.Audio.Media.DATA, MediaStore.Audio.Media.TRACK,
                    MediaStore.Audio.Media.DISPLAY_NAME, MediaStore.Audio.Media.SIZE, MediaStore.Audio.Media.DURATION
            }, MediaStore.Audio.Media.IS_MUSIC + " != 0", null, null);
            while (c != null && c.moveToNext()) {
                JSONObject o = new JSONObject();
                String artist = c.getString(2), path = c.getString(4), dir = "";
                if (path != null && path.lastIndexOf('/') > 0) dir = path.substring(0, path.lastIndexOf('/'));
                o.put("id", c.getLong(0));
                o.put("t", c.getString(1) == null ? "?" : c.getString(1));
                o.put("a", artist == null || "<unknown>".equals(artist) ? "" : artist);
                o.put("al", c.getString(3) == null ? "" : c.getString(3));
                o.put("p", dir);
                o.put("n", c.getInt(5));
                o.put("f", c.getString(6) == null ? "" : c.getString(6));
                o.put("z", c.getLong(7));
                o.put("ms", c.getLong(8));
                out.put(o);
            }
        } catch (Exception ignored) {
        } finally {
            if (c != null) c.close();
        }
        return out.toString();
    }

    /** Abandonne une musique en cours d'import et retire le fichier incomplet. */
    private void musicImportAbort() {
        try {
            if (musicInOut != null) musicInOut.close();
        } catch (IOException ignored) {
        }
        musicInOut = null;
        try {
            if (musicInUri != null) getContentResolver().delete(musicInUri, null, null);
        } catch (Exception ignored) {
        }
        musicInUri = null;
    }

    /** Flux limité à un nombre d'octets (réponse à une requête partielle). */
    private static final class Bounded extends FilterInputStream {
        private long left;

        Bounded(InputStream in, long left) {
            super(in);
            this.left = left;
        }

        @Override
        public int read() throws IOException {
            if (left <= 0) return -1;
            int b = super.read();
            if (b >= 0) left--;
            return b;
        }

        @Override
        public int read(byte[] buf, int off, int len) throws IOException {
            if (left <= 0) return -1;
            int n = super.read(buf, off, (int) Math.min(len, left));
            if (n > 0) left -= n;
            return n;
        }
    }

    /** Sert à la page un morceau (/t/id) ou sa pochette (/a/id). Rien ne passe par le réseau. */
    private WebResourceResponse serveMusic(Uri u, Map<String, String> req) {
        Map<String, String> h = new HashMap<String, String>();
        h.put("Access-Control-Allow-Origin", "*");
        try {
            List<String> seg = u.getPathSegments();
            if (seg.size() != 2 || !musicAllowed()) throw new IOException("path");
            Uri uri = ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, Long.parseLong(seg.get(1)));
            if ("a".equals(seg.get(0))) {
                if (Build.VERSION.SDK_INT < 29) throw new IOException("art");
                Bitmap b = getContentResolver().loadThumbnail(uri, new Size(256, 256), null);
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                b.compress(Bitmap.CompressFormat.JPEG, 82, out);
                return new WebResourceResponse("image/jpeg", null, 200, "OK", h, new ByteArrayInputStream(out.toByteArray()));
            }
            AssetFileDescriptor afd = getContentResolver().openAssetFileDescriptor(uri, "r");
            if (afd == null) throw new IOException("open");
            long len = afd.getLength(), start = 0, end = len - 1;
            InputStream in = afd.createInputStream();
            String mime = getContentResolver().getType(uri), range = null;
            if (req != null) {
                for (Map.Entry<String, String> e : req.entrySet()) {
                    if ("range".equalsIgnoreCase(e.getKey())) range = e.getValue();
                }
            }
            boolean partial = false;
            if (len > 0 && range != null && range.startsWith("bytes=")) {
                String[] p = range.substring(6).split("-", 2);
                try {
                    if (p[0].length() > 0) start = Long.parseLong(p[0].trim());
                    if (p.length > 1 && p[1].trim().length() > 0) end = Math.min(len - 1, Long.parseLong(p[1].trim()));
                    partial = start >= 0 && start <= end;
                } catch (NumberFormatException ignored) {
                }
                if (!partial) {
                    start = 0;
                    end = len - 1;
                }
            }
            long skip = start;
            while (skip > 0) {
                long n = in.skip(skip);
                if (n <= 0) break;
                skip -= n;
            }
            h.put("Accept-Ranges", "bytes");
            if (len > 0) {
                h.put("Content-Length", String.valueOf(end - start + 1));
                if (partial) h.put("Content-Range", "bytes " + start + "-" + end + "/" + len);
            }
            return new WebResourceResponse(mime == null ? "audio/mpeg" : mime, null, partial ? 206 : 200,
                    partial ? "Partial Content" : "OK", h, len > 0 ? new Bounded(in, end - start + 1) : in);
        } catch (Throwable e) {
            return new WebResourceResponse("text/plain", null, 404, "Not Found", h, new ByteArrayInputStream(new byte[0]));
        }
    }

    // ------------------------------------- Lecteur intégré : notification

    private final BroadcastReceiver npReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            deckCmd(intent.getStringExtra("cmd"), 0);
        }
    };

    /** Transmet à la page une commande venue des notifications (play, pause, toggle, next, prev, seek). */
    private void deckCmd(final String cmd, final long arg) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (web != null && cmd != null) {
                    web.evaluateJavascript("window.Boucan&&Boucan.deckCmd&&Boucan.deckCmd(" + JSONObject.quote(cmd) + "," + arg + ")", null);
                }
            }
        });
    }

    private PendingIntent npIntent(String cmd, int code) {
        Intent i = new Intent(ACTION_NP).setPackage(getPackageName()).putExtra("cmd", cmd);
        return PendingIntent.getBroadcast(this, code, i, PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));
    }

    /** Met à jour la session média et la notification du lecteur intégré. */
    @SuppressWarnings("deprecation")
    private void updateNowPlaying(String json) {
        try {
            JSONObject o = new JSONObject(json);
            if (!o.optBoolean("active")) {
                clearNowPlaying();
                return;
            }
            boolean playing = o.optBoolean("playing");
            long id = o.optLong("id"), pos = o.optLong("pos"), dur = o.optLong("dur");
            String title = o.optString("t"), artist = o.optString("a");
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (session == null) {
                session = new MediaSession(this, "Boucan");
                session.setCallback(new MediaSession.Callback() {
                    @Override
                    public void onPlay() {
                        deckCmd("play", 0);
                    }

                    @Override
                    public void onPause() {
                        deckCmd("pause", 0);
                    }

                    @Override
                    public void onStop() {
                        deckCmd("pause", 0);
                    }

                    @Override
                    public void onSkipToNext() {
                        deckCmd("next", 0);
                    }

                    @Override
                    public void onSkipToPrevious() {
                        deckCmd("prev", 0);
                    }

                    @Override
                    public void onSeekTo(long ms) {
                        deckCmd("seek", ms);
                    }
                });
                if (Build.VERSION.SDK_INT >= 26) {
                    NotificationChannel ch = new NotificationChannel(CHANNEL, french ? "Lecteur de musique" : "Music player", NotificationManager.IMPORTANCE_LOW);
                    ch.setShowBadge(false);
                    nm.createNotificationChannel(ch);
                }
            }
            if (!npReceiverOn) {
                IntentFilter f = new IntentFilter(ACTION_NP);
                if (Build.VERSION.SDK_INT >= 33) registerReceiver(npReceiver, f, RECEIVER_NOT_EXPORTED);
                else registerReceiver(npReceiver, f);
                npReceiverOn = true;
            }
            // Android 13+ : demander une fois le droit d'afficher des notifications
            if (Build.VERSION.SDK_INT >= 33 && !npAsked
                    && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
                npAsked = true;
                requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, REQ_NOTIF);
            }
            if (id != npArtId) {
                npArtId = id;
                npArt = null;
                if (Build.VERSION.SDK_INT >= 29) {
                    try {
                        npArt = getContentResolver().loadThumbnail(
                                ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id), new Size(256, 256), null);
                    } catch (Exception ignored) {
                    }
                }
            }
            MediaMetadata.Builder md = new MediaMetadata.Builder()
                    .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                    .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
                    .putLong(MediaMetadata.METADATA_KEY_DURATION, dur);
            if (npArt != null) md.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, npArt);
            session.setMetadata(md.build());
            session.setPlaybackState(new PlaybackState.Builder()
                    .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
                            | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_SEEK_TO)
                    .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, pos, playing ? 1f : 0f)
                    .build());
            session.setActive(true);

            Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
            Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
            b.setSmallIcon(getResources().getIdentifier("ic_note", "drawable", getPackageName()))
                    .setContentTitle(title).setContentText(artist).setLargeIcon(npArt)
                    .setContentIntent(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0)))
                    .setVisibility(Notification.VISIBILITY_PUBLIC).setOngoing(playing).setShowWhen(false).setOnlyAlertOnce(true)
                    .addAction(android.R.drawable.ic_media_previous, "prev", npIntent("prev", 1))
                    .addAction(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play, "play", npIntent("toggle", 2))
                    .addAction(android.R.drawable.ic_media_next, "next", npIntent("next", 3))
                    .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2));
            Notification n = b.build();
            Widgets.setMusic(this, true, title, artist, playing, npArt);
            PlayService.current = n;
            if (playing || npService) {
                try {
                    Intent sv = new Intent(this, PlayService.class).putExtra("fg", playing);
                    if (playing && Build.VERSION.SDK_INT >= 26) startForegroundService(sv);
                    else startService(sv);
                    npService = playing;
                } catch (RuntimeException e) {
                    // app en arrière-plan : Android refuse le service, la notification seule suffit
                    nm.notify(PlayService.ID, n);
                }
            } else {
                nm.notify(PlayService.ID, n);
            }
        } catch (Exception ignored) {
        }
    }

    private void clearNowPlaying() {
        Widgets.setMusic(this, false, "", "", false, null);
        try {
            PlayService.current = null;
            stopService(new Intent(this, PlayService.class));
            npService = false;
            ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).cancel(PlayService.ID);
            if (session != null) {
                session.setActive(false);
                session.release();
                session = null;
            }
            if (npReceiverOn) {
                unregisterReceiver(npReceiver);
                npReceiverOn = false;
            }
        } catch (Exception ignored) {
        }
    }

    // ----------------------------------------------------- Lecteur de musique

    /** Le lecteur à piloter : celui qui joue, sinon le plus récent. Lève SecurityException sans l'accès aux notifications. */
    private MediaController controller() {
        MediaSessionManager msm = (MediaSessionManager) getSystemService(MEDIA_SESSION_SERVICE);
        List<MediaController> list = msm.getActiveSessions(new ComponentName(this, MediaListener.class));
        MediaController first = null;
        for (MediaController c : list) {
            if (getPackageName().equals(c.getPackageName())) continue;
            PlaybackState st = c.getPlaybackState();
            if (st != null && st.getState() == PlaybackState.STATE_PLAYING) return c;
            if (first == null) first = c;
        }
        return first;
    }

    /** Demande à Android de baisser (1) ou de mettre en pause (2) les autres applis ; 0 leur rend la main. */
    @SuppressWarnings("deprecation")
    private void focus(int mode) {
        if (audio == null || mode == focusMode) return;
        try {
            if (focusMode != 0) audio.abandonAudioFocus(focusListener);
            focusMode = 0;
            if (mode != 0) {
                audio.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC,
                        mode == 2 ? AudioManager.AUDIOFOCUS_GAIN_TRANSIENT : AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
                focusMode = mode;
            }
        } catch (Exception ignored) {
        }
    }

    /** Appelé depuis la page : le fichier arrive par morceaux en base64. */
    private final class Bridge {
        /** Pages et cases proposées par le widget grille. */
        @JavascriptInterface
        public void widgetData(String json) {
            Widgets.setPads(getApplicationContext(), json);
        }

        /** Commande d'un widget touché pendant que l'appli était fermée ("" s'il n'y en a pas). */
        @JavascriptInterface
        public String widgetPending() {
            return Widgets.takePending(getApplicationContext());
        }

        @JavascriptInterface
        @SuppressWarnings("deprecation")
        public void vibrate(int ms) {
            try {
                if (vibrator == null || ms <= 0 || ms > 200) return;
                if (Build.VERSION.SDK_INT >= 26) {
                    vibrator.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    vibrator.vibrate(ms);
                }
            } catch (Exception ignored) {
            }
        }

        /** Morceau en cours du lecteur intégré (JSON), pour la notification et ses commandes. */
        @JavascriptInterface
        public void nowPlaying(final String json) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    updateNowPlaying(json);
                }
            });
        }

        /** Morceaux du téléphone en JSON, ou "PERM" s'il faut d'abord l'autorisation. */
        @JavascriptInterface
        public String musicList() {
            return musicAllowed() ? listMusic() : "PERM";
        }

        /** Import d'une musique : crée le fichier dans Music/Boucan/dir (Android 10+). Faux si impossible. */
        @JavascriptInterface
        public boolean musicImportBegin(String dir, String name) {
            musicImportAbort();
            if (Build.VERSION.SDK_INT < 29) return false;
            try {
                StringBuilder rel = new StringBuilder("Music/Boucan");
                for (String part : String.valueOf(dir).split("/")) {
                    String p = part.replaceAll("[\\\\:*?\"<>|]", "_").trim();
                    if (p.length() > 0 && !p.startsWith(".")) rel.append('/').append(p);
                }
                String file = String.valueOf(name).replaceAll("[\\\\/:*?\"<>|]", "_");
                int dot = file.lastIndexOf('.');
                String mime = dot > 0 ? MimeTypeMap.getSingleton().getMimeTypeFromExtension(file.substring(dot + 1).toLowerCase()) : null;
                ContentValues v = new ContentValues();
                v.put(MediaStore.Audio.Media.DISPLAY_NAME, file);
                v.put(MediaStore.Audio.Media.MIME_TYPE, mime != null && mime.startsWith("audio") ? mime : "audio/mpeg");
                v.put(MediaStore.Audio.Media.RELATIVE_PATH, rel.toString());
                v.put(MediaStore.Audio.Media.IS_PENDING, 1);
                musicInUri = getContentResolver().insert(MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), v);
                if (musicInUri == null) return false;
                musicInOut = new BufferedOutputStream(getContentResolver().openOutputStream(musicInUri));
                musicInFailed = false;
                return true;
            } catch (Throwable e) {
                musicImportAbort();
                return false;
            }
        }

        @JavascriptInterface
        public void musicImportChunk(String b64) {
            if (musicInOut == null || musicInFailed) return;
            try {
                musicInOut.write(Base64.decode(b64, Base64.DEFAULT));
            } catch (Throwable e) {
                musicInFailed = true;
            }
        }

        @JavascriptInterface
        public boolean musicImportEnd() {
            if (musicInOut == null || musicInUri == null) return false;
            try {
                musicInOut.close();
                musicInOut = null;
                if (musicInFailed) throw new IOException("write");
                ContentValues v = new ContentValues();
                v.put(MediaStore.Audio.Media.IS_PENDING, 0);
                getContentResolver().update(musicInUri, v, null, null);
                musicInUri = null;
                return true;
            } catch (Throwable e) {
                musicImportAbort();
                return false;
            }
        }

        @JavascriptInterface
        public void musicAsk() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (Build.VERSION.SDK_INT >= 23) requestPermissions(new String[]{musicPermission()}, REQ_MUSIC);
                }
            });
        }

        /** État du lecteur de musique en cours (Spotify ou autre), en JSON. */
        @JavascriptInterface
        public String playerState() {
            JSONObject o = new JSONObject();
            try {
                int max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
                o.put("vol", max > 0 ? audio.getStreamVolume(AudioManager.STREAM_MUSIC) / (double) max : 0);
                o.put("perm", true);
                MediaController c = controller();
                if (c != null) {
                    MediaMetadata m = c.getMetadata();
                    PlaybackState st = c.getPlaybackState();
                    String title = m == null ? null : m.getString(MediaMetadata.METADATA_KEY_TITLE);
                    String artist = m == null ? null : m.getString(MediaMetadata.METADATA_KEY_ARTIST);
                    o.put("app", c.getPackageName());
                    o.put("title", title == null ? "" : title);
                    o.put("artist", artist == null ? "" : artist);
                    o.put("playing", st != null && st.getState() == PlaybackState.STATE_PLAYING);
                }
            } catch (SecurityException e) {
                try {
                    o.put("perm", false);
                } catch (Exception ignored) {
                }
            } catch (Exception ignored) {
            }
            return o.toString();
        }

        /** Pochette du morceau en cours : JPEG en base64, ou "". */
        @JavascriptInterface
        public String playerArt() {
            try {
                MediaController c = controller();
                MediaMetadata m = c == null ? null : c.getMetadata();
                if (m == null) return "";
                Bitmap b = m.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART);
                if (b == null) b = m.getBitmap(MediaMetadata.METADATA_KEY_ART);
                if (b == null) b = m.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON);
                if (b == null) return "";
                int side = Math.max(b.getWidth(), b.getHeight());
                if (side > 320) {
                    b = Bitmap.createScaledBitmap(b, Math.max(1, b.getWidth() * 320 / side), Math.max(1, b.getHeight() * 320 / side), true);
                }
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                b.compress(Bitmap.CompressFormat.JPEG, 82, out);
                return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
            } catch (Throwable e) {
                return "";
            }
        }

        /** toggle, next, prev ; "perm" ouvre le réglage Android d'accès aux notifications. */
        @JavascriptInterface
        public void playerCmd(final String cmd) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        if ("perm".equals(cmd)) {
                            startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS));
                            return;
                        }
                        MediaController c = controller();
                        if (c == null) return;
                        MediaController.TransportControls t = c.getTransportControls();
                        if ("next".equals(cmd)) t.skipToNext();
                        else if ("prev".equals(cmd)) t.skipToPrevious();
                        else {
                            PlaybackState st = c.getPlaybackState();
                            if (st != null && st.getState() == PlaybackState.STATE_PLAYING) t.pause();
                            else t.play();
                        }
                    } catch (Exception ignored) {
                    }
                }
            });
        }

        /** Volume média du téléphone, de 0 à 1. */
        @JavascriptInterface
        public void playerVol(float v) {
            try {
                int max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
                audio.setStreamVolume(AudioManager.STREAM_MUSIC, Math.max(0, Math.min(max, Math.round(v * max))), 0);
            } catch (Exception ignored) {
            }
        }

        /** 0 : rend la main ; 1 : les autres applis baissent leur son ; 2 : elles se mettent en pause. */
        @JavascriptInterface
        public void duck(final int mode) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    focus(mode);
                }
            });
        }

        @JavascriptInterface
        public void setLang(String lang) {
            french = !"en".equals(lang);
        }

        @JavascriptInterface
        public void exportBegin(String name) {
            closeExport();
            exportFailed = false;
            try {
                File dir = ExportProvider.dir(MainActivity.this);
                if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("mkdir");
                File[] old = dir.listFiles();
                if (old != null) for (File f : old) f.delete();
                String safe = String.valueOf(name).replaceAll("[^A-Za-z0-9._-]", "_");
                if (!safe.endsWith(".boucan")) safe += ".boucan";
                exportFile = new File(dir, safe);
                exportOut = new BufferedOutputStream(new FileOutputStream(exportFile));
            } catch (IOException e) {
                exportFailed = true;
            }
        }

        @JavascriptInterface
        public void exportChunk(String b64) {
            if (exportFailed || exportOut == null) return;
            try {
                exportOut.write(Base64.decode(b64, Base64.DEFAULT));
            } catch (Exception e) {
                exportFailed = true;
            }
        }

        @JavascriptInterface
        public void exportEnd(final String action) {
            try {
                if (exportOut != null) exportOut.close();
            } catch (IOException e) {
                exportFailed = true;
            }
            exportOut = null;
            if (exportFailed || exportFile == null) {
                tell("exportFail");
                return;
            }
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if ("share".equals(action)) shareExport();
                    else saveExport();
                }
            });
        }
    }
}
