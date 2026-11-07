package main

import (
	"slices"
	"sync"
	"testing"
)

// newTestApp returns an App on a fresh app config directory.
func newTestApp(t *testing.T) *App {
	t.Helper()
	configDir := t.TempDir()
	app := newApp(configDir)
	var err error
	if app.Config, err = LoadConfig(configDir); err != nil {
		t.Fatalf("loading app config: %v", err)
	}
	return app
}

// recordedEvents records the events an App emits.
type recordedEvents struct {
	mu    sync.Mutex
	names []string
	data  [][]any
}

func (events *recordedEvents) emit(name string, data ...any) {
	events.mu.Lock()
	defer events.mu.Unlock()
	events.names = append(events.names, name)
	events.data = append(events.data, data)
}

// first returns the data of the first event called name, or false when none
// has been emitted.
func (events *recordedEvents) first(name string) ([]any, bool) {
	events.mu.Lock()
	defer events.mu.Unlock()
	for i, recorded := range events.names {
		if recorded == name {
			return events.data[i], true
		}
	}
	return nil, false
}

func (events *recordedEvents) has(name string) bool {
	events.mu.Lock()
	defer events.mu.Unlock()
	return slices.Contains(events.names, name)
}
