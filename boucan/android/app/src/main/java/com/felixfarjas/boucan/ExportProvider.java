package com.felixfarjas.boucan;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * Donne aux apps de partage un accès en lecture seule au fichier .boucan
 * exporté (dossier cache/export), et à rien d'autre.
 */
public class ExportProvider extends ContentProvider {

    static File dir(Context c) {
        return new File(c.getCacheDir(), "export");
    }

    static Uri uriFor(Context c, File f) {
        return new Uri.Builder().scheme("content").authority(c.getPackageName() + ".export")
                .appendPath(f.getName()).build();
    }

    private File resolve(Uri uri) throws FileNotFoundException {
        String name = uri.getLastPathSegment();
        if (name == null || name.contains("/") || name.contains("..") || !name.endsWith(".boucan")) {
            throw new FileNotFoundException();
        }
        File f = new File(dir(getContext()), name);
        if (!f.isFile()) throw new FileNotFoundException();
        return f;
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        return ParcelFileDescriptor.open(resolve(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        File f;
        try {
            f = resolve(uri);
        } catch (FileNotFoundException e) {
            return null;
        }
        String[] cols = projection != null ? projection : new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
        Object[] row = new Object[cols.length];
        for (int i = 0; i < cols.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(cols[i])) row[i] = f.getName();
            else if (OpenableColumns.SIZE.equals(cols[i])) row[i] = f.length();
        }
        MatrixCursor c = new MatrixCursor(cols, 1);
        c.addRow(row);
        return c;
    }

    @Override
    public String getType(Uri uri) {
        return "application/octet-stream";
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] args) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] args) {
        return 0;
    }
}
