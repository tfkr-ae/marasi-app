// An exported report, saved on this machine, as v1's ExportReport did. The
// renderer reads the rendered bytes from POST /report.
import { createSavedFile } from "./savedFile.js";

/** MARASI_REPORT_DIR saves there without the dialog. */
export const createReportFile = (options) =>
  createSavedFile({ ...options, title: "Save Report", dirEnv: "MARASI_REPORT_DIR", fallback: "report" });
