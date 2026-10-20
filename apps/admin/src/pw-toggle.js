/**
 * pw-toggle.js — tombol tampil/sembunyi sandi untuk semua `input[type="password"]`.
 *
 * Sumber kanonik di `shared/` lalu disalin ke tiap panel oleh
 * `scripts/sync-shared.mjs`. Dipakai sebagai side-effect import di `app.js`
 * ketiga panel (Admin, Owner, Kasir):
 *
 *   import './pw-toggle.js';
 *
 * Cakupan: seluruh input sandi yang ada di DOM saat modul dimuat (layar login,
 * modal ganti sandi, PIN kasir, reset sandi, dsb.) serta input sandi yang
 * muncul kemudian lewat pengamat DOM. Tidak ada perubahan markup HTML —
 * tombol dan pembungkus `.pw-wrap` dibentuk di runtime.
 *
 * Aksesibilitas: tombol memakai `type="button"`, `aria-label`
 * ("Tampilkan/Sembunyikan sandi"), `aria-pressed`, dan `aria-controls`
 * (menuju id input bila ada). Status tersimpan sebagai kelas
 * `.pw-toggle--on` agar gaya CSS bisa menggambar ikon coretan.
 */
const LABEL_SHOW = 'Tampilkan sandi';
const LABEL_HIDE = 'Sembunyikan sandi';

const EYE_SVG = [
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"',
  ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">',
  '<path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12Z"/>',
  '<circle cx="12" cy="12" r="3"/>',
  '<path class="pw-slash" d="M4 4l16 16"/>',
  '</svg>',
].join('');

/** Pasang pembungkus + tombol pada satu input sandi (idempoten). */
const decorate = (input) => {
  if (!(input instanceof HTMLInputElement)) return;
  if (input.type !== 'password') return;
  if (input.dataset.pwToggle === 'on') return;

  const parent = input.parentElement;
  if (!parent) return;

  const wrap = document.createElement('span');
  wrap.className = 'pw-wrap';
  parent.insertBefore(wrap, input);
  wrap.appendChild(input);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pw-toggle';
  btn.innerHTML = EYE_SVG;
  btn.setAttribute('aria-pressed', 'false');
  btn.setAttribute('aria-label', LABEL_SHOW);
  if (input.id) btn.setAttribute('aria-controls', input.id);
  wrap.appendChild(btn);

  input.dataset.pwToggle = 'on';
};

/** Satu penangan klik terdelegasi untuk semua tombol (termasuk yang dinamis). */
const onClick = (event) => {
  const btn = event.target?.closest?.('.pw-toggle');
  if (!btn) return;
  const input = btn.closest('.pw-wrap')?.querySelector('input');
  if (!input || input.type === 'checkbox' || input.type === 'radio') return;

  const willShow = input.type === 'password';
  input.type = willShow ? 'text' : 'password';
  btn.classList.toggle('pw-toggle--on', willShow);
  btn.setAttribute('aria-pressed', String(willShow));
  btn.setAttribute('aria-label', willShow ? LABEL_HIDE : LABEL_SHOW);
};

const init = () => {
  for (const input of document.querySelectorAll('input[type="password"]')) {
    decorate(input);
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}

document.addEventListener('click', onClick);

// Input sandi yang dibuat kemudian (render ulang panel) ikut terhias tanpa
// memicu loop: `decorate` menandai input lewat `data-pw-toggle="on"`.
new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (node.matches?.('input[type="password"]')) decorate(node);
      node.querySelectorAll?.('input[type="password"]').forEach(decorate);
    }
  }
}).observe(document.documentElement, { childList: true, subtree: true });
