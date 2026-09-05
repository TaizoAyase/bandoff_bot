/**
 * JS 専用の小さな補助 UI。曲登録フォームのパート構成(枠)の増減、
 * 「Discordに貼る文面」のコピー、破壊的な操作の確認ダイアログ(data-confirm)、
 * 設定画面での復帰キー再表示・端末紐付け解除を担当する。
 * いずれも JS が動かない環境ではフォームの通常送信のみで動作は成立する
 * (確認ダイアログが出ないだけ)。
 */

import { clearRecoveryKey, clearToken, loadRecoveryKey } from "./storage";

// src/domain/validation.ts の LIMITS.MAX_SLOTS_PER_TAKE と合わせる。
// クライアントバンドルは Worker 側のコードと別の tsconfig でビルドするため
// 値を重複させている。
const MAX_SLOTS_PER_TAKE = 20;

function cloneSlotRowTemplate(): HTMLElement | null {
  const template = document.getElementById("slot-row-template");
  if (!(template instanceof HTMLTemplateElement)) {
    return null;
  }
  const fragment = template.content.cloneNode(true);
  if (!(fragment instanceof DocumentFragment)) {
    return null;
  }
  const row = fragment.firstElementChild;
  return row instanceof HTMLElement ? row : null;
}

export function initSongForm(): void {
  const rows = document.getElementById("slot-rows");
  const addButton = document.getElementById("add-slot-button");
  if (!rows || !addButton) {
    return;
  }

  addButton.addEventListener("click", () => {
    if (rows.children.length >= MAX_SLOTS_PER_TAKE) {
      return;
    }
    const row = cloneSlotRowTemplate();
    if (row) {
      rows.appendChild(row);
    }
  });

  rows.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (target.dataset.action !== "remove-slot") {
      return;
    }
    if (rows.children.length <= 1) {
      return;
    }
    target.closest("[data-slot-row]")?.remove();
  });
}

/**
 * 「Discordに貼る文面」のコピーボタン(`data-action="copy-paste-text"` +
 * `#paste-text`)。welcome ページと主催者画面の両方で使うため、ページ種別を
 * 問わず呼び出せるようにしている(該当要素が無いページでは何もしない)。
 */
export function initCopyPasteText(): void {
  const copyButton = document.querySelector('[data-action="copy-paste-text"]');
  const pasteText = document.getElementById("paste-text");
  if (
    copyButton instanceof HTMLButtonElement &&
    pasteText instanceof HTMLTextAreaElement
  ) {
    copyButton.addEventListener("click", () => {
      navigator.clipboard?.writeText(pasteText.value).catch(() => {
        // クリップボード API が使えない場合は何もしない(テキストは選択して手動コピー可能)。
      });
    });
  }
}

/**
 * `data-confirm="..."` を持つ `<form>` の submit を委譲で拾い、
 * `confirm()` でキャンセルされたら送信を止める。主催者による埋まった枠の
 * 強制削除・代理辞退など、他人に影響する操作の確認に使う(仕様 134行目)。
 * ページ種別を問わず呼び出せる(該当フォームが無ければ何も起きない)。
 */
export function initConfirmDialogs(): void {
  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) {
      return;
    }
    const message = form.dataset.confirm;
    if (!message) {
      return;
    }
    if (!window.confirm(message)) {
      event.preventDefault();
    }
  });
}

/**
 * 設定画面: `#recovery-key-display` に localStorage の復帰キーを差し込む
 * (サーバーは平文の復帰キーを持たないため出せない)。
 * 「この端末の紐付けを解除する」フォームの送信時には、通常の POST 送信に
 * 加えて localStorage の端末トークン・復帰キーも消す。
 */
export function initSettingsPage(): void {
  const root = document.querySelector("main");
  const slug = root instanceof HTMLElement ? root.dataset.slug : undefined;
  if (!slug) {
    return;
  }

  const display = document.getElementById("recovery-key-display");
  if (display instanceof HTMLElement) {
    const key = loadRecoveryKey(slug);
    display.textContent = key ?? "この端末には保存されていません。";
  }

  const unbindForm = document.querySelector('[data-action="unbind-device"]');
  if (unbindForm instanceof HTMLFormElement) {
    unbindForm.addEventListener("submit", () => {
      clearToken(slug);
      clearRecoveryKey(slug);
    });
  }
}
