// The text a failed Lua run shows: the service's lua_error message alone,
// or the whole error for any other failure.
export function luaErrorText(error) {
  if (error?.code === "lua_error" && error.body?.message) return error.body.message;
  return String(error?.message ?? error);
}
