package main

import (
	"fmt"
	"log"
	"maps"
	"slices"

	"go.yaml.in/yaml/v3"
)

// Owned runs (GLOSSARY "Owned run"): app config keeps, per local connection
// id, the run_id of the run the app last started there, so ownership
// survives a relaunch. A connect that finds another run_id (someone else
// restarted or replaced the instance) or none (it stopped) clears the
// record, so the app never stops another client's run.

const ownedRunsKey = "owned_runs"

func parseOwnedRuns(node *yaml.Node) map[string]string {
	runs := map[string]string{}
	if node == nil {
		return runs
	}
	if err := node.Decode(&runs); err != nil {
		log.Printf("[!] %s in the app config isn't valid, ignoring it: %v", ownedRunsKey, err)
		return map[string]string{}
	}
	maps.DeleteFunc(runs, func(id, run string) bool { return id == "" || run == "" })
	return runs
}

// savedOwnedRun is the run_id the app last started on connection id, ""
// when it owns none there.
func (a *App) savedOwnedRun(id string) string {
	a.Config.mu.Lock()
	defer a.Config.mu.Unlock()
	return a.Config.ownedRuns[id]
}

// ownedRunConnections lists the connections with a saved owned run.
func (a *App) ownedRunConnections() []string {
	a.Config.mu.Lock()
	defer a.Config.mu.Unlock()
	return slices.Sorted(maps.Keys(a.Config.ownedRuns))
}

// saveOwnedRun records runID as the app's run on connection id; "" clears
// the record. Nothing is written when the record already says so.
func (a *App) saveOwnedRun(id, runID string) {
	a.Config.mu.Lock()
	defer a.Config.mu.Unlock()
	if a.Config.ownedRuns[id] == runID {
		return
	}
	next := maps.Clone(a.Config.ownedRuns)
	if next == nil {
		next = map[string]string{}
	}
	if runID == "" {
		delete(next, id)
	} else {
		next[id] = runID
	}
	if err := writeConfigKeys(a.Config.path(), map[string]any{ownedRunsKey: next}); err != nil {
		// The record still holds for this launch; only a relaunch loses it.
		log.Printf("[!] %v", fmt.Errorf("saving the owned run of %s: %w", id, err))
	}
	a.Config.ownedRuns = next
}

// ownsRun reports whether runID, the run now on connection id's instance
// ("" when it isn't running), is the one the app started there, and clears
// a saved record it no longer matches.
func (a *App) ownsRun(id, runID string) bool {
	saved := a.savedOwnedRun(id)
	if saved == "" {
		return false
	}
	if runID == saved {
		return true
	}
	a.saveOwnedRun(id, "")
	return false
}
