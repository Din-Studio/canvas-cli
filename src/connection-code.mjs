/** A portable one-use invitation, not encryption. The daemon owns expiry/auth. */
export function parseConnectionCode(input) {
  if (typeof input !== "string" || input.length > 512) throw new Error("invalid_connection_code");
  const code = input
    .trim()
    .replace(/^```(?:text)?\s*\n?([\s\S]*?)\n?```$/, "$1")
    .replace(/\s/g, "");
  const match = /^SM1\.([1-9]\d{0,4})\.([A-Za-z0-9_-]{43})$/.exec(code);
  if (!match || Number(match[1]) > 65535 || Number(match[1]) === 80)
    throw new Error("invalid_connection_code");
  return { endpoint: `http://127.0.0.1:${match[1]}`, code: match[2] };
}
export function createConnectionCode(endpoint, token) {
  const match = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})$/.exec(endpoint);
  if (!match) throw new Error("invalid_connection_code");
  const code = `SM1.${match[1]}.${token}`;
  parseConnectionCode(code);
  return code;
}
