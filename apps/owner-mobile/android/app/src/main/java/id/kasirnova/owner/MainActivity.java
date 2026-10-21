package id.kasirnova.owner;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/**
 * Activity utama OWNER NOVA (Android).
 *
 * Panel Owner tidak memakai plugin kustom (tanpa printer thermal Bluetooth),
 * sehingga cukup BridgeActivity standar Capacitor.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
    }
}
