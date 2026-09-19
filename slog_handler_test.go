package main

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/tfkr-ae/marasi/domain"
)

func TestLogEventJSONForLogTable(t *testing.T) {
	t.Run("domain log fills table columns", func(t *testing.T) {
		payload, err := json.Marshal(domain.Log{
			Level:     "INFO",
			Message:   "Marasi Service Started on 127.0.0.1:8081",
			Timestamp: time.Date(2026, 9, 19, 12, 57, 9, 0, time.UTC),
		})
		if err != nil {
			t.Fatalf("marshaling domain log: %v", err)
		}
		level, message, timestamp := logTableColumns(t, payload)
		if level != "INFO" || message != "Marasi Service Started on 127.0.0.1:8081" || timestamp == "" {
			t.Fatalf("wanted table columns, got level=%q message=%q timestamp=%q from %s", level, message, timestamp, payload)
		}
	})

	t.Run("slog log leaves table columns empty", func(t *testing.T) {
		payload, err := json.Marshal(Log{
			Message:   "Proxy Client Configured",
			Level:     "INFO",
			Timestamp: "12:57:09",
			Data:      map[string]any{"url": "http://127.0.0.1:8081"},
		})
		if err != nil {
			t.Fatalf("marshaling slog log: %v", err)
		}
		level, message, timestamp := logTableColumns(t, payload)
		if level != "" || message != "" {
			t.Fatalf("wanted empty table columns for slog log, got level=%q message=%q timestamp=%q from %s", level, message, timestamp, payload)
		}
	})
}

func logTableColumns(t *testing.T, payload []byte) (level, message, timestamp string) {
	t.Helper()
	var row map[string]any
	if err := json.Unmarshal(payload, &row); err != nil {
		t.Fatalf("unmarshaling log table row: %v", err)
	}
	level, _ = row["Level"].(string)
	message, _ = row["Message"].(string)
	switch value := row["Timestamp"].(type) {
	case string:
		timestamp = value
	}
	return level, message, timestamp
}
