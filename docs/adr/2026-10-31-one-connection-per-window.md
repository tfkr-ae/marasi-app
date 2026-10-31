# One connection per window

In Marasi App v2, each window has at most one connection to a service instance. The researcher switches between instances by switching windows, through the Window menu and ⌘K. One window that switches between several connections in place was the other option. We chose one connection per window because the existing Svelte stores are single module-level instances, and every one of them would have had to be keyed by connection. With a window per connection, each renderer keeps its stores as they are. Each window's session adds only its own instance's token. Launchpad drafts also stay in the window's memory, keyed by project, so a dirty draft survives a project switch made by another client and comes back when that project is open again.

## Consequences

- An instance the researcher isn't looking at signals through its own window: its rail badge, and the dock badge. There is no shared in-window indicator.
- Quitting the app stops every instance the app started, unless the researcher disconnected from it first.
