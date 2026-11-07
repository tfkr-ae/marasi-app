// The toast an extension renders at the "toast" target
// (marasi.gui:render("toast", {message, variant})), as Skeleton toast
// settings. An unknown variant shows as primary.
const variants = ["primary", "secondary", "tertiary", "success", "warning", "error", "surface"];

export function extensionToast(schema = {}) {
  const variant = variants.includes(schema.variant) ? schema.variant : "primary";
  return { message: schema.message, background: `variant-filled-${variant}` };
}
