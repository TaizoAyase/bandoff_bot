# bandoff

スタジオオフ会(複数人が楽器を持ち寄って集まる音楽イベント)向けの、曲・パート
管理 Web アプリ。合言葉で入るイベントスコープの URL の中で、参加者が曲を登録し、
Gt/Ba/Dr/Vo などの枠(Slot)に自由にエントリー・辞退できる。認証は持たず、推測不能
な URL・合言葉・端末トークンの3レイヤーでアクセスを制御する(詳細は
`docs/bandoff-spec.md` を参照)。Cloudflare Workers + D1 の上で動く TypeScript
(Hono + Hono JSX の SSR)アプリケーションで、フェーズ1(Web のみ)の範囲を実装
している。

## 必要なツール

- [mise](https://mise.jdx.dev/)(Node・pnpm のバージョン管理)
- Node.js 22(mise 経由で導入)
- pnpm 11(**corepack 経由で有効化する**。理由は下記)

### なぜ corepack で pnpm を有効化するか

`mise.toml` は `pnpm = "11"` を指定しているが、環境によっては mise がインストール
する pnpm のバイナリが `libatomic.so.1` を要求し、そのライブラリが無い Linux 環境
(一部の WSL2 / 軽量コンテナなど)では pnpm 自体が起動できないことがある。
Node 22 には corepack が同梱されているため、`corepack enable` で
`package.json` の `packageManager` フィールド(`pnpm@11.25.0`)に固定された pnpm
を使う方が確実。**このリポジトリでは mise の pnpm ではなく corepack の pnpm を使う
手順を基本とする。**

## セットアップと起動

```sh
# 1. Node 22 を導入する(pnpm は mise では入れない。tools に残っているのは
#    Node のバージョン固定のためで、pnpm 自体は次の corepack で有効化する)
mise install

# 2. corepack 経由で package.json の packageManager が指す pnpm を有効化する
corepack enable

# 3. 依存関係をインストール
pnpm install

# 4. cookie 署名鍵などを .dev.vars に用意する
cp .dev.vars.example .dev.vars
# .dev.vars の SESSION_SECRET に openssl rand -base64 32 の出力を設定する

# 5. ローカル D1 にマイグレーションを適用する
pnpm db:migrate:local

# 6. 開発サーバーを起動する(esbuild でクライアント JS をビルドしてから
#    wrangler dev を起動する)
pnpm dev
```

`http://localhost:8787` で起動する。`/` から「イベントを作る」→ 作成直後の
welcome ページの URL・合言葉を控えれば、そのまま動線を一通り確認できる。

## `pnpm check`

lint(Biome)・型チェック(tsc --noEmit、Worker 用・クライアント用・テスト用の
3つの tsconfig)・テスト(vitest + `@cloudflare/vitest-pool-workers`、ローカル D1
相当の miniflare 上で実行)をこの順で実行する。実装の完了条件として使う。
同一テストファイル内では D1 が共有される(ファイル単位でのみ分離される)ため、
テスト内で DB を検索・集計するときは必ず eventId 等でスコープする。

```sh
pnpm check      # lint + typecheck + test をまとめて実行
pnpm lint       # Biome のみ
pnpm format     # Biome の自動整形(書き込みあり)
pnpm typecheck  # 3つの tsconfig の tsc --noEmit
pnpm test       # vitest run
```

その他、開発中に使うスクリプト:

- `pnpm dev:client` — クライアント JS(`src/client/`)を esbuild の watch モードで
  ビルドし続ける(`pnpm dev` と並行して使う場面向け)
- `pnpm db:generate` — スキーマ変更後に drizzle-kit でマイグレーションを生成
- `pnpm types` — `wrangler.toml` の変更後に `worker-configuration.d.ts`(型定義)
  を再生成

## ディレクトリ構成

```
src/
  index.ts        Hono アプリの組み立て、404 / エラーハンドラ
  env.ts           AppEnv(Bindings・Variables)の型定義
  middleware/       security-headers・csrf・event(slug→Event)・
                    session(cookie→viewer)・guards(認可ミドルウェア)
  routes/           ルート定義(*.ts)。JSX は書かず views/ を呼ぶだけにする
    root.ts          `/`、`/new`(イベント作成)
    event.ts          `/e/:slug` 配下のサブアプリの骨格
    auth.ts            合言葉(join)・端末トークン再結合(rebind)・復帰キー(recover)
    pages.ts           曲一覧とポーリング用 HTML 断片
    participants.ts    参加者登録・参加者一覧・参加者の削除(主催者)
    songs.ts           曲の登録・編集・削除、枠へのエントリー・辞退
    takes.ts           Take・Slot の追加・削除(枠構成そのものの増減)
    me.ts              自分のエントリー一覧・設定(プロフィール編集・端末解除・参加の取りやめ)
    organizer.ts       主催者ログイン・イベント編集・JSON エクスポート
    discord-interactions.ts  `POST /discord/interactions`(署名検証・3コマンド)
    discord-link.ts    `/e/:slug/discord` 配下(発行済みリンクの消費・紐付け・解除)
  discord/          Discord Interactions 固有の低レイヤ
    verify.ts           Ed25519 署名検証(WebCrypto)
    interaction.ts        interaction JSON の型ガード・取り出し(純関数)
  views/            Hono JSX。JSX が閉じ込められているのはここだけ
    layout.tsx        全ページ共通レイアウト(OGP なし、CSP 準拠)
    render.tsx         DOCTYPE 付与のヘルパ
    pages/              1ページ1コンポーネント(discord-open.tsx はリンク消費用の中継ページ)
    components/          複数ページで共有する部品(曲カード・枠一覧など)
  db/
    schema.ts          Drizzle ORM のテーブル定義
    client.ts            D1 バインディングから Drizzle クライアントを作る
    queries/              テーブルごとのクエリ関数(SQL はここに閉じる)
      discord-links.ts       discord_link の発行・消費・掃除
  domain/           DB にもリクエストにも触れない純粋関数
    permissions.ts       仕様 4章の権限表の実装
    validation.ts         各フォームの入力検証・上限値
    discord.ts             候補イベントの条件・表示名の初期値の正規化など
    discord-message.ts       候補名・list の本文・ボタンの組み立て
    crypto.ts / ids.ts / time.ts / instruments.ts / rate-limit.ts / hooks.ts など
  client/           ブラウザで動く最小限の TypeScript(esbuild でバンドル)
    main.ts             data-page で処理を分岐するエントリポイント
    polling.ts             曲一覧の自動更新(非アクティブタブで停止)
    session.ts / storage.ts  端末トークン・復帰キーの localStorage 操作
    ui.ts                  確認ダイアログ・コピー操作などの汎用 UI 配線
    discord.ts              `/e/:slug/discord` のフラグメント読み取り・トークン消費
migrations/         drizzle-kit generate の出力 + 既定 Workspace 投入用の手書き SQL
public/             静的アセット(robots.txt、CSS、esbuild が吐く js/ は gitignore)
scripts/            開発用スクリプト。build-client.mjs(クライアント JS ビルド)、
                    discord-commands.json・register-discord-commands.mjs
                    (スラッシュコマンド登録、`pnpm discord:register`)
test/
  domain/*.test.ts    純粋関数の単体テスト
  routes/*.test.ts     ルートの結合テスト(`app.request()` + cookie jar)
  discord/*.test.ts     署名検証・コマンド定義 JSON など Discord 固有の単体テスト
  helpers.ts            テスト用のイベント作成・ログイン・曲登録などのヘルパ
```

## 補足

- タイムゾーンは日本時間固定。DB には UTC エポック秒で保存する。
- 合言葉のみ平文保存(主催者画面で再表示するため)。主催者キー・端末トークン・
  引き継ぎコードはハッシュのみ保存する。
- CI はこのフェーズには含まれない(次の計画で扱う)。

### 名前の対応表

このプロジェクトは名前が4つ登場し混同しやすいため、対応を整理しておく。

| 何の名前か | 値 |
|---|---|
| GitHub リポジトリ | `bandoff_bot` |
| npm パッケージ名(`package.json` の `name`) | `bandoff` |
| Cloudflare の Worker 名 | `studio-parts` |
| D1 データベース名 | `studio-parts` |

Worker 名と D1 名だけ別にしてあるのは、公開 URL のホスト名からコミュニティや
アプリの用途を推測されないようにするため。イベントの秘匿性は URL の slug が
担保しており、ホスト名には依存していない。

## 変更するときに壊してはいけない設計

コードを触る前に知っておかないと、動くように見えて壊してしまう不変条件。

- **CSRF 検査は `Sec-Fetch-Site` 優先**(`src/middleware/csrf.ts`)。
  `Referrer-Policy: no-referrer` を返しているため、Fetch 仕様によりフォーム
  送信など CORS モードでない POST の `Origin` は `null` になる。`Origin` の
  一致だけで判定するとブラウザからの全フォーム送信が 403 になる(実際に
  起きた)。
- **OGP メタタグを出さない**(`src/views/layout.tsx`)。Discord に URL を貼ると
  プロキシがページを取得して埋め込みを生成し、イベント名や日時が露出するため。
- **イベント名・日時・場所は合言葉を通した後にしか出さない**。曲一覧の
  `EventInfo`(`src/views/components/event-info.tsx`)と `<title>` に
  イベント名が載るので、これを守っているのは `requireViewer` の 303
  リダイレクト1点のみ。ガードを緩めると URL を知っただけの相手に中身が
  渡る。`test/routes/event-info-leak.test.ts` が本文にイベント名が
  含まれないことを直接検証している。
- **1枠1人は条件付き INSERT と `UNIQUE(slot_id)` の二重で守る**
  (`src/db/queries/assignments.ts`)。片方だけにしない。
- **すべての書き込みルートで対象リソースの `event_id` を照合する**。他イベント
  の ID を POST して跨いだ操作ができないようにするため。
- **`SESSION_SECRET` を変更すると全員の cookie が無効になる**。詳細は
  デプロイ手順5を参照。
- **CSP により inline の `style` / `onclick` / `<script>` は使えない**。
  データは `data-*` 属性で渡し、イベントは document への委譲リスナで処理する
  (`src/client/ui.ts` の流儀)。
- **`<select>` の現在値が選択肢に無いときは、その値を選択肢に足す**
  (`src/domain/starts-time.ts` の `buildStartsTimeOptions`)。開始時刻は
  15分刻み96択だが、`datetime-local` を使っていた頃のイベントは 19:07 の
  ような値を持ちうる。一致する `<option>` が無いとブラウザは先頭の
  `00:00` を選択状態にするため、主催者が長さだけ直して更新すると開始
  時刻が**無警告で書き換わる**。旧値を選択肢に足しておけば、選び直す
  まで検証エラーになるだけで壊れない。同じ罠は今後 `<select>` を足す
  たびに再発しうる。
- **テストの D1 の分離単位はファイル単位**(`@cloudflare/vitest-pool-workers`
  の仕様、`isolatedStorage` は廃止済み)。詳細は上の `pnpm check` の節を参照。
- **参考URL・譜面URLの外部リンクには必ず `rel="noreferrer"` を付ける**
  (`src/views/components/song-card.tsx`)。曲一覧のページ URL は秘密の
  slug を含むため、付け忘れるとクリック時に Referer としてリンク先の
  外部サイトへ漏れる。

## デプロイ

Worker 名・D1 データベース名はどちらも `studio-parts` に揃えている(公開 URL は
`studio-parts.<アカウントのサブドメイン>.workers.dev`)。デプロイは手元からの
`wrangler deploy` のみで、GitHub Actions などの CI は用意していない。

### 1. Cloudflare アカウントを作る

<https://dash.cloudflare.com/sign-up> から作成する。無料プランはクレジット
カード登録不要。二要素認証の設定を推奨する。

### 2. workers.dev のサブドメインを決める

Cloudflare ダッシュボードの Workers & Pages から、アカウントにつき1つの
`workers.dev` サブドメインを決める。**一度決めると後から変更しにくい。**
公開 URL は `studio-parts.<このサブドメイン>.workers.dev` になる。

### 3. wrangler にログインする

```sh
pnpm exec wrangler login
```

ブラウザが開いて認可を求められる。WSL2 などでブラウザが自動で開かない場合は、
ターミナルに表示される URL を Windows 側のブラウザに貼り付ける。認可後の
コールバックは `localhost:8976` で待ち受ける。

### 4. D1 データベースを作成する

```sh
pnpm exec wrangler d1 create studio-parts --location apac
```

出力される `database_id` を `wrangler.toml` の
`database_id = "PLACEHOLDER_REPLACE_AFTER_D1_CREATE"` の行に書き写す。

**出力される `[[d1_databases]]` の設定ブロックをそのまま `wrangler.toml` に
上書きしないこと。** 書き写すのは `database_id` の値だけでよい。`binding =
"DB"` は変更しない。コードは `env.DB` を参照しているため、ここを書き換えると
デプロイ自体は成功するがデータベースにアクセスできなくなり、DB に触る全ルート
が実行時に失敗する。

### 5. 本番用の `SESSION_SECRET` を登録する

```sh
openssl rand -base64 32
pnpm exec wrangler secret put SESSION_SECRET
```

生成した値を `wrangler secret put` に貼り付けて登録する。**`.dev.vars` の
ローカル用の値とは別の値にすること。** 後から値を変更すると全員の cookie が
無効になり、参加者は合言葉の入力からやり直しになる。

### 6. 本番用の Discord Bot を登録する(任意)

イベントの作成・編集、曲の追加・編集、Take(2回目以降)・枠の追加、
参加者登録、エントリーの追加・辞退、参加の取りやめ(自分から)を
Discord の1チャンネルに通知したい場合のみ行う(詳細は
`docs/bandoff-spec.md` の7章「変更の通知」を参照)。`DISCORD_BOT_TOKEN` と
`DISCORD_CHANNEL_ID` の両方が揃うまで通知機能は完全に no-op になり、他の
動作には影響しない。

通知の送信そのものを Bot 経由にしているのは、手順7のスラッシュコマンドも
同じ Bot で賄えるようにするため。Webhook のままだと
「ウェブフック発行」と「Bot 導入」を別々に依頼することになり、対象サーバーの
管理者ではないユーザーが管理者へ依頼する回数が増えてしまう。

1. https://discord.com/developers/applications で「New Application」から
   アプリを作る。**この作業自体は対象 Discord サーバーの管理者でなくてもできる。**
2. 「Bot」タブで Token を発行してコピーする。**Token は発行直後しか
   表示されず、再表示できない。** その場でコピーしておくこと。
3. 「OAuth2」→「URL Generator」で招待用 URL を作る。SCOPES は `bot` と
   `applications.commands` の両方にチェックし、BOT PERMISSIONS は
   「View Channels」(チャンネルを見る)と「Send Messages」(メッセージを
   送信)(`permissions=3072`)を選ぶ。生成された URL を対象サーバーの
   **管理者に渡し、導入してもらう**(導入には「サーバーの管理」権限が必要)。
   スコープに `applications.commands` を含めておくのは、将来スラッシュ
   コマンドを足すときに管理者へ再度依頼しなくて済むようにするため。
4. Discord クライアントの設定で開発者モードを有効にし、通知したい
   チャンネルを右クリック →「チャンネル ID をコピー」で ID を取得する。
5. 登録する。

   ```sh
   pnpm exec wrangler secret put DISCORD_BOT_TOKEN
   pnpm exec wrangler secret put DISCORD_CHANNEL_ID
   ```

   それぞれのプロンプトに手順2・4で取得した値を貼り付ける。

**Bot Token は Bot として対象チャンネルに投稿できる資格情報。** ローカルで
試す場合の `.dev.vars` への記入も含め、Issue・チャット等で共有したり commit
したりしないこと。漏れた場合は Developer Portal の「Bot」タブから Token を
Regenerate する。

### 7. 本番用のスラッシュコマンドを有効にする(任意)

Discord から `/bandoff open`・`/bandoff list`・`/bandoff new` を使えるように
したい場合のみ行う(詳細は `docs/bandoff-spec.md` の2.3節を参照)。手順6の
通知用 Bot とは独立した設定で、`DISCORD_PUBLIC_KEY` と `DISCORD_GUILD_ID` の
両方が揃うまでコマンドは完全に無効(`POST /discord/interactions` は 404)の
ままで、他の動作には影響しない。招待スコープには手順6の時点で既に
`applications.commands` を含めているため、対象サーバーの管理者への再依頼は
不要。

1. https://discord.com/developers/applications の対象アプリの「General
   Information」タブで **Public Key**(16進64文字)を控える。サーバー
   (ギルド)ID は Discord クライアントの開発者モードを有効にし、対象
   サーバーを右クリック →「サーバー ID をコピー」で取得する。
2. 登録する。

   ```sh
   pnpm exec wrangler secret put DISCORD_PUBLIC_KEY
   pnpm exec wrangler secret put DISCORD_GUILD_ID
   ```

   それぞれのプロンプトに手順1で取得した値を貼り付ける。コマンドが使う
   `event.discord_enabled` 列・`discord_link` テーブルは、次の「D1 に
   マイグレーションを適用する」で通常のマイグレーションの一部として
   追加されるので、この機能専用のマイグレーション手順はない。
3. Interactions Endpoint の設定とコマンド自体の登録は、デプロイが済んで
   いないと Discord 側の検証が通らないため、手順9(デプロイする)の後の
   「Interactions Endpoint を設定し、コマンドを登録する」にまとめてある。

### 8. 本番 D1 にマイグレーションを適用する

手順4で `database_id` を書き写していないと(プレースホルダ
`PLACEHOLDER_REPLACE_AFTER_D1_CREATE` のままだと)、ここで失敗して止まる。

**2回目以降のデプロイでも、マイグレーションは必ずデプロイより先に当てる。**
逆にすると、新しいコードが本番にまだ存在しない列を読もうとして落ちる。
列の追加(`ALTER TABLE ... ADD COLUMN`、NULL 許容)であれば、先に当てても
旧コードはその列を知らないだけなので動き続ける。つまりこの順序なら
ダウンタイムは発生しない。

```sh
pnpm db:migrate:remote
```

### 9. デプロイする

```sh
pnpm deploy
```

lint・型チェック・テスト・クライアント JS のビルドを行ってから
`wrangler deploy` を実行する(`public/js/` は gitignore されているため、
ビルドを飛ばすとクライアント JS が欠けた状態で公開されてしまう)。この
`database_id` も手順4で書き写していないと失敗して止まる。なお `pnpm
deploy:dry`(手順1〜4より前でも試せるバンドル検証用コマンド)は API を
呼ばないため、`database_id` が不正な値のままでも成功してしまう点に注意する。

### 10. Interactions Endpoint を設定し、コマンドを登録する(手順7を行った場合のみ)

手順7で `DISCORD_PUBLIC_KEY` / `DISCORD_GUILD_ID` を登録した場合のみ行う。
デプロイ(手順9)が済んでいる必要がある。

1. Developer Portal の「General Information」タブの **Interactions
   Endpoint URL** に `https://<公開ホスト>/discord/interactions` を設定して
   保存する。保存時に Discord が PING と、わざと不正な署名を付けた
   リクエストを送って検証するため、デプロイより先に設定すると検証に
   失敗して保存できない。
2. コマンドをサーバーに登録する。`.dev.vars.register`(gitignore 済み)を
   作り、以下の3つを書いてから実行する。

   ```sh
   pnpm discord:register
   ```

   - `DISCORD_APPLICATION_ID` — Developer Portal の「General Information」
     タブにある Application ID
   - `DISCORD_GUILD_ID` — 手順7で取得した値と同じもの
   - `DISCORD_BOT_TOKEN` — 手順6で発行した値と同じもの

   これら3つは登録スクリプト(`scripts/register-discord-commands.mjs`)
   だけが読む値で、Worker の secret にはしない(`wrangler secret put` は
   不要)。ギルドコマンドは登録後すぐに反映される。コマンド定義
   (`scripts/discord-commands.json`)を変更した場合は再度実行すれば
   上書きされる。**このスクリプトの実行は手元の端末から行う。**

### 11. デプロイ後の確認

- `/` が 200 で返る
- `/robots.txt` が `Disallow: /` を返す
- `/js/main.js` が 200 で返る
- `/new` からイベントを作成し、発行された合言葉でそのイベントに入れる
- レスポンスに CSP・`X-Robots-Tag`・`Referrer-Policy` などのセキュリティ
  ヘッダが付与されている
- 手順7・10を行った場合: Discord サーバーで `/bandoff list`・`/bandoff open`・
  `/bandoff new` が候補として表示され、`/bandoff open` で発行されたリンクを
  開くと該当イベントの曲一覧に入れる

### 12. 運用メモ

- バックアップは月1回程度を目安に取る(仕様書 9.3)。上書きされないよう
  ファイル名に日付を入れる。

  ```sh
  pnpm exec wrangler d1 export studio-parts --remote \
    --output "backup-$(date +%Y%m%d).sql"
  ```

- バックアップからの復旧は、SQL ファイルを D1 に流し込む。

  ```sh
  pnpm exec wrangler d1 execute studio-parts --remote --file "backup-YYYYMMDD.sql"
  ```

  ただし `wrangler d1 export` が出力する SQL は `CREATE TABLE`(`IF NOT
  EXISTS` なし)と `d1_migrations` テーブルへの素の `INSERT` を含むため、
  既にマイグレーション済みの D1 に対して実行すると最初の数行
  (`d1_migrations` への重複 INSERT)で `UNIQUE constraint failed` となって
  止まる(ローカル D1 で確認済み)。**既存の本番 D1 に上書きで戻すことは
  想定されていない。** 事故復旧の際は、新しい D1(`wrangler d1 create`)を
  作り、そのまっさらな状態に流し込むほうが安全。**ただし新しい D1 を作った
  だけでは終わらない。** 上の「4. D1 データベースを作成する」と同じ手順で
  `wrangler.toml` の `database_id` を新しい D1 のものに書き換え、
  `pnpm deploy` で再デプロイするまで、稼働中の Worker は古い(壊れた)D1 を
  参照したままになる。
- 無料枠の目安: Workers は 10万リクエスト/日、D1 は 5GB・500万行読み取り/日・
  10万行書き込み/日。
- トラブル時にリアルタイムでログを見るには `pnpm exec wrangler tail` を使う
  (`[observability]` の設定変更は不要。Real-time Logs は Workers Logs
  の永続化設定とは独立した別機能で、`wrangler.toml` の変更なしにそのまま
  使える)。
- Workers Logs(過去ログの永続化・ダッシュボードでの検索)は現在
  **暫定的に有効化している**(`wrangler.toml` の `[observability]
  enabled = true`)。原因不明の 403 などをデプロイ後に遡って調査するための
  措置。**`wrangler.toml` の変更はデプロイして初めて反映される**ので、
  有効化直後のデプロイより前のリクエストは記録されていない。
  **調査が終わったら `enabled` を `false` に戻し、再デプロイすること。**
  有効な間は invocation log にリクエスト URL がそのまま残るため、秘密で
  ある `/e/{slug}/` の slug がダッシュボードに表示される(合言葉や主催者
  キーは POST body の値でありレスポンスの `Location` やリンクにも現れない
  ため、URL には載らない)。共有画面やスクリーンショットへの映り込みに
  注意する(`wrangler tail` の画面と同様)。
- CSRF ミドルウェア(`src/middleware/csrf.ts`)が 403 を返す直前には
  `console.warn("csrf: rejected", …)` で、拒否理由(`Sec-Fetch-Site` /
  `Origin` のどちらの分岐か)・拒否時のヘッダの状態・User-Agent を記録する
  (slug の実値や cookie、入力値、Origin の生文字列は記録しない)。
  ダッシュボードやログでこの文字列を検索すれば、どの分岐でどんなクライアント
  が弾かれたかが分かる。

### 13. リリースの流れ(バージョンを上げるとき)

変更履歴は v0.4.0 から `CHANGELOG.md` を唯一の出所にしている(v0.3.0 以前は
`git tag -n99 v0.3.0` のようにタグ本文を参照する)。バージョンを上げるときは
次の順で進める。

1. `release/vX.Y.Z` ブランチで、`package.json` の `version`・
   `src/notify/discord.ts` の User-Agent(`DiscordBot (bandoff, X.Y.Z)`)・
   `CHANGELOG.md` の3つを更新する。`CHANGELOG.md` は先頭に新しいバージョンの
   節(`### 変更`・`### デプロイ時の注意`・`### 既知の問題`)を追加する
   (遡っての記載はしない)。「変更」の節はバンドメンバーが Discord で読む
   文章なので、マイグレーション番号やファイル名を出さず、です・ます調で書く
2. main にマージし、`vX.Y.Z` のアノテーション付きタグを打つ。**タグ本文には
   1行の要約と `CHANGELOG.md` への参照だけを書く。** push したタグの本文は
   後から書き換えられないため、詳細はタグではなく `CHANGELOG.md` 側に置く
3. 上の手順8「本番 D1 にマイグレーションを適用する」(`pnpm db:migrate:remote`)
   → 手順9「デプロイする」(`pnpm deploy`)の順で本番に反映する
4. **デプロイの成功を確認してから**、`CHANGELOG.md` の先頭バージョンの
   「変更」の節だけを Discord の通知チャンネルに投稿する。まず本文を確認する。

   ```sh
   pnpm changelog:announce:dry
   ```

   これは環境変数を一切読まず、ネットワークにも触れずに組み立てた本文と
   文字数を表示するだけなので、安全に確認できる。問題なければ投稿する。

   ```sh
   pnpm changelog:announce
   ```

   `.dev.vars.announce`(gitignore 済み)に手順6で登録した
   `DISCORD_BOT_TOKEN` と `DISCORD_CHANNEL_ID` を書いてから実行する。
   **シェルに同名の環境変数を export したままだと、そちらの値が
   `.dev.vars.announce` より優先される。** 別の Bot・別のチャンネル宛の
   値が残っていると意図しないチャンネルに投稿してしまうため、実行前に
   `echo $DISCORD_BOT_TOKEN` 等で残っていないか確認する。`.dev.vars.announce`
   を書き忘れて存在しない場合は(`--env-file-if-exists` ではなく
   `--env-file` を使っているため)Node がその場でエラーになり、投稿は
   行われない。`CHANGELOG.md` の先頭バージョンと `package.json` の
   `version` が一致しない場合、または本文が Discord の上限(2000文字)を
   超える場合も、投稿せずエラーで終了する。

## トラブルシューティング

- **テストが全ファイル失敗し `Failed to execute 'applyD1Migrations':
  parameter 1 is not of type 'D1Database'` が出る** → `wrangler.toml` の
  `[[d1_databases]]` の `binding` がコードの参照名(`DB`)と食い違っている。
- **`pnpm test` が `styleText` 関連のエラーで起動しない** → 素の `node`
  (v18)で実行している。mise の Node 22 を使う。
  `~/.local/bin/mise exec -- pnpm test` のように呼ぶか、シェルで mise を
  有効化する。
- **`pnpm` が `libatomic.so.1` のエラーで起動しない** → mise 管理の pnpm
  ではなく corepack の pnpm を使う(上の「なぜ corepack で pnpm を有効化
  するか」を参照)。
- **ローカルの D1 を作り直したい** → `.wrangler/state/v3/d1/` を削除して
  `pnpm db:migrate:local`。`wrangler.toml` の `database_id` を変えると
  ローカルの sqlite ファイルも別になるため、同じ現象が起きる。
- **ブラウザからのフォーム送信が 403「不正なリクエストです」になる** →
  CSRF 検査。上の「変更するときに壊してはいけない設計」を参照。

## 実装していない機能

フェーズ1(Web のみ)の範囲外のもの。仕様書 `docs/bandoff-spec.md` の10章に
フェーズ2・3として記載があるものと、章としての言及はないが現時点で単に
未実装のものが混ざっている。

- 告知の自動化 = フェーズ3
- イベントの削除(仕様書10章に言及はなく、単に未実装)
- 動的ポーリング間隔、ETag/304(仕様書の判断基準に達したら検討)
- CI(GitHub Actions)
