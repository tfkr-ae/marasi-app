// Marasi's launchpad payloads in the shapes v1's frontend reads.

/** A GET /launchpad item as v1's Launchpad. */
export const launchpadOf = (item) => ({
  ID: item.id,
  Name: item.name,
  Description: item.description ?? "",
  EntryCount: item.entry_count ?? 0,
  LastStatusCode: item.last_status_code ?? null,
});

/** A GET /launch item, GET /launch/{id} or a launch.* event as v1's Launch. */
export const launchOf = (record) => ({
  ID: record.launch_id,
  LaunchpadID: record.launchpad_id,
  Status: record.status,
  Reason: record.reason ?? "",
});
