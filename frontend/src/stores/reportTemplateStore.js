// The instance's report templates, wired to the report bindings
// (createReportTemplateStore.js has the logic).
import { createReportTemplateStore } from "./createReportTemplateStore.js";
import {
  DeleteReportTemplate,
  ListTemplates,
  RestoreDefaultReportTemplate,
  UploadReportTemplate,
} from "../lib/bindings/App";

export const reportTemplateStore = createReportTemplateStore({
  list: ListTemplates,
  upload: UploadReportTemplate,
  remove: DeleteReportTemplate,
  restore: RestoreDefaultReportTemplate,
});
