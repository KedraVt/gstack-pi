/**
 * `$`-safe string replacement (efficiency plan STEP 2c / COR-07).
 *
 * `String.prototype.replace` with a string replacement argument interprets
 * `$$`, `$&`, `` $` ``, `$'` and `$1..$99` — so untrusted text (user goals,
 * subagent output, repo content) silently corrupts the surrounding template.
 * Using a function replacement makes the value literal.
 */
export function replaceExact(
  t: string,
  token: RegExp,
  value: string | ((...args: any[]) => string),
): string {
  const repl =
    typeof value === "function" ? (value as any) : () => value; // function form = literal
  return t.replace(token, repl);
}
