/**
 * Helper untuk tes integrasi HTTP.
 *
 * Menghidupkan server di port acak (0) agar tidak bentrok, lalu
 * menyediakan client sederhana berdasarkan fetch.
 */
import { after, before } from 'node:test';
import { createServer } from 'node:http';
import app from '../../src/app.js';

let server = null;
let baseUrl = null;

async function start() {
  if (server) return baseUrl;
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
  return baseUrl;
}

async function stop() {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
  server = null;
  baseUrl = null;
}

// Matikan server setelah SEMUA tes selesai, agar proses node --test bisa keluar
before(async () => { await start(); });
after(async () => { await stop(); });

async function req(path, options = {}) {
  const base = await start();
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  let body = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, body, headers: res.headers };
}

export const request = {
  get: (path, opts) => req(path, { ...opts, method: 'GET' }),
  post: (path, data, opts) =>
    req(path, { ...opts, method: 'POST', body: JSON.stringify(data ?? {}) }),
  put: (path, data, opts) =>
    req(path, { ...opts, method: 'PUT', body: JSON.stringify(data ?? {}) }),
  patch: (path, data, opts) =>
    req(path, { ...opts, method: 'PATCH', body: JSON.stringify(data ?? {}) }),
  del: (path, opts) => req(path, { ...opts, method: 'DELETE' }),
  stop,
};

export default request;
