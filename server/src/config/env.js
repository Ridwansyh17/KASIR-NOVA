/**
 * Memuat & memvalidasi variabel lingkungan.
 * Fail-fast: server menolak start bila env wajib kosong.
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env') });

const required = [
  'DATABASE_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
];

const missing = required.filter((key) => !process.env[key] || process.env[key].startsWith('dev_') === false && !process.env[key]);

// Validasi: env wajib harus ada & JWT secret tidak boleh default
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL wajib diisi. Salin server/.env.example menjadi server/.env');
}
if (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET) {
  throw new Error('JWT_ACCESS_SECRET & JWT_REFRESH_SECRET wajib diisi');
}
if (process.env.JWT_ACCESS_SECRET.length < 16 || process.env.JWT_REFRESH_SECRET.length < 16) {
  throw new Error('JWT secret minimal 16 karakter');
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL,
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },
  corsOrigin: (() => {
    const list = (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    // Izinkan same-origin (frontend yang disajikan Express) tanpa konfigurasi
    // tambahan. Render & Vercel menyediakan URL publik service via env.
    const render = process.env.RENDER_EXTERNAL_URL;
    if (render && !list.includes(render)) list.push(render);
    const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
    if (vercel) {
      const origin = vercel.startsWith('http') ? vercel : `https://${vercel}`;
      if (!list.includes(origin)) list.push(origin);
    }
    // Aplikasi Android (APK) berjalan di WebView Capacitor dengan origin
    // https://localhost (server.androidScheme = 'https'); iOS memakai
    // capacitor://localhost. Origin lokal ini diizinkan default agar APK dapat
    // memanggil API tanpa konfigurasi CORS tambahan. Bukan origin publik.
    for (const localOrigin of ['https://localhost', 'capacitor://localhost', 'http://localhost']) {
      if (!list.includes(localOrigin)) list.push(localOrigin);
    }
    return list;
  })(),
  // ------------------------------------------------------- Pembayaran langganan
  // Gateway pembayaran untuk langganan (uji coba memakai SANDBOX Duitku).
  // OPSIONAL & tidak fatal: bila belum dikonfigurasi, server tetap berjalan dan
  // endpoint pembayaran langganan menjawab 503 (lihat src/payments/index.js).
  // Rahasia hanya dibaca dari lingkungan; tidak pernah masuk basis data/log.
  payments: (() => {
    const num = (value, fallback) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    const list = (value, fallback) => {
      const items = String(value ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      return items.length > 0 ? items : fallback;
    };
    const mode = String(process.env.PAYMENT_MODE ?? 'sandbox').trim().toLowerCase();
    // URL dasar API publik (dipakai menyusun callbackUrl/returnUrl default).
    const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
    const apiBaseUrl = String(
      process.env.PAYMENT_API_BASE_URL ??
        process.env.RENDER_EXTERNAL_URL ??
        (vercelUrl ? `https://${vercelUrl}` : '')
    )
      .trim()
      .replace(/\/+$/, '');

    return {
      provider: String(process.env.PAYMENT_PROVIDER ?? 'disabled').trim().toLowerCase(),
      mode: mode === 'production' ? 'production' : 'sandbox',
      // Kunci pengaman: endpoint produksi (uang nyata) wajib dinyalakan eksplisit.
      allowProduction: process.env.PAYMENT_ALLOW_PRODUCTION === 'true',
      channels: list(process.env.PAYMENT_CHANNELS, ['BC', 'I1', 'M2', 'BR']).map((c) =>
        c.toUpperCase()
      ),
      expiryMinutes: Math.max(1, Math.floor(num(process.env.PAYMENT_EXPIRY_MINUTES, 1440))),
      minAmountIdr: Math.max(1, Math.floor(num(process.env.PAYMENT_MIN_AMOUNT_IDR, 10000))),
      callbackUrl: String(process.env.PAYMENT_CALLBACK_URL ?? '').trim(),
      returnUrl: String(process.env.PAYMENT_RETURN_URL ?? '').trim(),
      apiBaseUrl,
      ownerPanelUrl: String(
        process.env.PAYMENT_OWNER_PANEL_URL ?? process.env.OWNER_PANEL_URL ?? ''
      )
        .trim()
        .replace(/\/+$/, ''),
      callbackIpAllowlist: list(process.env.PAYMENT_CALLBACK_IP_ALLOWLIST, []),
      duitku: {
        merchantCode: String(process.env.DUITKU_MERCHANT_CODE ?? '').trim(),
        apiKey: String(process.env.DUITKU_API_KEY ?? '').trim(),
        baseUrl: String(process.env.DUITKU_BASE_URL ?? '').trim().replace(/\/+$/, ''),
      },
    };
  })(),
  // --------------------------------------------------- URL publik app
  app: (() => {
    const port = Number(process.env.PORT ?? 4000);
    const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
    const publicUrl = String(
      process.env.APP_PUBLIC_URL ??
        process.env.PAYMENT_API_BASE_URL ??
        process.env.RENDER_EXTERNAL_URL ??
        (vercelUrl ? `https://${vercelUrl}` : `http://localhost:${port}`)
    )
      .trim()
      .replace(/\/+$/, '');
    const ownerPanelUrl = String(
      process.env.APP_OWNER_PANEL_URL ??
        process.env.PAYMENT_OWNER_PANEL_URL ??
        process.env.OWNER_PANEL_URL ??
        `${publicUrl}/owner`
    )
      .trim()
      .replace(/\/+$/, '');
    return {
      publicUrl,
      ownerPanelUrl,
      // Nomor Admin Platform untuk permintaan approval pendaftaran Owner.
      supportWhatsapp: String(process.env.SUPPORT_WHATSAPP ?? '6281359704766').replace(
        /\D/g,
        ''
      ),
    };
  })(),
  isProduction: process.env.NODE_ENV === 'production',
  // Opsional: paksa penyajian app statis dari Express walau di produksi.
  // Berguna untuk host yang menyajikan app + API same-origin (mis. Render).
  serveStatic: process.env.SERVE_STATIC === 'true',
};

export default env;
