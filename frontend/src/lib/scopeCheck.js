// The scope tester's check over the service: POST /scope/check, in the
// fields ScopeTester.svelte reads (the Go binding's TestScopeMatch shape).

/**
 * Tests `url` (https:// when it has no scheme) against the project's scope:
 * { inScope, matchedRule, ruleType: "include" | "exclude" | "", matchedAs,
 * defaultAllowUsed, testedUrl }, or { error } for a URL that doesn't parse.
 */
export async function checkScope(client, url) {
  let result;
  try {
    result = await client.post("/scope/check", { url });
  } catch (err) {
    if (err?.code === "bad_request") return { error: "Invalid URL" };
    throw err;
  }
  const rule = result.rule;
  return {
    inScope: result.in_scope,
    matchedRule: rule?.pattern ?? "",
    // A matched rule decided the answer: an include rule lets it in, an
    // exclude rule keeps it out.
    ruleType: rule ? (result.in_scope ? "include" : "exclude") : "",
    matchedAs: rule?.match_type ?? "",
    defaultAllowUsed: !rule,
    testedUrl: result.tested_url,
  };
}
