package main

import (
	"context"
	"encoding/json"
	"log/slog"
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

func TestRelayLoggerReachesFrontendOnceAttached(t *testing.T) {
	var base, frontend recordingHandler
	logger, attachFrontend := newRelayLogger(&base)
	dbLogger := logger.With("component", "db")

	dbLogger.Info("before attach")
	attachFrontend(&frontend)
	dbLogger.Info("Connecting to SQLite...", "path", "/tmp/p.marasi")

	if got := base.messages(); len(got) != 2 {
		t.Fatalf("wanted both records on the base handler, got %v", got)
	}
	got := frontend.records
	if len(got) != 1 || got[0].message != "Connecting to SQLite..." {
		t.Fatalf("wanted only the post-attach record on the frontend, got %+v", got)
	}
	if got[0].attrs["component"] != "db" || got[0].attrs["path"] != "/tmp/p.marasi" {
		t.Fatalf("wanted component and path attributes on the frontend record, got %v", got[0].attrs)
	}
}

type recordedLog struct {
	message string
	attrs   map[string]any
}

// recordingHandler keeps every record it handles, with attributes from both
// WithAttrs and the record itself. Handlers made by WithAttrs share its log.
type recordingHandler struct {
	records []recordedLog
	attrs   []slog.Attr
	parent  *recordingHandler
}

func (h *recordingHandler) root() *recordingHandler {
	if h.parent != nil {
		return h.parent.root()
	}
	return h
}

func (h *recordingHandler) Enabled(context.Context, slog.Level) bool { return true }

func (h *recordingHandler) Handle(_ context.Context, r slog.Record) error {
	attrs := map[string]any{}
	for _, a := range h.attrs {
		attrs[a.Key] = a.Value.Any()
	}
	r.Attrs(func(a slog.Attr) bool {
		attrs[a.Key] = a.Value.Any()
		return true
	})
	root := h.root()
	root.records = append(root.records, recordedLog{message: r.Message, attrs: attrs})
	return nil
}

func (h *recordingHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &recordingHandler{attrs: append(append([]slog.Attr{}, h.attrs...), attrs...), parent: h.root()}
}

func (h *recordingHandler) WithGroup(string) slog.Handler { return h }

func (h *recordingHandler) messages() []string {
	var out []string
	for _, r := range h.root().records {
		out = append(out, r.message)
	}
	return out
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
