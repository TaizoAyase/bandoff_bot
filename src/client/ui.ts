/**
 * 曲登録フォームのパート構成(枠)を増減させる、JS 専用の補助 UI。
 * JS が動かない環境でも `#slot-rows` に最初から入っている行(初期値
 * Gt/Gt/Ba/Dr/Vo)だけで通常どおり送信できる。
 */

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
