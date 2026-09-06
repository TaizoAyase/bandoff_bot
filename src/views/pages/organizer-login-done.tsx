import { Layout } from "../layout";

export interface OrganizerLoginDonePageProps {
  slug: string;
  /** 照合済みの主催者キー(平文)。この画面限りで表示し、サーバーには保存しない。 */
  organizerKey: string;
}

/**
 * 主催者ログイン成功直後のページ。主催者キーの localStorage への保存と
 * 主催者画面への自動遷移は `src/client/session.ts` の
 * `initOrganizerLoginDone()` が行う。JS が動かない環境では下のリンクで進む。
 */
export const OrganizerLoginDonePage = ({
  slug,
  organizerKey,
}: OrganizerLoginDonePageProps) => (
  <Layout title="主催者ログインできました - bandoff" page="organizer-login-done">
    <main class="page" data-slug={slug} data-organizer-key={organizerKey}>
      <h1>主催者ログインできました</h1>
      <p>
        <a href={`/e/${slug}/organizer`}>主催者画面へ</a>
      </p>
    </main>
  </Layout>
);
