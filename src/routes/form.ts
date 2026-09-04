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
