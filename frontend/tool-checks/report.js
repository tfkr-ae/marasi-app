// How the tool contract checks report: one line per check, named, then a
// summary. A failing check fails the run; a pending one says what it waits
// for and doesn't.

export function createReport(group) {
  const results = [];
  const line = (status, name, detail = "") => {
    results.push({ status, name, detail });
    console.log(`${status.padEnd(7)} ${group}: ${name}${detail ? ` — ${detail}` : ""}`);
  };
  return {
    pass: (name, detail) => line("PASS", name, detail),
    fail: (name, detail) => line("FAIL", name, detail),
    pending: (name, reason) => line("PENDING", name, reason),
    /** Runs `fn`; a throw fails the check with its message. */
    async check(name, fn) {
      try {
        const detail = await fn();
        line("PASS", name, typeof detail === "string" ? detail : "");
      } catch (err) {
        line("FAIL", name, String(err?.message ?? err));
      }
    },
    /** Prints the summary and returns the exit code: 1 when any check failed. */
    finish() {
      const count = (status) => results.filter((r) => r.status === status).length;
      const failed = results.filter((r) => r.status === "FAIL");
      console.log(`\n${group}: ${count("PASS")} passed, ${failed.length} failed, ${count("PENDING")} pending`);
      for (const r of failed) console.log(`  failed: ${r.name}`);
      return failed.length ? 1 : 0;
    },
  };
}
