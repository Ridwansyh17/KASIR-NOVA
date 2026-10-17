package id.kasirnova.kasir;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/**
 * Activity utama KASIR NOVA (Android).
 *
 * Mendaftarkan plugin kustom sebelum bridge Capacitor diinisialisasi, agar dapat
 * dipanggil dari JS lewat `window.Capacitor.Plugins.<Nama>`:
 *   - `NovaPrinter` — cetak thermal Bluetooth (Fase 17).
 *   - `NovaReceipt` — kirim/simpan/cetak struk PDF (17 Okt 2026).
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NovaPrinterPlugin.class);
        registerPlugin(NovaReceiptPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
