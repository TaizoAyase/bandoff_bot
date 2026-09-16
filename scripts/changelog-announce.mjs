// CHANGELOG.md の先頭バージョン(直近リリース)の「変更」の節だけを、
// Discord の通知チャンネルに1通投稿する。
//
// 依存パッケージを追加せず Node 組み込みの `fetch` だけを使う。
// **実行はユーザー自身が行うこと。エージェントはこのスクリプトを実行しない**。
//
// 使い方:
//   .dev.vars.announce (gitignore 済み) に以下を書いてから
//     DISCORD_BOT_TOKEN=...
//     DISCORD_CHANNEL_ID=...
//   `pnpm changelog:announce` を実行する。**デプロイが成功したあとに実行
//   すること**(告知だけ先に流れてデプロイが失敗する事故を防ぐため)。
//
//   `pnpm changelog:announce:dry` は環境変数を一切読まず、ネットワークにも
//   触れない。組み立てた本文と文字数を表示するだけなので、投稿前の確認に
//   安全に使える。
//
// `changelog:announce` は `--env-file=.dev.vars.announce` を使う
// (`--env-file-if-exists` ではない)。ファイルが無ければ Node がその場で
// 失敗して止まる。もし `--env-file-if-exists` にしてしまうと、ファイルを
// 書き忘れたままシェルに `DISCORD_BOT_TOKEN` / `DISCORD_CHANNEL_ID` が
// export されている場合に、それらの値で黙って投稿してしまう
// (Node は `--env-file` の値よりシェルの環境変数を優先するため)。
//
// Token・Discord からの応答本文はログに出さない。失敗時は HTTP ステータスと
// Discord のエラー `code`/`message` だけを出す。
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Discord の `content` フィールドの上限(公式ドキュメント上の制約)。 */
const DISCORD_CONTENT_MAX_LENGTH = 2000;

/** チャンネル ID(snowflake)は10進数の数字列のみ。src/notify/discord.ts と同じ。 */
const SNOWFLAKE_RE = /^\d{1,20}$/;

/**
 * CHANGELOG.md のバージョン見出し。例: `## v0.4.0 — 曲の譜面URL (2026-09-17)`
 * 末尾の日付は `YYYY-MM-DD` 形式に固定する。`.+` のような緩い指定だと、
 * タイトルに丸括弧を含めたときにタイトルの一部が日付側に取られてしまう。
 */
const HEADING_RE = /^##\s+(v\S+)\s+—\s+(.+?)\s+\(\d{4}-\d{2}-\d{2}\)\s*$/;

function readRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`環境変数 ${name} が設定されていません`);
    process.exit(1);
  }
  return value;
}

function requireSnowflake(name, value) {
  if (!SNOWFLAKE_RE.test(value)) {
    console.error(`環境変数 ${name} が snowflake 形式ではありません`);
    process.exit(1);
  }
  return value;
}

/**
 * CHANGELOG.md の全文から、先頭の `## ` セクション(次の `## ` の手前まで)を
 * 取り出す。`startLineNumber` は `lines[0]`(見出し行そのもの)の
 * CHANGELOG.md 内での1始まりの行番号で、エラーメッセージで使う。
 */
function extractTopSection(changelogText) {
  const allLines = changelogText.split("\n");
  const startIndex = allLines.findIndex((line) => line.startsWith("## "));
  if (startIndex === -1) {
    console.error("CHANGELOG.md に `## ` 見出しが見つかりません");
    process.exit(1);
  }
  let endIndex = allLines.length;
  for (let i = startIndex + 1; i < allLines.length; i++) {
    if (allLines[i].startsWith("## ")) {
      endIndex = i;
      break;
    }
  }
  return {
    lines: allLines.slice(startIndex, endIndex),
    startLineNumber: startIndex + 1,
  };
}

/** セクション先頭行の見出しから `version`(`vX.Y.Z`)と `title` を取り出す。 */
function parseHeading(headingLine) {
  const match = headingLine.match(HEADING_RE);
  if (!match) {
    console.error("CHANGELOG.md の先頭見出しの形式が不正です", {
      heading: headingLine,
    });
    process.exit(1);
  }
  return { version: match[1], title: match[2] };
}

/**
 * セクション内の `### 変更` の小節だけを取り出し、箇条書きの配列にする。
 * Markdown の折り返し(88列でのソフト改行、2スペースインデント)で
 * 複数行にまたがった項目は1項目として連結する。
 *
 * 判定は厳密にする(`rawLine` のインデントの有無を見る):
 * - 空行 → 読み飛ばす
 * - インデント無し + `- ` で始まる → 新しい項目
 * - インデント有り + trim 後が箇条書き・コードフェンス・見出し(それぞれ
 *   `- `・3連バッククォート・`#`)のいずれでも始まらない →
 *   直前の項目への継続行(スペースを挟まず連結)
 * - それ以外の非空行(インデント無しで `- ` 以外、インデント有りで
 *   ネストした箇条書き・コードブロック・見出し)はすべてエラーで終了する。
 *   コードブロックや補足行が無言で本文に混ざって投稿されるのを防ぐため。
 *
 * `### 変更` が同じバージョン節に2つ以上あるのもエラーにする
 * (merge conflict の解消ミス等で起こりうる)。`findIndex` で最初の
 * 1つだけを見て2つ目以降を無視すると、2つ目の `### 変更` 自身が
 * 「次の `### `」として終端に使われてしまい、2つ目以降の項目が
 * 警告もエラーも無しに本文から欠落する。
 */
function extractChangeBullets(sectionLines, sectionStartLine) {
  const headingLineNumbers = [];
  for (let i = 0; i < sectionLines.length; i++) {
    if (sectionLines[i].trim() === "### 変更") {
      headingLineNumbers.push(sectionStartLine + i);
    }
  }
  if (headingLineNumbers.length === 0) {
    console.error("先頭のバージョンに `### 変更` の節が見つかりません");
    process.exit(1);
  }
  if (headingLineNumbers.length > 1) {
    console.error(
      `CHANGELOG.md の \`### 変更\` の節が複数あります` +
        `(${headingLineNumbers.join("行目、")}行目)。重複を解消してください`,
      { lines: headingLineNumbers },
    );
    process.exit(1);
  }
  const headingIndex = headingLineNumbers[0] - sectionStartLine;
  let endIndex = sectionLines.length;
  for (let i = headingIndex + 1; i < sectionLines.length; i++) {
    if (sectionLines[i].startsWith("### ")) {
      endIndex = i;
      break;
    }
  }

  const bullets = [];
  for (let i = headingIndex + 1; i < endIndex; i++) {
    const rawLine = sectionLines[i];
    const lineNumber = sectionStartLine + i;
    const trimmed = rawLine.trim();
    if (trimmed === "") continue;

    const indented = rawLine !== rawLine.trimStart();

    if (!indented && trimmed.startsWith("- ")) {
      bullets.push(trimmed.slice(2).trim());
      continue;
    }

    const looksLikeStructure =
      trimmed.startsWith("- ") || trimmed.startsWith("```") || trimmed.startsWith("#");
    if (indented && !looksLikeStructure) {
      if (bullets.length === 0) {
        console.error(
          `CHANGELOG.md ${lineNumber}行目: 直前に項目が無いのに継続行があります`,
          { line: rawLine },
        );
        process.exit(1);
      }
      // 日本語の文章なので、折り返しの継続行はスペースを挟まず直接つなげる。
      bullets[bullets.length - 1] = `${bullets[bullets.length - 1]}${trimmed}`;
      continue;
    }

    console.error(
      `CHANGELOG.md ${lineNumber}行目: \`### 変更\` は「- 」で始まる箇条書きと` +
        "その折り返しの継続行だけを許します",
      { line: rawLine },
    );
    process.exit(1);
  }
  if (bullets.length === 0) {
    console.error("`### 変更` の節が空です");
    process.exit(1);
  }
  return bullets;
}

/** 投稿本文と、その元になったバージョン(`vX.Y.Z`)を組み立てる。 */
function buildAnnouncement(changelogPath) {
  const changelogText = readFileSync(changelogPath, "utf8");
  const { lines: sectionLines, startLineNumber } = extractTopSection(changelogText);
  const firstLine = sectionLines[0];
  if (firstLine === undefined) {
    console.error("CHANGELOG.md の先頭セクションが空です");
    process.exit(1);
  }
  const { version, title } = parseHeading(firstLine);
  const bullets = extractChangeBullets(sectionLines, startLineNumber);
  const body = [
    `**bandoff ${version} — ${title}**`,
    ...bullets.map((bullet) => `- ${bullet}`),
  ].join("\n");
  return { version, body };
}

/**
 * CHANGELOG.md の先頭バージョンと package.json の `version` が一致するか
 * 確かめる。片方だけ更新した事故を捕まえるための検査で、一致しなければ
 * 投稿せず終了する。
 */
function verifyVersionMatchesPackageJson(changelogVersion, packageJsonPath) {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const expected = `v${packageJson.version}`;
  if (changelogVersion !== expected) {
    console.error(
      "CHANGELOG.md の先頭バージョンと package.json の version が一致しません",
      { changelog: changelogVersion, packageJson: packageJson.version },
    );
    process.exit(1);
  }
}

/**
 * 本文が Discord の上限を超えていないか確かめる。切り詰めはしない
 * (書きすぎが原因なので、告知が黙って途中で切れるより落とすべき)。
 */
function verifyWithinDiscordLimit(body) {
  if (body.length > DISCORD_CONTENT_MAX_LENGTH) {
    console.error(
      `本文が Discord の上限(${DISCORD_CONTENT_MAX_LENGTH}文字)を超えています`,
      { length: body.length },
    );
    process.exit(1);
  }
}

async function postToDiscord(channelId, botToken, content) {
  const url = `https://discord.com/api/v10/channels/${channelId}/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bot ${botToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      content,
      allowed_mentions: { parse: [] },
    }),
  });

  if (!response.ok) {
    // 応答本文全体はログに出さない。Discord のエラー code/message だけを
    // 添える(取得できなければ何も添えない)。
    let code;
    let message;
    try {
      const errorBody = await response.json();
      if (errorBody && typeof errorBody === "object") {
        code = errorBody.code;
        message = errorBody.message;
      }
    } catch {
      // 応答が JSON でなければ黙って無視する。
    }
    console.error("投稿に失敗しました", { status: response.status, code, message });
    process.exit(1);
  }
}

async function main() {
  const dirname = path.dirname(fileURLToPath(import.meta.url));
  const changelogPath = path.join(dirname, "..", "CHANGELOG.md");
  const packageJsonPath = path.join(dirname, "..", "package.json");

  const { version, body } = buildAnnouncement(changelogPath);
  verifyVersionMatchesPackageJson(version, packageJsonPath);
  verifyWithinDiscordLimit(body);

  if (process.argv.includes("--dry-run")) {
    console.log(body);
    console.log(`(${body.length}文字)`);
    return;
  }

  const channelId = requireSnowflake(
    "DISCORD_CHANNEL_ID",
    readRequiredEnv("DISCORD_CHANNEL_ID"),
  );
  const botToken = readRequiredEnv("DISCORD_BOT_TOKEN");

  await postToDiscord(channelId, botToken, body);
  console.log("投稿しました");
}

main().catch((err) => {
  console.error("投稿に失敗しました", {
    error: err instanceof Error ? err.name : typeof err,
  });
  process.exit(1);
});
