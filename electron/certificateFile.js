// The instance's CA certificate, saved on this machine, as v1's DownloadCert
// did. The renderer reads the PEM from GET /certificate.
import { createSavedFile } from "./savedFile.js";

const certificateName = "marasi-proxy.crt";

export const certificateFileFilters = [
  { name: "Certificate Files (*.crt)", extensions: ["crt"] },
  { name: "PEM Files (*.pem)", extensions: ["pem"] },
  { name: "All Files (*.*)", extensions: ["*"] },
];

/** MARASI_CERTIFICATE_DIR saves there without the dialog. */
export function createCertificateFile(options) {
  const file = createSavedFile({
    ...options,
    title: "Save Proxy Certificate",
    dirEnv: "MARASI_CERTIFICATE_DIR",
    fallback: certificateName,
    filters: certificateFileFilters,
  });
  return {
    /** Writes `pem` to a chosen file; returns its path, "" if cancelled. */
    async save(pem) {
      if (typeof pem !== "string") throw new Error("not a certificate");
      return file.save(certificateName, new TextEncoder().encode(pem));
    },
  };
}
