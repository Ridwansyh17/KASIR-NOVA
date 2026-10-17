package id.kasirnova.kasir;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import android.util.Base64;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Plugin Capacitor "NovaReceipt" — KIRIM / SIMPAN / CETAK STRUK PDF.
 *
 * WebView Android TIDAK mendukung unduhan berkas, `navigator.share`, maupun
 * `window.print`, sehingga struk PDF dari panel Kasir (`apps/kasir`) harus
 * melewati jembatan native ini:
 *
 *   - `share({ filename, base64, mime, title, text })`
 *       Menulis berkas ke cacheDir/struk/ lalu membuka lembar berbagi Android
 *       (WhatsApp, e-mail, Drive, "Simpan ke File", ...).
 *   - `save({ filename, base64, mime })`
 *       Membuka pemilih berkas sistem (`ACTION_CREATE_DOCUMENT`) agar kasir
 *       memilih folder penyimpanan; berkas dituliskan setelah dikonfirmasi.
 *   - `print({ filename, base64, jobName })`
 *       Mengirim berkas PDF ke layanan cetak Android (termasuk opsi
 *       "Save as PDF" pada HP tanpa printer).
 *
 * Berkas PDF dibentuk di JS (`apps/kasir/src/receipt-pdf.js`, tanpa pustaka
 * pihak ketiga) dan dikirim sebagai base64 — jadi tata letak struk hanya ada
 * SATU sumber (JavaScript), sama dengan struk thermal ESC/POS.
 *
 * Berkas sementara dibagikan lewat FileProvider (authority `${applicationId}.fileprovider`,
 * sudah dideklarasikan di AndroidManifest.xml dengan `cache-path`).
 */
@CapacitorPlugin(name = "NovaReceipt")
public class NovaReceiptPlugin extends Plugin {

    private static final String CACHE_DIR = "struk";
    private static final String MIME_PDF = "application/pdf";

    /** Nama berkas aman (tanpa pemisah folder / karakter aneh). */
    private static String sanitize(String name) {
        String n = (name == null || name.trim().isEmpty()) ? "Struk.pdf" : name.trim();
        String safe = n.replaceAll("[^A-Za-z0-9._-]", "-");
        return safe.isEmpty() ? "Struk.pdf" : safe;
    }

    private byte[] bytesOrFail(PluginCall call, String base64) {
        if (base64 == null || base64.isEmpty()) {
            call.reject("Berkas struk kosong.");
            return null;
        }
        try {
            return Base64.decode(base64, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("Berkas struk tidak valid.");
            return null;
        }
    }

    /**
     * Jumlah halaman yang dilaporkan ke layanan cetak, dibaca dari pohon halaman
     * PDF (`/Count n`). Nilai yang tepat membuat pratinjau cetak Android benar;
     * bila tidak terbaca, kembalikan PAGE_COUNT_UNKNOWN (framework membaca semua
     * halaman dari berkas).
     *
     * Pencocokan memakai kejadian PERTAMA: objek `/Pages` selalu ditulis sebelum
     * isi halaman, sehingga teks produk yang kebetulan memuat "/Count" (di dalam
     * literal string) tidak pernah menyesatkan.
     */
    private static int pdfPageCount(byte[] bytes) {
        String text = new String(bytes, java.nio.charset.StandardCharsets.ISO_8859_1);
        java.util.regex.Matcher matcher =
            java.util.regex.Pattern.compile("/Count\\s+(\\d+)").matcher(text);
        if (matcher.find()) {
            try {
                int count = Integer.parseInt(matcher.group(1));
                if (count > 0) return count;
            } catch (NumberFormatException ignored) {
                /* jatuh ke PAGE_COUNT_UNKNOWN */
            }
        }
        return PrintDocumentInfo.PAGE_COUNT_UNKNOWN;
    }

    /** Tulis byte ke cacheDir/struk/<nama> dan kembalikan berkasnya. */
    private File writeTemp(String filename, byte[] bytes) throws IOException {
        File dir = new File(getContext().getCacheDir(), CACHE_DIR);
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("Folder sementara tidak dapat dibuat");
        File file = new File(dir, sanitize(filename));
        try (OutputStream os = new FileOutputStream(file)) {
            os.write(bytes);
        }
        return file;
    }

    private Uri uriFor(File file) {
        return FileProvider.getUriForFile(
            getContext(), getContext().getPackageName() + ".fileprovider", file);
    }

    /** KIRIM struk PDF lewat lembar berbagi Android. */
    @PluginMethod
    public void share(PluginCall call) {
        byte[] bytes = bytesOrFail(call, call.getString("base64"));
        if (bytes == null) return;
        try {
            File file = writeTemp(call.getString("filename", "Struk.pdf"), bytes);
            String title = call.getString("title", "Kirim struk");
            Intent intent = new Intent(Intent.ACTION_SEND);
            intent.setType(call.getString("mime", MIME_PDF));
            intent.putExtra(Intent.EXTRA_STREAM, uriFor(file));
            intent.putExtra(Intent.EXTRA_SUBJECT, call.getString("title", "Struk"));
            String text = call.getString("text", "");
            if (text != null && !text.isEmpty()) intent.putExtra(Intent.EXTRA_TEXT, text);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            Intent chooser = Intent.createChooser(intent, title);
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(chooser);

            JSObject res = new JSObject();
            res.put("shared", true);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("Gagal mengirim struk: " + e.getMessage());
        }
    }

    /** SIMPAN struk PDF ke folder pilihan kasir (pemilih berkas sistem). */
    @PluginMethod
    public void save(PluginCall call) {
        byte[] bytes = bytesOrFail(call, call.getString("base64"));
        if (bytes == null) return;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("mime", MIME_PDF));
        intent.putExtra(Intent.EXTRA_TITLE, sanitize(call.getString("filename", "Struk.pdf")));
        startActivityForResult(call, intent, "saveResult");
    }

    /** Hasil pemilih berkas: tuliskan berkas PDF ke lokasi pilihan kasir. */
    @ActivityCallback
    private void saveResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result == null
            || result.getResultCode() != Activity.RESULT_OK
            || result.getData() == null
            || result.getData().getData() == null) {
            call.reject("Penyimpanan dibatalkan.");
            return;
        }
        try {
            byte[] bytes = Base64.decode(call.getString("base64", ""), Base64.DEFAULT);
            try (OutputStream os = getContext().getContentResolver()
                .openOutputStream(result.getData().getData())) {
                if (os == null) throw new IOException("Lokasi tujuan tidak dapat dibuka");
                os.write(bytes);
                os.flush();
            }
            JSObject res = new JSObject();
            res.put("saved", true);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("Gagal menyimpan struk: " + e.getMessage());
        }
    }

    /**
     * CETAK struk PDF lewat layanan cetak Android (tersedia juga "Save as PDF").
     *
     * Berkas PDF di JS sudah lengkap, jadi adaptor cetak hanya menyalurkan
     * byte-nya ke tujuan cetak (kontrak `PrintDocumentAdapter.onWrite` memang
     * menerima berkas PDF). Jumlah halaman dibaca dari berkas (`pdfPageCount`)
     * supaya pratinjau cetak Android akurat.
     */
    @PluginMethod
    public void print(PluginCall call) {
        final byte[] bytes = bytesOrFail(call, call.getString("base64"));
        if (bytes == null) return;
        final String jobName = call.getString("jobName", call.getString("filename", "Struk"));

        PrintManager manager = (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);
        if (manager == null) {
            call.reject("Layanan cetak Android tidak tersedia di perangkat ini.");
            return;
        }

        try {
            PrintDocumentAdapter adapter = new PrintDocumentAdapter() {
                @Override
                public void onLayout(PrintAttributes oldAttributes, PrintAttributes newAttributes,
                                     CancellationSignal signal, LayoutResultCallback callback, Bundle extras) {
                    if (signal.isCanceled()) {
                        callback.onLayoutCancelled();
                        return;
                    }
                    PrintDocumentInfo info = new PrintDocumentInfo.Builder(sanitize(jobName) + ".pdf")
                        .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
                        .setPageCount(pdfPageCount(bytes))
                        .build();
                    callback.onLayoutFinished(info, true);
                }

                @Override
                public void onWrite(PageRange[] pages, ParcelFileDescriptor destination,
                                    CancellationSignal signal, WriteResultCallback callback) {
                    try (InputStream in = new ByteArrayInputStream(bytes);
                         OutputStream out = new FileOutputStream(destination.getFileDescriptor())) {
                        byte[] buffer = new byte[8192];
                        int read;
                        while ((read = in.read(buffer)) > 0) {
                            if (signal.isCanceled()) {
                                callback.onWriteCancelled();
                                return;
                            }
                            out.write(buffer, 0, read);
                        }
                        out.flush();
                        callback.onWriteFinished(new PageRange[] { PageRange.ALL_PAGES });
                    } catch (Exception e) {
                        callback.onWriteFailed(e.getMessage());
                    }
                }
            };
            manager.print(jobName, adapter, new PrintAttributes.Builder().build());

            JSObject res = new JSObject();
            res.put("printed", true);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("Gagal mencetak struk: " + e.getMessage());
        }
    }
}
