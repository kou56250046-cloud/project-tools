// 合言葉の画面: 開く（locked）・決める（empty / legacy）

import { h, clear, toast, confirmDialog } from './dom.js';
import { store } from './store.js';

export const MIN_PASSPHRASE = 8;

// 新しい合言葉を2回入れてもらう。やめたら null
export function askNewPassphrase(reason) {
  return new Promise((resolve) => {
    const p1 = h('input', { type: 'password', id: 'pass-new-1', autocomplete: 'new-password', 'aria-label': '合言葉' });
    const p2 = h('input', { type: 'password', id: 'pass-new-2', autocomplete: 'new-password', 'aria-label': '合言葉（確認）' });
    const err = h('p', { class: 'notice error', role: 'alert', hidden: true });
    const dlg = h('dialog', { class: 'dialog', 'aria-labelledby': 'pass-title' },
      h('form', { method: 'dialog', class: 'stack', onsubmit: (e) => { e.preventDefault(); submit(); } },
        h('h2', { id: 'pass-title', text: '合言葉を決める' }),
        reason ? h('p', { class: 'small', text: reason }) : null,
        h('p', { class: 'small', text: `台帳はこの合言葉で暗号化してブラウザに保存します。${MIN_PASSPHRASE}文字以上にしてください。` }),
        h('p', { class: 'small notice warn', text: '合言葉を忘れると、ブラウザ内の台帳は開けません（書き出したファイルからは戻せます）。合言葉はこのツールの外には保存されません。' }),
        h('label', { class: 'field' }, '合言葉', p1),
        h('label', { class: 'field' }, 'もう一度', p2),
        err,
        h('div', { class: 'row dialog-actions' },
          h('button', { class: 'btn', type: 'button', 'data-act': 'cancel', onclick: () => done(null) }, 'やめる'),
          h('button', { class: 'btn primary', type: 'submit', 'data-act': 'ok' }, '決める'))));
    function fail(msg) { err.textContent = msg; err.hidden = false; }
    function submit() {
      if (p1.value.length < MIN_PASSPHRASE) return fail(`${MIN_PASSPHRASE}文字以上にしてください`);
      if (p1.value !== p2.value) return fail('2回の入力が一致しません');
      done(p1.value);
    }
    function done(v) { dlg.close(); dlg.remove(); resolve(v); }
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
    document.body.appendChild(dlg);
    dlg.showModal();
    p1.focus();
  });
}

// 台帳を置き換える前に呼ぶ。合言葉が未設定なら決めてもらう。決められなければ false
export async function ensureVaultReady() {
  if (!store.needsPassphraseSetup()) return true;
  const pass = await askNewPassphrase();
  if (!pass) return false;
  await store.setPassphrase(pass);
  return true;
}

// ロック画面の「使い方を見る」（ロック中でも使い方だけは開ける）
function guideLink(app) {
  return app ? h('p', { class: 'small' }, '初めて使うときは ', h('button', { class: 'btn small', type: 'button', id: 'lock-guide', onclick: () => app.go('guide') }, '使い方を見る'), ' で全体の流れを確かめられます。') : null;
}

export function renderLock(root, app) {
  clear(root);
  if (store.vaultState === 'legacy') {
    root.appendChild(h('section', { class: 'card stack lock' },
      h('h2', { text: '台帳を暗号化して保存します' }),
      guideLink(app),
      h('p', { text: 'これまでの台帳はブラウザに暗号化せずに保存されていました。同じブラウザで開いた別の HTML から読まれるおそれがあるため、合言葉を決めて暗号化してください。決めると、暗号化していない保存は消えます。' }),
      h('div', { class: 'row' }, h('button', {
        class: 'btn primary', type: 'button', id: 'legacy-migrate',
        onclick: async () => {
          const pass = await askNewPassphrase();
          if (!pass) return;
          await store.setPassphrase(pass);
          toast('暗号化して保存しました');
        },
      }, '合言葉を決める'))));
    return;
  }
  const input = h('input', { type: 'password', id: 'unlock-pass', autocomplete: 'current-password', 'aria-label': '合言葉' });
  const err = h('p', { class: 'notice error', role: 'alert', hidden: true, id: 'unlock-error' });
  const btn = h('button', { class: 'btn primary', type: 'submit', id: 'unlock-btn' }, '開く');
  root.appendChild(h('section', { class: 'card stack lock' },
    h('h2', { text: '合言葉を入れて台帳を開く' }),
    guideLink(app),
    h('p', { class: 'muted small', text: '台帳はこのブラウザの中に暗号化して保存されています。' }),
    h('form', {
      class: 'row', onsubmit: async (e) => {
        e.preventDefault();
        btn.disabled = true;
        btn.textContent = '確認中…';
        const r = await store.unlock(input.value);
        if (!r.ok) {
          err.textContent = r.error; err.hidden = false;
          btn.disabled = false; btn.textContent = '開く';
          input.select();
        }
      },
    }, input, btn),
    err,
    h('details', { class: 'small' },
      h('summary', { text: '合言葉を忘れたとき' }),
      h('p', { text: '合言葉は復元できません。書き出したファイルがあれば、ブラウザ内の台帳を消してから、ファイルを読み込み直してください。' }),
      h('button', {
        class: 'btn danger', type: 'button', id: 'vault-reset',
        onclick: async () => {
          if (await confirmDialog('ブラウザ内の暗号化された台帳を消します。元に戻せません。', '消す', '書き出したファイルがあるか、先に確かめてください。')) {
            store.resetVault();
            toast('ブラウザ内の台帳を消しました');
          }
        },
      }, 'ブラウザ内の台帳を消す'))));
  setTimeout(() => input.focus(), 0);
}
