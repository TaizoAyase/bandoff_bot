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
    participants.ts    参加者登録・参加者一覧
    songs.ts           曲の登録・編集・削除、枠へのエントリー・辞退
    takes.ts           Take・Slot の追加・削除(枠構成そのものの増減)
    me.ts              自分のエントリー一覧・設定(プロフィール編集・端末解除)
    organizer.ts       主催者ログイン・イベント編集・JSON エクスポート
  views/            Hono JSX。JSX が閉じ込められているのはここだけ
    layout.tsx        全ページ共通レイアウト(OGP なし、CSP 準拠)
    render.tsx         DOCTYPE 付与のヘルパ
    pages/              1ページ1コンポーネント
    components/          複数ページで共有する部品(曲カード・枠一覧など)
  db/
    schema.ts          Drizzle ORM のテーブル定義
    client.ts            D1 バインディングから Drizzle クライアントを作る
    queries/              テーブルごとのクエリ関数(SQL はここに閉じる)
  domain/           DB にもリクエストにも触れない純粋関数
    permissions.ts       仕様 4章の権限表の実装
    validation.ts         各フォームの入力検証・上限値
    crypto.ts / ids.ts / time.ts / instruments.ts / rate-limit.ts / hooks.ts など
  client/           ブラウザで動く最小限の TypeScript(esbuild でバンドル)
    main.ts             data-page で処理を分岐するエントリポイント
    polling.ts             曲一覧の自動更新(非アクティブタブで停止)
    session.ts / storage.ts  端末トークン・復帰キーの localStorage 操作
    ui.ts                  確認ダイアログ・コピー操作などの汎用 UI 配線
migrations/         drizzle-kit generate の出力 + 既定 Workspace 投入用の手書き SQL
public/             静的アセット(robots.txt、CSS、esbuild が吐く js/ は gitignore)
test/
  domain/*.test.ts    純粋関数の単体テスト
  routes/*.test.ts     ルートの結合テスト(`app.request()` + cookie jar)
  helpers.ts            テスト用のイベント作成・ログイン・曲登録などのヘルパ
```

## 補足

- タイムゾーンは日本時間固定。DB には UTC エポック秒で保存する。
- 合言葉のみ平文保存(主催者画面で再表示するため)。主催者キー・端末トークン・
  引き継ぎコードはハッシュのみ保存する。
- CI はこのフェーズには含まれない(次の計画で扱う)。

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

### 6. 本番 D1 にマイグレーションを適用する

手順4で `database_id` を書き写していないと(プレースホルダ
`PLACEHOLDER_REPLACE_AFTER_D1_CREATE` のままだと)、ここで失敗して止まる。

```sh
pnpm db:migrate:remote
```

### 7. デプロイする

```sh
pnpm deploy
```

lint・型チェック・テスト・クライアント JS のビルドを行ってから
`wrangler deploy` を実行する(`public/js/` は gitignore されているため、
ビルドを飛ばすとクライアント JS が欠けた状態で公開されてしまう)。この
`database_id` も手順4で書き写していないと失敗して止まる。なお `pnpm
deploy:dry`(手順1〜4より前でも試せるバンドル検証用コマンド)は API を
呼ばないため、`database_id` が不正な値のままでも成功してしまう点に注意する。

### 8. デプロイ後の確認

- `/` が 200 で返る
- `/robots.txt` が `Disallow: /` を返す
- `/js/main.js` が 200 で返る
- `/new` からイベントを作成し、発行された合言葉でそのイベントに入れる
- レスポンスに CSP・`X-Robots-Tag`・`Referrer-Policy` などのセキュリティ
  ヘッダが付与されている

### 9. 運用メモ

- バックアップは月1回程度を目安に取る(仕様書 9.3)。上書きされないよう
  ファイル名に日付を入れる。

  ```sh
  pnpm exec wrangler d1 export studio-parts --remote \
    --output "backup-$(date +%Y%m%d).sql"
  ```

- 無料枠の目安: Workers は 10万リクエスト/日、D1 は 5GB・500万行読み取り/日・
  10万行書き込み/日。
- トラブル時のログ調査は `pnpm exec wrangler tail` でリアルタイムに見る
  (`[observability]` の設定変更は不要。Real-time Logs は Workers Logs
  の永続化設定とは独立した別機能で、`wrangler.toml` の変更なしにそのまま
  使える)。ただし画面には合言葉付きの URL や主催者キーを含むリクエストが
  そのまま表示されるため、共有画面やスクリーンショットへの映り込みに注意
  する。
