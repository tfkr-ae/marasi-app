// The control API sends Go []byte fields (traffic raw, launch raw) as
// standard base64. The app shows raw HTTP as text, as the Go bindings did:
// UTF-8, with invalid bytes as U+FFFD.

/** Base64 bytes as UTF-8 text; "" for none. */
export function decodeBase64Text(base64) {
  if (!base64) return "";
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Text as the base64 of its UTF-8 bytes. */
export function encodeBase64Text(text) {
  const bytes = new TextEncoder().encode(text ?? "");
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
