/**
 * クライアント側エントリポイント。`document.body.dataset.page` の値で
 * ページごとの初期化処理に分岐する。ページ種別を問わない配線
 * (確認ダイアログ・コピーボタン・合言葉の表示切替)は分岐の外で無条件に呼ぶ。
 */

import { startPolling } from "./polling";
import {
  initOrganizerLoginDone,
  initWelcomePage,
  initWithdrawnPage,
  tryRebind,
} from "./session";
import {
  initConfirmDialogs,
  initCopyButtons,
  initOrganizerPage,
  initSettingsPage,
  initSongForm,
  initVisibilityToggles,
} from "./ui";

initConfirmDialogs();
initCopyButtons();
initVisibilityToggles();

const page = document.body.dataset.page;

switch (page) {
  case "welcome":
    initWelcomePage();
    break;
  case "organizer-login-done":
    initOrganizerLoginDone();
    break;
  case "organizer":
    initOrganizerPage();
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
  case "withdrawn":
    initWithdrawnPage();
    break;
  default:
    break;
}
