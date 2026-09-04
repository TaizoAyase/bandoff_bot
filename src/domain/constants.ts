/**
 * 既定の Workspace の固定 id。
 *
 * フェーズ1では Discord Bot 連携がなく、Workspace は初回マイグレーションで
 * 投入される1件のみを使う(`migrations/0001_seed_default_workspace.sql` を参照)。
 * この定数はそのマイグレーションで使う値と一致させること。
 */
export const DEFAULT_WORKSPACE_ID = "ff82aac6-8c6c-431f-b2f1-445471fde088";
