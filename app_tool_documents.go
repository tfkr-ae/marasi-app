package main

import (
	"fmt"
	"sort"
	"strings"
	"sync"
)

// toolDocuments counts the non-empty documents the tool pages hold in
// memory, by kind ("drawing" for Excalidraw, "recipe" for CyberChef). The
// frontend reports them (toolDocuments.js), so switching the project or
// quitting asks before they are lost. A Marasi document store replaces this
// later (GLOSSARY: Drawing, Recipe).
type toolDocuments struct {
	mu     sync.Mutex
	counts map[string]int
}

// SetOpenToolDocuments records how many non-empty documents of kind the
// frontend holds. The frontend calls it whenever that number changes.
func (a *App) SetOpenToolDocuments(kind string, count int) {
	a.toolDocs.mu.Lock()
	defer a.toolDocs.mu.Unlock()
	if a.toolDocs.counts == nil {
		a.toolDocs.counts = map[string]int{}
	}
	if count <= 0 {
		delete(a.toolDocs.counts, kind)
		return
	}
	a.toolDocs.counts[kind] = count
}

func (a *App) hasOpenToolDocuments() bool {
	a.toolDocs.mu.Lock()
	defer a.toolDocs.mu.Unlock()
	return len(a.toolDocs.counts) > 0
}

// toolDocumentsMessage names the open documents, such as "2 drawings and 1
// recipe exist only in memory. Switch Project will discard them.", or is
// empty. Kinds are named in alphabetical order.
func (a *App) toolDocumentsMessage(action string) string {
	a.toolDocs.mu.Lock()
	defer a.toolDocs.mu.Unlock()
	kinds := make([]string, 0, len(a.toolDocs.counts))
	total := 0
	for kind, count := range a.toolDocs.counts {
		kinds = append(kinds, kind)
		total += count
	}
	if total == 0 {
		return ""
	}
	sort.Strings(kinds)
	parts := make([]string, len(kinds))
	for i, kind := range kinds {
		count := a.toolDocs.counts[kind]
		noun := kind
		if count != 1 {
			noun += "s"
		}
		parts[i] = fmt.Sprintf("%d %s", count, noun)
	}
	if total == 1 {
		return parts[0] + " exists only in memory. " + action + " will discard it."
	}
	return strings.Join(parts, " and ") + " exist only in memory. " + action + " will discard them."
}
