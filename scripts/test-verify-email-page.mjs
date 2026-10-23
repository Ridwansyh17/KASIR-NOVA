/**
 * Uji perilaku halaman verifikasi email Owner tanpa peramban sungguhan.
 *
 * Memakai jsdom + fetch palsu untuk memastikan:
 *  - state diambil dari URL lalu dihapus dari address bar;
 *  - email & status diambil dari backend (bukan ditebak frontend);
 *  - peringatan email belum terkirim tampil saat `sent=0`;
 *  - tombol "Saya Sudah Verifikasi" mengaktifkan alur sukses.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const html = await readFile(new URL('../apps/owner/verify-email.html', import.meta.url), 'utf8');

test('halaman verifikasi: state, status backend, dan tombol verifikasi', async () => {
  const state = 'state-uji-verifikasi-email-1234567890';
  const dom = new JSDOM(html, {
    url: `https://kasir-nova.web.app/owner/verify-email?state=${state}&sent=0`,
    runScripts: 'outside-only',
  });
  const { window } = dom;
  const calls = [];

  global.window = window;
  global.document = window.document;
  global.localStorage = window.localStorage;
  global.sessionStorage = window.sessionStorage;

  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method ?? 'GET' });
    if (String(url).includes('/firebase/verification-status')) {
      return json({
        email: 'uji@nova.test',
        verified: false,
        canResend: true,
        retryAfterSeconds: 0,
      });
    }
    if (String(url).includes('/firebase/verify-owner')) {
      return json({ verified: true, message: 'Email berhasil diverifikasi. Silakan masuk.' });
    }
    return json({ error: { message: 'tidak diharapkan' } }, 500);
  };

  try {
    await import(`../apps/owner/src/verify-email.js?test=${Date.now()}`);

    const waitFor = async (predicate, label) => {
      for (let i = 0; i < 100; i++) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`waktu habis menunggu: ${label}`);
    };

    await waitFor(
      () => document.getElementById('verify-email').textContent === 'uji@nova.test',
      'email terisi'
    );
    assert.equal(window.location.search, '', 'state & sent dihapus dari URL');
    assert.equal(window.localStorage.getItem('nova_owner_verify_state'), state);
    assert.equal(window.localStorage.getItem('nova_owner_verify_email'), 'uji@nova.test');
    assert.match(document.getElementById('verify-message').textContent, /belum terkirim/i);
    assert.equal(document.getElementById('check-verify').disabled, false);
    assert.equal(document.getElementById('resend-verify').disabled, false);

    document.getElementById('check-verify').click();
    await waitFor(
      () => document.getElementById('back-login').textContent === 'Masuk ke panel Owner',
      'status terverifikasi'
    );
    assert.match(document.getElementById('verify-message').textContent, /berhasil diverifikasi/i);
    assert.equal(document.getElementById('check-verify').disabled, true);
    assert.equal(document.getElementById('resend-verify').disabled, true);
    assert.equal(calls.filter((c) => c.method === 'POST').length, 1);
  } finally {
    dom.window.close();
    delete global.window;
    delete global.document;
    delete global.localStorage;
    delete global.sessionStorage;
    delete global.fetch;
  }
});
