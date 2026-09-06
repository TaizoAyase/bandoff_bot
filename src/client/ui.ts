/**
 * JS 専用の小さな補助 UI。曲登録フォームのパート構成(枠)の増減、
 * 汎用コピーボタン、合言葉入力欄の表示切替、破壊的な操作の確認ダイアログ
 * (data-confirm)、設定画面での引き継ぎコード再表示・端末紐付け解除を担当する。
 * いずれも JS が動かない環境ではフォームの通常送信のみで動作は成立する
 * (確認ダイアログが出ない・コピーボタンが使えないだけ)。
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

const COPY_FEEDBACK_DURATION_MS = 2000;

/**
 * コピー成功/失敗をボタンの文言で2秒間フィードバックする。元の文言は
 * `dataset.originalLabel` に退避しておき、タイムアウト後に戻す。
 */
function showCopyFeedback(button: HTMLButtonElement, message: string): void {
  if (button.dataset.originalLabel === undefined) {
    button.dataset.originalLabel = button.textContent ?? "";
  }
  const original = button.dataset.originalLabel;
  button.textContent = message;
  window.setTimeout(() => {
    button.textContent = original;
  }, COPY_FEEDBACK_DURATION_MS);
}

/**
 * `[data-copy-target="<id>"]` を持つボタンの汎用コピー機能。
 * document への click 委譲で拾い、対象要素(`#<id>`)が `textarea`/`input`
 * なら `.value`、それ以外なら `textContent` をクリップボードにコピーする。
 * 成功したら2秒間「コピーしました」、失敗したら「コピーできませんでした」を
 * 表示する。`navigator.clipboard` が使えない環境では該当ボタンをすべて
 * 無効化する(コピー元のテキストは選択して手動コピーできる)。
 * welcome・設定・主催者画面など複数ページで使うため、ページ種別を問わず
 * 呼び出せる(該当ボタンが無ければ何も起きない)。
 */
export function initCopyButtons(): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>("[data-copy-target]");
  if (!navigator.clipboard) {
    for (const button of buttons) {
      button.disabled = true;
    }
    return;
  }

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const button = target.closest("[data-copy-target]");
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }
    const targetId = button.dataset.copyTarget;
    const source = targetId ? document.getElementById(targetId) : null;
    if (!source) {
      return;
    }
    const text =
      source instanceof HTMLTextAreaElement || source instanceof HTMLInputElement
        ? source.value
        : (source.textContent ?? "");

    navigator.clipboard
      .writeText(text)
      .then(() => showCopyFeedback(button, "コピーしました"))
      .catch(() => showCopyFeedback(button, "コピーできませんでした"));
  });
}

/**
 * `[data-toggle-visibility="<id>"]` のチェックボックスの change を委譲で拾い、
 * 対象 input(`#<id>`)の `type` をチェック中は `text`、外れたら `password` に
 * 切り替える。合言葉入力欄の「表示する」チェックに使う。ページ種別を問わず
 * 呼び出せる(該当チェックボックスが無ければ何も起きない)。
 */
export function initVisibilityToggles(): void {
  document.addEventListener("change", (event) => {
    const checkbox = event.target;
    if (!(checkbox instanceof HTMLInputElement) || checkbox.type !== "checkbox") {
      return;
    }
    const targetId = checkbox.dataset.toggleVisibility;
    if (!targetId) {
      return;
    }
    const field = document.getElementById(targetId);
    if (!(field instanceof HTMLInputElement)) {
      return;
    }
    field.type = checkbox.checked ? "text" : "password";
  });
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
 * 設定画面: `#recovery-key-display` に localStorage の引き継ぎコードを
 * 差し込む(サーバーは平文の引き継ぎコードを持たないため出せない)。
 * localStorage に無ければコピーボタンを無効化する。
 * 「この端末の紐付けを解除する」フォームの送信時には、通常の POST 送信に
 * 加えて localStorage の端末トークン・引き継ぎコードも消す。
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
    if (!key) {
      const copyButton = document.querySelector(
        '[data-copy-target="recovery-key-display"]',
      );
      if (copyButton instanceof HTMLButtonElement) {
        copyButton.disabled = true;
      }
    }
  }

  const unbindForm = document.querySelector('[data-action="unbind-device"]');
  if (unbindForm instanceof HTMLFormElement) {
    unbindForm.addEventListener("submit", () => {
      clearToken(slug);
      clearRecoveryKey(slug);
    });
  }
}
