// Download and Copy Certificate. The connected service's proxy certificate
// comes from GET /certificate; Go saves it through the native dialog
// (SaveFileAs) or puts it on the clipboard (CopyCertToClipboard). The
// bindings are passed in, so tests run with fakes.

/** Standard base64 of a string's UTF-8 bytes, as SaveFileAs takes them. */
export function base64Text(text) {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function createCertificateActions({ client, saveFileAs, copyCertToClipboard }) {
  const certificatePEM = async () => (await client.get("/certificate")).pem;
  return {
    /** Resolves to the saved path, or "" when the user cancelled. */
    async download() {
      const pem = await certificatePEM();
      return saveFileAs(
        "Save Proxy Certificate",
        "marasi-proxy.crt",
        "Certificate Files (*.crt)",
        "*.crt",
        base64Text(pem),
      );
    },
    /** Resolves to true once the PEM is on the clipboard. */
    async copy() {
      return copyCertToClipboard(await certificatePEM());
    },
  };
}
