/**
 * `c.req.parseBody()` の戻り値(`string | File | (string | File)[]`)から
 * 安全に文字列を取り出すための小さなヘルパー。
 * このアプリのフォームはファイルアップロードを持たないため、
 * `File` が来た場合は空文字列として扱う。
 */

type FormValue = string | File | (string | File)[] | undefined;

/** 単一の文字列フィールドを取り出す。無ければ空文字列。 */
export function formString(value: FormValue): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === "string" ? first : "";
  }
  return "";
}

/** 同名フィールドが複数ある入力(`parseBody({ all: true })`)を文字列配列で取り出す。 */
export function formStringArray(value: FormValue): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  if (typeof value === "string") {
    return [value];
  }
  return [];
}

/**
 * `formStringArray` と同じだが、`File` を取り除かず空文字列に潰して
 * **要素数を保つ**。譜面URLと譜面の名前のように、同名フィールド2本を
 * 位置(n番目同士)で組にする入力に使う。取り除いてしまうと、その行以降の
 * 対応が1つずつずれる。
 *
 * ただし配列でない単一の `File` が来たときだけは `[""]`(1要素)ではなく
 * `[]`(0要素)になる。実害は無い: 欠けるのは常に index 0 の1件だけで、
 * `zipScoreUrlRows` が短い側を末尾に `""` を足して揃えた結果と一致するため、
 * 行のずれは起きない。
 */
export function formStringArrayPositional(value: FormValue): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === "string" ? v : ""));
  }
  if (typeof value === "string") {
    return [value];
  }
  return [];
}

/**
 * `c.req.json()` で受けた本文(`unknown`)から `{ token: string }` の
 * `token` を取り出す。`/session/rebind` と `/e/:slug/discord`(計画5-3)の
 * 両方で使う。無い・空文字・型違いなら `null`。
 */
export function extractToken(body: unknown): string | null {
  if (
    typeof body === "object" &&
    body !== null &&
    "token" in body &&
    typeof (body as { token: unknown }).token === "string"
  ) {
    const token = (body as { token: string }).token;
    return token === "" ? null : token;
  }
  return null;
}
