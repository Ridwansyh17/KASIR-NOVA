package id.kasirnova.kasir;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.BluetoothSocket;
import android.bluetooth.BluetoothStatusCodes;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Plugin Capacitor "NovaPrinter" — cetak ESC/POS ke printer thermal Bluetooth.
 *
 * Mendukung dua transpor:
 *   - "spp" : Classic Bluetooth (RFCOMM/SPP) — printer POS 58/80mm generik.
 *   - "ble" : Bluetooth Low Energy (GATT) — printer BLE.
 *
 * Semua data dari JS dikirim sebagai base64 (panjang byte = data.length()).
 * Byte mentah ESC/POS dibentuk di sisi web (apps/kasir/src/escpos.js).
 */
@CapacitorPlugin(
    name = "NovaPrinter",
    permissions = {
        @Permission(alias = "bluetooth", strings = {
            Manifest.permission.BLUETOOTH_CONNECT,
            Manifest.permission.BLUETOOTH_SCAN
        }),
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION })
    }
)
public class NovaPrinterPlugin extends Plugin {

    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    // Service BLE yang umum dipakai printer thermal ESC/POS.
    private static final UUID[] KNOWN_BLE_SERVICES = new UUID[] {
        UUID.fromString("0000ff00-0000-1000-8000-00805f9b34fb"),
        UUID.fromString("0000ffe0-0000-1000-8000-00805f9b34fb"),
        UUID.fromString("000018f0-0000-1000-8000-00805f9b34fb"),
        UUID.fromString("49535343-fe7d-4ae5-8fa9-9fafd205e455")
    };

    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());

    private BluetoothSocket socket;
    private OutputStream socketOut;
    private BluetoothGatt gatt;
    private BluetoothGattCharacteristic writeChar;
    private String connectedAddress;
    private String connectedName;
    private String connectedTransport;

    private BluetoothLeScanner scanner;
    private final Set<String> scanSeen = new HashSet<>();
    private final List<JSObject> scanResults = new ArrayList<>();
    private PluginCall scanCall;
    private Runnable scanTimeout;

    private PluginCall pendingConnect;

    // ---------------------------------------------------------------- util ----
    private BluetoothAdapter adapter() {
        BluetoothManager mgr = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return mgr == null ? null : mgr.getAdapter();
    }

    private boolean isGranted(String permission) {
        return ContextCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasBtPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return isGranted(Manifest.permission.BLUETOOTH_CONNECT) && isGranted(Manifest.permission.BLUETOOTH_SCAN);
        }
        return isGranted(Manifest.permission.BLUETOOTH);
    }

    private String safeName(BluetoothDevice device) {
        try {
            String n = device.getName();
            return n == null ? "" : n;
        } catch (SecurityException e) {
            return "";
        }
    }

    // Catatan: checkPermissions()/requestPermissions() disediakan kelas dasar
    // Capacitor Plugin berdasarkan anotasi @CapacitorPlugin(permissions = ...),
    // jadi TIDAK ditimpa di sini. JS memanggil requestPermissions() bawaan lalu
    // listBondedDevices()/startBleScan() yang memeriksa izin via hasBtPermissions().

    // --------------------------------------------------------- availability ---
    @PluginMethod
    public void isAvailable(PluginCall call) {
        BluetoothAdapter a = adapter();
        JSObject ret = new JSObject();
        ret.put("supported", a != null);
        ret.put("enabled", a != null && a.isEnabled());
        ret.put("connected", isConnected());
        call.resolve(ret);
    }

    private boolean isConnected() {
        return socketOut != null || (gatt != null && writeChar != null);
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("connected", isConnected());
        ret.put("address", connectedAddress);
        ret.put("name", connectedName);
        ret.put("transport", connectedTransport);
        call.resolve(ret);
    }

    // ------------------------------------------------------------- bonded -----
    @PluginMethod
    public void listBondedDevices(PluginCall call) {
        if (!hasBtPermissions()) {
            call.reject("Izin Bluetooth belum diberikan.");
            return;
        }
        BluetoothAdapter a = adapter();
        List<JSObject> devices = new ArrayList<>();
        if (a != null) {
            Set<BluetoothDevice> bonded;
            try {
                bonded = a.getBondedDevices();
            } catch (SecurityException e) {
                call.reject("Tidak dapat membaca daftar perangkat Bluetooth.");
                return;
            }
            for (BluetoothDevice d : bonded) {
                JSObject o = new JSObject();
                o.put("name", safeName(d));
                o.put("address", d.getAddress());
                o.put("type", "spp");
                devices.add(o);
            }
        }
        JSObject ret = new JSObject();
        ret.put("devices", new JSArray(devices));
        call.resolve(ret);
    }

    // ---------------------------------------------------------- BLE scan ------
    private final ScanCallback scanCallback = new ScanCallback() {
        @Override
        public void onScanResult(int callbackType, ScanResult result) {
            BluetoothDevice d = result.getDevice();
            if (d == null) return;
            String addr;
            try {
                addr = d.getAddress();
            } catch (SecurityException e) {
                return;
            }
            if (addr == null || scanSeen.contains(addr)) return;
            scanSeen.add(addr);
            JSObject o = new JSObject();
            o.put("name", safeName(d));
            o.put("address", addr);
            o.put("rssi", result.getRssi());
            scanResults.add(o);
        }

        @Override
        public void onScanFailed(int errorCode) {
            // Diamkan; pemanggil menerima hasil (mungkin kosong) saat timeout.
        }
    };

    @PluginMethod
    public void startBleScan(PluginCall call) {
        if (!hasBtPermissions()) {
            call.reject("Izin Bluetooth belum diberikan.");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S
            && !isGranted(Manifest.permission.ACCESS_FINE_LOCATION)) {
            call.reject("Izin lokasi diperlukan untuk memindai BLE di Android versi ini.");
            return;
        }
        BluetoothAdapter a = adapter();
        if (a == null || !a.isEnabled()) {
            call.reject("Bluetooth tidak aktif.");
            return;
        }
        if (scanCall != null) {
            call.reject("Pemindaian lain sedang berjalan.");
            return;
        }
        final BluetoothLeScanner leScanner = a.getBluetoothLeScanner();
        if (leScanner == null) {
            call.reject("Pemindai BLE tidak tersedia.");
            return;
        }
        scanner = leScanner;
        scanCall = call;
        scanSeen.clear();
        scanResults.clear();
        final int timeoutMs = call.getInt("timeoutMs", 8000);
        main.post(() -> {
            try {
                leScanner.startScan(scanCallback);
            } catch (SecurityException e) {
                failScan("Izin Bluetooth ditolak saat memindai.");
                return;
            }
            scanTimeout = () -> {
                try {
                    leScanner.stopScan(scanCallback);
                } catch (Exception ignored) {
                    // diabaikan
                }
                finishScan();
            };
            main.postDelayed(scanTimeout, timeoutMs);
        });
    }

    private void finishScan() {
        if (scanCall == null) return;
        JSObject ret = new JSObject();
        ret.put("devices", new JSArray(scanResults));
        PluginCall c = scanCall;
        scanCall = null;
        scanTimeout = null;
        c.resolve(ret);
    }

    private void failScan(String message) {
        if (scanCall == null) return;
        PluginCall c = scanCall;
        scanCall = null;
        scanTimeout = null;
        c.reject(message);
    }

    @PluginMethod
    public void stopBleScan(PluginCall call) {
        if (scanner != null) {
            try {
                scanner.stopScan(scanCallback);
            } catch (Exception ignored) {
                // diabaikan
            }
        }
        if (scanTimeout != null) {
            main.removeCallbacks(scanTimeout);
            scanTimeout = null;
        }
        finishScan();
        call.resolve();
    }

    // ------------------------------------------------------------ connect -----
    @PluginMethod
    public void connect(PluginCall call) {
        String address = call.getString("address");
        String transport = call.getString("transport", "spp");
        String name = call.getString("name", "");
        if (address == null) {
            call.reject("Alamat perangkat kosong.");
            return;
        }
        BluetoothAdapter a = adapter();
        if (a == null) {
            call.reject("Perangkat ini tidak mendukung Bluetooth.");
            return;
        }
        if (!a.isEnabled()) {
            call.reject("Bluetooth tidak aktif.");
            return;
        }
        if (!hasBtPermissions()) {
            call.reject("Izin Bluetooth belum diberikan.");
            return;
        }
        BluetoothDevice device;
        try {
            device = a.getRemoteDevice(address);
        } catch (IllegalArgumentException e) {
            call.reject("Alamat Bluetooth tidak valid.");
            return;
        }

        disconnectInternal();

        if ("ble".equals(transport)) {
            connectBle(device, name, call);
        } else {
            connectSpp(device, name, call);
        }
    }

    private void connectSpp(final BluetoothDevice device, final String name, final PluginCall call) {
        connectedTransport = "spp";
        io.execute(() -> {
            try {
                BluetoothSocket s = device.createRfcommSocketToServiceRecord(SPP_UUID);
                BluetoothAdapter a = adapter();
                if (a != null) {
                    try {
                        a.cancelDiscovery();
                    } catch (SecurityException ignored) {
                        // diabaikan
                    }
                }
                s.connect();
                socket = s;
                socketOut = s.getOutputStream();
                connectedAddress = device.getAddress();
                connectedName = (name == null || name.isEmpty()) ? safeName(device) : name;
                JSObject ret = new JSObject();
                ret.put("name", connectedName);
                ret.put("address", connectedAddress);
                ret.put("transport", "spp");
                call.resolve(ret);
            } catch (Exception e) {
                disconnectInternal();
                call.reject("Gagal menyambung ke printer (SPP): " + e.getMessage());
            }
        });
    }

    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(BluetoothGatt g, int status, int newState) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                try {
                    g.discoverServices();
                } catch (SecurityException e) {
                    failPendingConnect("Izin Bluetooth ditolak.");
                }
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                if (pendingConnect != null) {
                    failPendingConnect("Printer BLE terputus saat menyambung.");
                }
            }
        }

        @Override
        public void onServicesDiscovered(BluetoothGatt g, int status) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                failPendingConnect("Gagal menemukan layanan printer BLE.");
                return;
            }
            writeChar = findWriteCharacteristic(g);
            if (writeChar == null) {
                failPendingConnect("Printer BLE tidak memiliki karakteristik tulis yang dikenali.");
                return;
            }
            try {
                g.requestMtu(512);
            } catch (Exception ignored) {
                // best-effort
            }
            resolvePendingConnect();
        }
    };

    private BluetoothGattCharacteristic findWriteCharacteristic(BluetoothGatt g) {
        BluetoothGattCharacteristic fallback = null;
        for (BluetoothGattService service : g.getServices()) {
            for (BluetoothGattCharacteristic c : service.getCharacteristics()) {
                int props = c.getProperties();
                boolean writable =
                    (props & (BluetoothGattCharacteristic.PROPERTY_WRITE
                        | BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE)) != 0;
                if (!writable) continue;
                for (UUID known : KNOWN_BLE_SERVICES) {
                    if (service.getUuid().equals(known)) return c;
                }
                if (fallback == null) fallback = c;
            }
        }
        return fallback;
    }

    private void connectBle(final BluetoothDevice device, final String name, final PluginCall call) {
        connectedTransport = "ble";
        pendingConnect = call;
        connectedAddress = device.getAddress();
        connectedName = (name == null || name.isEmpty()) ? safeName(device) : name;
        main.post(() -> {
            BluetoothAdapter a = adapter();
            if (a == null) {
                failPendingConnect("Bluetooth tidak tersedia.");
                return;
            }
            gatt = device.connectGatt(getContext(), false, gattCallback);
            if (gatt == null) failPendingConnect("Gagal membuka sambungan BLE.");
        });
    }

    private void resolvePendingConnect() {
        if (pendingConnect == null) return;
        JSObject ret = new JSObject();
        ret.put("name", connectedName);
        ret.put("address", connectedAddress);
        ret.put("transport", "ble");
        PluginCall c = pendingConnect;
        pendingConnect = null;
        c.resolve(ret);
    }

    private void failPendingConnect(String message) {
        if (pendingConnect == null) return;
        PluginCall c = pendingConnect;
        pendingConnect = null;
        disconnectInternal();
        c.reject(message);
    }

    // -------------------------------------------------------------- write -----
    @PluginMethod
    public void write(PluginCall call) {
        String data = call.getString("data");
        if (data == null) {
            call.reject("Data kosong.");
            return;
        }
        final byte[] bytes;
        try {
            bytes = Base64.decode(data, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("Data bukan base64 yang valid.");
            return;
        }
        if (bytes.length == 0) {
            call.resolve();
            return;
        }
        if (socketOut != null) {
            io.execute(() -> writeSpp(bytes, call));
        } else if (gatt != null && writeChar != null) {
            io.execute(() -> writeBle(bytes, call));
        } else {
            call.reject("Printer belum tersambung.");
        }
    }

    private void writeSpp(byte[] bytes, PluginCall call) {
        OutputStream out = socketOut;
        if (out == null) {
            call.reject("Printer belum tersambung.");
            return;
        }
        try {
            int chunk = 512;
            for (int offset = 0; offset < bytes.length; offset += chunk) {
                int len = Math.min(chunk, bytes.length - offset);
                out.write(bytes, offset, len);
                out.flush();
                Thread.sleep(12);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Gagal mengirim ke printer (SPP): " + e.getMessage());
        }
    }

    private void writeBle(byte[] bytes, PluginCall call) {
        BluetoothGatt g = gatt;
        BluetoothGattCharacteristic ch = writeChar;
        if (g == null || ch == null) {
            call.reject("Printer belum tersambung.");
            return;
        }
        try {
            int chunk = 180;
            for (int offset = 0; offset < bytes.length; offset += chunk) {
                int len = Math.min(chunk, bytes.length - offset);
                byte[] part = Arrays.copyOfRange(bytes, offset, offset + len);
                boolean ok;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    int res = g.writeCharacteristic(ch, part, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
                    ok = res == BluetoothStatusCodes.SUCCESS;
                } else {
                    ch.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
                    ch.setValue(part);
                    ok = g.writeCharacteristic(ch);
                }
                if (!ok) {
                    call.reject("Gagal mengirim data ke printer BLE.");
                    return;
                }
                Thread.sleep(20);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Gagal mengirim ke printer (BLE): " + e.getMessage());
        }
    }

    // ----------------------------------------------------------- disconnect ---
    @PluginMethod
    public void disconnect(PluginCall call) {
        disconnectInternal();
        call.resolve();
    }

    private void disconnectInternal() {
        if (gatt != null) {
            try {
                gatt.disconnect();
            } catch (Exception ignored) {
                // diabaikan
            }
            try {
                gatt.close();
            } catch (Exception ignored) {
                // diabaikan
            }
            gatt = null;
        }
        writeChar = null;
        if (socket != null) {
            try {
                socket.close();
            } catch (Exception ignored) {
                // diabaikan
            }
            socket = null;
        }
        socketOut = null;
        connectedAddress = null;
        connectedName = null;
        connectedTransport = null;
    }
}
