package main

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"go.yaml.in/yaml/v3"
)

// readConfigDocument parses the app config as a YAML document. A missing or
// empty file is an empty mapping.
func readConfigDocument(path string) (*yaml.Node, error) {
	doc := &yaml.Node{Kind: yaml.DocumentNode, Content: []*yaml.Node{{Kind: yaml.MappingNode, Tag: "!!map"}}}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return doc, nil
	}
	if err != nil {
		return nil, err
	}
	var parsed yaml.Node
	if err := yaml.Unmarshal(data, &parsed); err != nil {
		return nil, err
	}
	if parsed.Kind == 0 {
		return doc, nil
	}
	if parsed.Kind != yaml.DocumentNode || len(parsed.Content) != 1 || parsed.Content[0].Kind != yaml.MappingNode {
		return nil, fmt.Errorf("%s is not a YAML mapping", path)
	}
	return &parsed, nil
}

// documentValue returns the value node of a top-level key, or nil.
func documentValue(doc *yaml.Node, key string) *yaml.Node {
	mapping := doc.Content[0]
	for i := 0; i+1 < len(mapping.Content); i += 2 {
		if mapping.Content[i].Value == key {
			return mapping.Content[i+1]
		}
	}
	return nil
}

// writeConfigKeys replaces (or appends) the given top-level keys in the app
// config and leaves every other key exactly as parsed, then writes the file
// atomically: a temp file in the same directory, fsync, rename. On error the
// original file is unchanged.
func writeConfigKeys(path string, values map[string]any) error {
	doc, err := readConfigDocument(path)
	if err != nil {
		return err
	}
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	mapping := doc.Content[0]
	for _, key := range keys {
		var value yaml.Node
		if err := value.Encode(values[key]); err != nil {
			return fmt.Errorf("encoding %s: %w", key, err)
		}
		if existing := documentValue(doc, key); existing != nil {
			*existing = value
			continue
		}
		mapping.Content = append(mapping.Content, &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: key}, &value)
	}
	return writeConfigDocument(path, doc)
}

// deleteConfigKeys removes the given top-level keys from the app config,
// leaving every other key as parsed, and writes the file atomically. If none
// of the keys are present, the file is left untouched.
func deleteConfigKeys(path string, keys ...string) error {
	if len(keys) == 0 {
		return nil
	}
	doc, err := readConfigDocument(path)
	if err != nil {
		return err
	}
	drop := make(map[string]struct{}, len(keys))
	for _, key := range keys {
		drop[key] = struct{}{}
	}
	mapping := doc.Content[0]
	kept := make([]*yaml.Node, 0, len(mapping.Content))
	removed := false
	for i := 0; i+1 < len(mapping.Content); i += 2 {
		if _, ok := drop[mapping.Content[i].Value]; ok {
			removed = true
			continue
		}
		kept = append(kept, mapping.Content[i], mapping.Content[i+1])
	}
	if !removed {
		return nil
	}
	mapping.Content = kept
	return writeConfigDocument(path, doc)
}

func writeConfigDocument(path string, doc *yaml.Node) error {
	var data bytes.Buffer
	encoder := yaml.NewEncoder(&data)
	encoder.SetIndent(2)
	if err := encoder.Encode(doc); err != nil {
		return fmt.Errorf("encoding config: %w", err)
	}
	if err := encoder.Close(); err != nil {
		return fmt.Errorf("encoding config: %w", err)
	}
	return writeFileAtomic(path, data.Bytes())
}

func writeFileAtomic(path string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".*.tmp")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if err := tmp.Chmod(0600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpPath, path)
}
