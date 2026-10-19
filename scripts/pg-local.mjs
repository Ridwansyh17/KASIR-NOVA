/**
 * Kelola PostgreSQL lokal KASIR NOVA — ramah Termux/proot, aman & idempoten.
 *
 * LATAR BELAKANG (19 Okt 2026): menjalankan `initdb`/`postgres --check` dari
 * paket Ubuntu (/usr/lib/postgresql/18/bin) DI DALAM proot Termux menyebabkan
 * proses berhenti permanen di `ptrace_stop` (proot menahan ptrace). opencode
 * lalu menunggu tool bash selamanya. Solusinya: selalu pakai biner PostgreSQL
 * NATIF Termux (/data/data/com.termux/files/usr/bin) dan jalankan sebagai UID
 * Android aplikasi (bukan root palsu proot).
 *
 * Perintah:
 *   node scripts/pg-local.mjs status
 *   node scripts/pg-local.mjs start
 *   node scripts/pg-local.mjs stop
 *   node scripts/pg-local.mjs restart
 *
 * Opsi lingkungan (opsional):
 *   NOVA_PGDATA    direktori data (default: $PREFIX/var/lib/postgresql)
 *   NOVA_PGLOG     berkas log     (default: <PGDATA>/server.log)
 *   NOVA_PGSOCKET  direktori socket Unix (default: $PREFIX/tmp)
 *   NOVA_PGPORT    port TCP       (default: 5432)
 *   NOVA_PG_CTL / NOVA_PG_ISREADY  path biner kustom
 *
 * Tidak pernah menjalankan initdb, tidak pernah menulis ke database, dan tidak
 * menyentuh database remote: hanya mengelola instance LOKAL.
 */
import { existsSync, readFileSync, readlinkSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const TERMUX_PREFIX = process.env.PREFIX || '/data/data/com.termux/files/usr';
const PGDATA = resolve(process.env.NOVA_PGDATA || join(TERMUX_PREFIX, 'var/lib/postgresql'));
const PGLOG = resolve(process.env.NOVA_PGLOG || join(PGDATA, 'server.log'));
const SOCKET_DIR = resolve(process.env.NOVA_PGSOCKET || join(TERMUX_PREFIX, 'tmp'));
const PORT = String(process.env.NOVA_PGPORT || '5432');

const bin = (name) =>
  process.env[`NOVA_${name.toUpperCase()}`] || join(TERMUX_PREFIX, 'bin', name);
const PG_CTL = bin('pg_ctl');
const PG_ISREADY = bin('pg_isready');

const log = (msg) => console.log(`[pg] ${msg}`);
const fail = (msg) => {
  console.error(`[pg] ${msg}`);
  process.exit(1);
};

/** Deteksi berjalan di dalam proot-distro (Ubuntu) di atas Termux. */
function insideProot() {
  if (existsSync('/.l2s')) return true;
  try {
    return readlinkSync('/proc/self/root').includes('proot-distro');
  } catch {
    return false;
  }
}

/** UID/GID Android asli (proot memalsukan getuid() menjadi 0). */
function realIds() {
  try {
    const status = readFileSync('/proc/self/status', 'utf8');
    const uid = Number(/^Uid:\s+(\d+)/m.exec(status)?.[1]);
    const gid = Number(/^Gid:\s+(\d+)/m.exec(status)?.[1]);
    if (Number.isInteger(uid) && Number.isInteger(gid)) return { uid, gid };
  } catch {
    /* abaikan */
  }
  return null;
}

/**
 * Bungkus perintah dengan setpriv bila kita root-palsu proot: server harus
 * berjalan sebagai UID pemilik PGDATA agar tidak menolak start.
 */
function runner() {
  const proot = insideProot();
  const ids = proot ? realIds() : null;
  const isRoot = process.getuid?.() === 0;
  if (!proot || !ids || ids.uid === 0 || !isRoot) {
    return { wrap: (binPath, args) => [binPath, args], proot };
  }
  if (!existsSync('/usr/bin/setpriv')) {
    fail('setpriv tidak tersedia; jalankan perintah ini dari Termux (bukan proot).');
  }
  const prefix = [`--reuid=${ids.uid}`, `--regid=${ids.gid}`, '--clear-groups'];
  return {
    wrap: (binPath, args) => ['/usr/bin/setpriv', [...prefix, binPath, ...args]],
    proot,
    ids,
  };
}

function run(cmd, args, { capture = false } = {}) {
  const res = spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (res.error?.code === 'ENOENT') {
    fail(`Perintah '${cmd}' tidak ditemukan. Pastikan PostgreSQL Termux terpasang.`);
  }
  return { code: res.status ?? 1, out: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

const runWrapped = (binPath, args, opts) => {
  const [cmd, argv] = runner().wrap(binPath, args);
  return run(cmd, argv, opts);
};

const pgCtl = (args, opts) => runWrapped(PG_CTL, args, opts);
const pgIsReady = (opts) =>
  runWrapped(PG_ISREADY, ['-h', '127.0.0.1', '-p', PORT], opts);

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Bersihkan sisa lock/socket dari instance yang sudah mati (bukan data). */
function cleanupStale() {
  const pidFile = join(PGDATA, 'postmaster.pid');
  if (existsSync(pidFile)) {
    const pid = Number(readFileSync(pidFile, 'utf8').split('\n')[0]);
    if (!pidAlive(pid)) {
      rmSync(pidFile, { force: true });
      log(`hapus postmaster.pid basi (PID ${pid} sudah mati)`);
    }
  }
  const sock = join(SOCKET_DIR, `.s.PGSQL.${PORT}`);
  const sockLock = `${sock}.lock`;
  if (existsSync(sockLock) && !existsSync(sock)) {
    rmSync(sockLock, { force: true });
    log('hapus lock socket basi');
  }
}

function requireDataDir() {
  if (!existsSync(join(PGDATA, 'PG_VERSION'))) {
    fail(
      `PGDATA tidak valid: ${PGDATA}\n` +
        '  Inisialisasi HANYA dari Termux (bukan proot):\n' +
        `    initdb -D "${PGDATA}" -U postgres --auth=trust --no-locale -E UTF8\n` +
        '  Jangan memakai /usr/lib/postgresql/*/bin di dalam proot — menyebabkan hang ptrace.'
    );
  }
}

const actions = {
  status() {
    const st = pgCtl(['-D', PGDATA, 'status'], { capture: true });
    const ready = pgIsReady({ capture: true });
    const running = st.code === 0;
    log(`PGDATA: ${PGDATA}`);
    log(`biner : ${PG_CTL}`);
    log(`proot : ${insideProot() ? 'ya (dijalankan sebagai UID Android asli)' : 'tidak'}`);
    log(`server: ${running ? 'BERJALAN' : 'BERHENTI'}`);
    log(`port  : 127.0.0.1:${PORT} — ${ready.code === 0 ? 'menerima koneksi' : 'tidak merespons'}`);
    if (running) console.log(st.out.trim());
    process.exit(running && ready.code === 0 ? 0 : 1);
  },

  start() {
    requireDataDir();
    const st = pgCtl(['-D', PGDATA, 'status'], { capture: true });
    if (st.code === 0) {
      log('server sudah berjalan.');
      actions.status();
      return;
    }
    cleanupStale();
    log(`menjalankan PostgreSQL (PGDATA=${PGDATA})…`);
    const res = pgCtl(['-D', PGDATA, '-l', PGLOG, '-w', '-t', '60', 'start']);
    if (res.code !== 0) {
      fail(`gagal start (exit ${res.code}). Lihat log: ${PGLOG}`);
    }
    const ready = pgIsReady({ capture: true });
    if (ready.code !== 0) {
      fail(`server start tetapi tidak merespons di 127.0.0.1:${PORT}. Lihat log: ${PGLOG}`);
    }
    log(`siap — 127.0.0.1:${PORT} menerima koneksi.`);
  },

  stop() {
    const st = pgCtl(['-D', PGDATA, 'status'], { capture: true });
    if (st.code !== 0) {
      log('server tidak berjalan; bersihkan sisa lock bila ada.');
      cleanupStale();
      return;
    }
    log('menghentikan PostgreSQL (mode fast)…');
    const res = pgCtl(['-D', PGDATA, '-m', 'fast', '-w', '-t', '60', 'stop']);
    if (res.code !== 0) fail(`gagal stop (exit ${res.code}). Lihat log: ${PGLOG}`);
    cleanupStale();
    log('berhenti.');
  },

  restart() {
    actions.stop();
    actions.start();
  },
};

const action = process.argv[2];
if (!actions[action]) {
  console.error('Pemakaian: node scripts/pg-local.mjs <status|start|stop|restart>');
  process.exit(2);
}
actions[action]();
