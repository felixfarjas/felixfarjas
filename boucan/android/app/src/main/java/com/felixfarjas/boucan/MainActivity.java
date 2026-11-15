package com.felixfarjas.boucan;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.audiofx.AudioEffect;
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

import org.json.JSONObject;

import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

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
    private PhoneFx phoneFx; // effets sur le son des autres applis (Android 9+)
    private final SessionReceiver sessions = new SessionReceiver();

    @Override
    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setVolumeControlStream(AudioManager.STREAM_MUSIC);
        vibrator = (Vibrator) getSystemService(VIBRATOR_SERVICE);

        if (Build.VERSION.SDK_INT >= 28) phoneFx = new PhoneFx(this);
        // Les lecteurs de musique annoncent leur session audio : on écoute aussi
        // tant que l'app tourne (le manifeste, lui, écoute quand elle est fermée).
        IntentFilter f = new IntentFilter(AudioEffect.ACTION_OPEN_AUDIO_EFFECT_CONTROL_SESSION);
        f.addAction(AudioEffect.ACTION_CLOSE_AUDIO_EFFECT_CONTROL_SESSION);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(sessions, f, RECEIVER_EXPORTED);
        else registerReceiver(sessions, f);
        SessionReceiver.listener = new Runnable() {
            @Override
            public void run() {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (web != null) web.evaluateJavascript("window.Boucan&&Boucan.natChanged&&Boucan.natChanged()", null);
                    }
                });
            }
        };
        equalizerIntent(getIntent());

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
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        equalizerIntent(intent);
    }

    /** Un lecteur ouvre Boucan comme « égaliseur » : il donne sa session audio. */
    private void equalizerIntent(Intent intent) {
        if (intent == null || !AudioEffect.ACTION_DISPLAY_AUDIO_EFFECT_CONTROL_PANEL.equals(intent.getAction())) return;
        SessionReceiver.note(this, intent);
        setResult(RESULT_OK);
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
        SessionReceiver.listener = null;
        try {
            unregisterReceiver(sessions);
        } catch (RuntimeException ignored) {
        }
        if (phoneFx != null) phoneFx.release();
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

    /** Appelé depuis la page : le fichier arrive par morceaux en base64. */
    private final class Bridge {
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

        /** Prépare ou libère les effets sur le son des autres applis ; renvoie l'état en JSON. */
        @JavascriptInterface
        public String phoneFxSetup(boolean on, boolean forceGlobal) {
            if (phoneFx == null) return "{\"mode\":\"none\"}";
            try {
                return phoneFx.setup(on, forceGlobal);
            } catch (Throwable e) {
                return "{\"mode\":\"fail\"}";
            }
        }

        @JavascriptInterface
        public void phoneFx(float hc, float lc, float rev, float gateHz, float gateDepth, boolean kill, int brakeMs, int sweepMs) {
            if (phoneFx == null) return;
            try {
                phoneFx.set(hc, lc, rev, gateHz, gateDepth, kill, brakeMs, sweepMs);
            } catch (Throwable ignored) {
            }
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
