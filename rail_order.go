package main

import (
	"fmt"
	"log"
	"slices"
	"strings"

	"go.yaml.in/yaml/v3"
)

// App-wide rail order, persisted in the `rail_order` section of
// marasi_appconfig.yaml as a list of built-in page ids below Home. Omitted by
// default and removed on reset so future releases can place new built-in pages
// anywhere in the default order without locking researchers into a stale list.

const railOrderKey = "rail_order"

// normalizeRailOrder trims, lowercases, and deduplicates page ids preserving
// first occurrence. Any blank entry is rejected with an error.
func normalizeRailOrder(raw []string) ([]string, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	seen := make(map[string]struct{}, len(raw))
	out := make([]string, 0, len(raw))
	for i, item := range raw {
		id := strings.ToLower(strings.TrimSpace(item))
		if id == "" {
			return nil, fmt.Errorf("rail order entry %d is empty", i+1)
		}
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out, nil
}

// parseRailOrder reads the saved `rail_order` YAML node. A missing node means
// uncustomized (nil). A malformed node logs a warning, leaves the file
// untouched, and falls back to empty.
func parseRailOrder(node *yaml.Node) []string {
	if node == nil {
		return nil
	}
	if node.Kind != yaml.SequenceNode {
		log.Printf("[!] %s section unusable, using default: expected a list", railOrderKey)
		return nil
	}
	raw := make([]string, 0, len(node.Content))
	for i, elem := range node.Content {
		if elem.Kind != yaml.ScalarNode || elem.Tag != "!!str" {
			log.Printf("[!] %s section unusable, using default: entry %d is not a string", railOrderKey, i+1)
			return nil
		}
		raw = append(raw, elem.Value)
	}
	normalized, err := normalizeRailOrder(raw)
	if err != nil {
		log.Printf("[!] %s section unusable, using default: %v", railOrderKey, err)
		return nil
	}
	return normalized
}

func cloneRailOrder(order []string) []string {
	if len(order) == 0 {
		return []string{}
	}
	return slices.Clone(order)
}

// GetRailOrder returns the saved app-wide rail order (empty slice when
// uncustomized).
func (a *App) GetRailOrder() []string {
	a.Config.mu.Lock()
	defer a.Config.mu.Unlock()
	return cloneRailOrder(a.Config.railOrder)
}

// SaveRailOrder validates, normalizes, and persists the app-wide rail order.
// An empty list deletes `rail_order` from the YAML file. On error, disk and
// in-memory state remain unchanged and the current order is returned.
func (a *App) SaveRailOrder(order []string) ([]string, error) {
	cfg := a.Config
	cfg.mu.Lock()
	defer cfg.mu.Unlock()
	current := cloneRailOrder(cfg.railOrder)
	next, err := normalizeRailOrder(order)
	if err != nil {
		return current, err
	}
	if len(next) == 0 {
		if err := deleteConfigKeys(cfg.path(), railOrderKey); err != nil {
			return current, fmt.Errorf("clearing rail order: %w", err)
		}
		cfg.railOrder = nil
		return []string{}, nil
	}
	if err := writeConfigKeys(cfg.path(), map[string]any{railOrderKey: next}); err != nil {
		return current, fmt.Errorf("saving rail order: %w", err)
	}
	cfg.railOrder = next
	return cloneRailOrder(next), nil
}

// ResetRailOrder removes `rail_order` from the app config file atomically and
// restores the uncustomized state.
func (a *App) ResetRailOrder() ([]string, error) {
	cfg := a.Config
	cfg.mu.Lock()
	defer cfg.mu.Unlock()
	current := cloneRailOrder(cfg.railOrder)
	if err := deleteConfigKeys(cfg.path(), railOrderKey); err != nil {
		return current, fmt.Errorf("resetting rail order: %w", err)
	}
	cfg.railOrder = nil
	return []string{}, nil
}
