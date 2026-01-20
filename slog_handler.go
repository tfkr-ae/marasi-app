package main

import (
	"context"
	"log/slog"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type Log struct {
	Message   string         `json:"message"`
	Level     string         `json:"level"`
	Timestamp string         `json:"timestamp"`
	Data      map[string]any `json:"data"`
}
type LogHandler struct {
	context context.Context
	attrs   []slog.Attr
	group   string
}

func NewLogHandler(ctx context.Context) *slog.Logger {
	return slog.New(&LogHandler{context: ctx})
}

func (h *LogHandler) Enabled(_ context.Context, _ slog.Level) bool {
	return true
}

func (h *LogHandler) Handle(_ context.Context, r slog.Record) error {
	data := make(map[string]any, len(h.attrs)+r.NumAttrs())

	for _, a := range h.attrs {
		data[a.Key] = a.Value.Any()
	}

	r.Attrs(func(a slog.Attr) bool {
		data[a.Key] = a.Value.Any()
		return true
	})

	runtime.EventsEmit(h.context, "log", Log{
		Message:   r.Message,
		Level:     r.Level.String(),
		Timestamp: r.Time.Format("15:04:05"),
		Data:      data,
	})
	return nil
}
func (h *LogHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	newHandler := *h
	newHandler.attrs = append(newHandler.attrs[:len(h.attrs):len(h.attrs)], attrs...)
	return &newHandler
}

func (h *LogHandler) WithGroup(name string) slog.Handler {
	newHandler := *h
	newHandler.group = name
	return &newHandler
}
