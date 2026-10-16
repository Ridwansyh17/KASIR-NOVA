/**
 * Tes regresi "PERSISTENT LOGIN" (FASE 4) untuk seluruh klien API panel.
 *
 * AKAR BUG LAMA: setelah aplikasi/tab ditutup, `sessionStorage` (tempat
 * access token) selalu kosong sehingga pengguna dipaksa login ulang meskipun
 * refresh token di `localStorage` masih valid. Khusus panel Kasir, bootstrap
 * hanya memeriksa `tokenStore.access`, jadi refresh token TIDAK PERNAH dipakai.
 *
 * Tes ini mengunci perilaku pemulihan sesi yang benar pada modul `api.js`
 * (kasir/owner/admin) TANPA browser: storage dan `fetch` diganti stub.
 *
 * Jalankan dari root repo:
 *   node --test scripts/test-auth-restore.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Storage palsu berbasis Map (menggantikan sessionStorage/localStorage). */
const makeStorage = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
};

/**
 * Muat `apps/<app>/src/api.js` sebagai ESM. Folder `apps/*` tidak punya
 * package.json sendiri (default CommonJS), jadi modul dimuat lewat `data:`
 * URL agar sintaks `export` tetap valid.
 */
const loadApi = (app) => {
  const src = readFileSync(join(root, 'apps', app, 'src', 'api.js'), 'utf8');
  const url = `data:text/javascript;base64,${Buffer.from(src).toString('base64')}`;
  return import(url);
};

const setup = async (app = 'kasir') => {
  globalThis.sessionStorage = makeStorage();
  globalThis.localStorage = makeStorage();
  return loadApi(app);
};

/** Stub `fetch`: handler mengembalikan `{ status, body }` per URL. */
const stubFetch = (handler) => {
  globalThis.fetch = async (url, options = {}) => {
    const out = handler(String(url), options);
    if (!out) throw new Error(`URL tak terduga pada stub fetch: ${url}`);
    const { status = 200, body } = out;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (body === undefined ? '' : JSON.stringify(body)),
    };
  };
};

// ---------------------------------------------------------------------------
// Inti bug: aplikasi dibuka kembali, access token hilang, refresh masih valid.
// ---------------------------------------------------------------------------
test('kasir: sesi dipulihkan dari refresh token saat access token hilang', async () => {
  const api = await setup('kasir');
  api.tokenStore.save({ refreshToken: 'REFRESH-1' }); // tanpa access token

  assert.equal(api.tokenStore.access, null, 'access token memang kosong');
  assert.equal(api.tokenStore.hasSession, true, 'refresh token tetap terdeteksi');

  const calls = [];
  stubFetch((url, options) => {
    calls.push(url);
    if (url.endsWith('/api/auth/refresh')) {
      assert.equal(JSON.parse(options.body).refreshToken, 'REFRESH-1');
      return { status: 200, body: { accessToken: 'ACCESS-2', refreshToken: 'REFRESH-2' } };
    }
    if (url.endsWith('/api/auth/me')) {
      return options.headers?.Authorization === 'Bearer ACCESS-2'
        ? {
            status: 200,
            body: {
              user: { id: 'u1', fullName: 'Kasir Uji', role: 'cashier' },
              context: { outlet: { id: 'o1', name: 'Outlet Uji' } },
            },
          }
        : { status: 401, body: { error: { message: 'unauthorized' } } };
    }
    return null;
  });

  const body = await api.restoreSession();
  assert.ok(body?.user, 'sesi harus berhasil dipulihkan');
  assert.equal(body.user.role, 'cashier');
  assert.equal(api.tokenStore.access, 'ACCESS-2', 'access token baru disimpan');
  assert.equal(api.tokenStore.refresh, 'REFRESH-2', 'refresh token dirotasi & disimpan');
  assert.deepEqual(calls, ['/api/auth/me', '/api/auth/refresh', '/api/auth/me']);
});

test('tanpa sesi tersimpan: null dan TIDAK memanggil server', async () => {
  const api = await setup('kasir');
  let called = false;
  stubFetch(() => {
    called = true;
    return { status: 200, body: {} };
  });
  assert.equal(await api.restoreSession(), null);
  assert.equal(called, false);
});

test('access token masih valid: /me 200 tanpa memanggil /refresh', async () => {
  const api = await setup('kasir');
  api.tokenStore.save({ accessToken: 'ACCESS-OK', refreshToken: 'REFRESH-1' });
  let refreshCalls = 0;
  stubFetch((url, options) => {
    if (url.endsWith('/api/auth/refresh')) {
      refreshCalls += 1;
      return { status: 200, body: {} };
    }
    return options.headers?.Authorization === 'Bearer ACCESS-OK'
      ? { status: 200, body: { user: { id: 'u1', role: 'cashier' }, context: null } }
      : { status: 401, body: {} };
  });
  const body = await api.restoreSession();
  assert.ok(body?.user);
  assert.equal(refreshCalls, 0);
});

test('refresh ditolak definitif (401): token dibersihkan, sesi berakhir', async () => {
  const api = await setup('kasir');
  api.tokenStore.save({ accessToken: 'ACCESS-EXPIRED', refreshToken: 'REFRESH-DEAD' });
  stubFetch((url) => {
    if (url.endsWith('/api/auth/refresh')) {
      return { status: 401, body: { error: { message: 'Refresh token sudah dicabut' } } };
    }
    return { status: 401, body: { error: { message: 'unauthorized' } } };
  });
  assert.equal(await api.restoreSession(), null);
  assert.equal(api.tokenStore.hasSession, false, 'token harus dibersihkan');
  assert.equal(api.tokenStore.access, null);
  assert.equal(api.tokenStore.refresh, null);
});

test('kegagalan jaringan saat refresh: token TIDAK dihapus (tetap login)', async () => {
  const api = await setup('kasir');
  api.tokenStore.save({ refreshToken: 'REFRESH-1' });
  stubFetch(() => {
    throw new Error('network down');
  });

  await assert.rejects(
    () => api.restoreSession(),
    (err) => {
      assert.equal(api.tokenStore.hasSession, true, 'token harus dipertahankan');
      assert.equal(api.tokenStore.refresh, 'REFRESH-1');
      return err instanceof Error;
    }
  );
});

test('race antar-instance: refresh 401 karena token sudah dirotasi tab lain', async () => {
  const api = await setup('kasir');
  api.tokenStore.save({ refreshToken: 'REFRESH-OLD' });
  let refreshCalls = 0;
  stubFetch((url, options) => {
    if (url.endsWith('/api/auth/refresh')) {
      refreshCalls += 1;
      const sent = JSON.parse(options.body).refreshToken;
      if (sent === 'REFRESH-OLD') {
        // Instance lain merotasi lebih dulu: token baru sudah tersimpan.
        api.tokenStore.save({ refreshToken: 'REFRESH-NEW' });
        return { status: 401, body: { error: { message: 'sudah dicabut' } } };
      }
      assert.equal(sent, 'REFRESH-NEW', 'percobaan kedua memakai token terbaru');
      return { status: 200, body: { accessToken: 'ACCESS-N', refreshToken: 'REFRESH-N2' } };
    }
    return options.headers?.Authorization === 'Bearer ACCESS-N'
      ? { status: 200, body: { user: { id: 'u1', role: 'cashier' }, context: null } }
      : { status: 401, body: {} };
  });

  const body = await api.restoreSession();
  assert.ok(body?.user, 'sesi tetap berhasil dipulihkan');
  assert.equal(refreshCalls, 2);
  assert.equal(api.tokenStore.refresh, 'REFRESH-N2');
});

test('refresh gagal karena jaringan padahal /me 401: token tetap tersimpan', async () => {
  const api = await setup('kasir');
  api.tokenStore.save({ refreshToken: 'REFRESH-1' });
  stubFetch((url) => {
    if (url.endsWith('/api/auth/refresh')) throw new Error('network down');
    return { status: 401, body: { error: { message: 'expired' } } };
  });
  await assert.rejects(api.restoreSession(), (err) => err.status === 0);
  assert.equal(api.tokenStore.hasSession, true, 'sesi tidak boleh hilang karena jaringan');
});

test('storage diblokir: tokenStore aman (tidak melempar)', async () => {
  const blocked = () => {
    throw new Error('storage diblokir');
  };
  globalThis.sessionStorage = { getItem: blocked, setItem: blocked, removeItem: blocked };
  globalThis.localStorage = { getItem: blocked, setItem: blocked, removeItem: blocked };
  const api = await loadApi('kasir');

  assert.equal(api.tokenStore.access, null);
  assert.equal(api.tokenStore.hasSession, false);
  assert.doesNotThrow(() => api.tokenStore.save({ accessToken: 'a', refreshToken: 'b' }));
  assert.doesNotThrow(() => api.tokenStore.clear());
  assert.equal(await api.restoreSession(), null);
});

// ---------------------------------------------------------------------------
// Panel Owner & Admin harus berperilaku sama.
// ---------------------------------------------------------------------------
for (const app of ['owner', 'admin']) {
  test(`${app}: sesi dipulihkan tanpa access token`, async () => {
    const api = await setup(app);
    api.tokenStore.save({ refreshToken: 'R1' });
    stubFetch((url, options) => {
      if (url.endsWith('/api/auth/refresh')) {
        return { status: 200, body: { accessToken: 'A2', refreshToken: 'R2' } };
      }
      return options.headers?.Authorization === 'Bearer A2'
        ? { status: 200, body: { user: { id: 'u9', role: app === 'owner' ? 'owner' : 'platform_admin' } } }
        : { status: 401, body: {} };
    });
    const body = await api.restoreSession();
    assert.ok(body?.user);
    assert.equal(api.tokenStore.access, 'A2');
    assert.equal(api.tokenStore.refresh, 'R2');
  });
}
