/**
 * Uji CORS (Fase 17).
 *
 * Aplikasi Android (APK Capacitor) berjalan di WebView dengan origin
 * `https://localhost` (androidScheme=https) / `capacitor://localhost` (iOS).
 * Origin ini harus diizinkan agar aplikasi mobile dapat memanggil API.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from './helpers/request.js';

test('CORS: https://localhost (WebView Capacitor Android) diizinkan', async () => {
  const res = await request.get('/api/health', { headers: { Origin: 'https://localhost' } });
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://localhost');
  assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
});

test('CORS: capacitor://localhost (Capacitor iOS) diizinkan', async () => {
  const res = await request.get('/api/health', { headers: { Origin: 'capacitor://localhost' } });
  assert.equal(res.headers.get('access-control-allow-origin'), 'capacitor://localhost');
});

test('CORS: origin tak dikenal tidak diberi izin', async () => {
  const res = await request.get('/api/health', { headers: { Origin: 'https://evil.example' } });
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});
