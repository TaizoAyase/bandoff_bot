/**
 * クライアント側エントリポイント。`document.body.dataset.page` の値で
 * ページごとの初期化処理に分岐する。ページ種別を問わない配線
 * (確認ダイアログ・貼付文面のコピー)は分岐の外で無条件に呼ぶ。
 */

import { startPolling } from "./polling";
import { initWelcomePage, tryRebind } from "./session";
import {
  initConfirmDialogs,
  initCopyPasteText,
  initSettingsPage,
  initSongForm,
} from "./ui";

initConfirmDialogs();
initCopyPasteText();

const page = document.body.dataset.page;

switch (page) {
  case "welcome":
    initWelcomePage();
    break;
  case "song-list": {
    const root = document.querySelector("main");
    const slug = root instanceof HTMLElement ? root.dataset.slug : undefined;
    if (slug) {
      void tryRebind();
      startPolling(slug);
    }
    break;
  }
  case "song-form":
    initSongForm();
    break;
  case "settings":
    initSettingsPage();
    break;
  default:
    break;
}
