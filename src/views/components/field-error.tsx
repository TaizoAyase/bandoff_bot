/** フォームの1項目分のエラーメッセージ。無ければ何も描画しない。 */
export const FieldError = ({ message }: { message?: string }) =>
  message ? <p class="field-error">{message}</p> : null;
