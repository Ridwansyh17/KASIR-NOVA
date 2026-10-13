package id.kasirnova.kasir;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/**
 * Activity utama KASIR NOVA (Android).
 *
 * Mendaftarkan plugin kustom `NovaPrinter` (cetak thermal Bluetooth) sebelum
 * bridge Capacitor diinisialisasi, agar dapat dipanggil dari JS lewat
 * `window.Capacitor.Plugins.NovaPrinter`.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NovaPrinterPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
