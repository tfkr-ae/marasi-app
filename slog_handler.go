package main

import (
	"context"
	"errors"
	"log/slog"
	"sync/atomic"

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

// newRelayLogger returns a logger that writes to base and, once attach has
// been called, also to a frontend handler. The project lifecycle receives its
// logger before Wails starts, so this is how its database and migration
// messages reach the splash screen.
func newRelayLogger(base slog.Handler) (*slog.Logger, func(slog.Handler)) {
	frontend := &atomic.Pointer[slog.Handler]{}
	attach := func(h slog.Handler) { frontend.Store(&h) }
	return slog.New(&relayHandler{base: base, frontend: frontend}), attach
}

type relayHandler struct {
	base     slog.Handler
	frontend *atomic.Pointer[slog.Handler]
	// derive replays WithAttrs/WithGroup calls onto the frontend handler,
	// which may be attached after they were made.
	derive []func(slog.Handler) slog.Handler
}

func (h *relayHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.base.Enabled(ctx, level) || h.frontend.Load() != nil
}

func (h *relayHandler) Handle(ctx context.Context, r slog.Record) error {
	var err error
	if h.base.Enabled(ctx, r.Level) {
		err = h.base.Handle(ctx, r.Clone())
	}
	if frontend := h.frontend.Load(); frontend != nil {
		handler := *frontend
		for _, derive := range h.derive {
			handler = derive(handler)
		}
		if handler.Enabled(ctx, r.Level) {
			err = errors.Join(err, handler.Handle(ctx, r.Clone()))
		}
	}
	return err
}

func (h *relayHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return h.with(h.base.WithAttrs(attrs), func(f slog.Handler) slog.Handler { return f.WithAttrs(attrs) })
}

func (h *relayHandler) WithGroup(name string) slog.Handler {
	return h.with(h.base.WithGroup(name), func(f slog.Handler) slog.Handler { return f.WithGroup(name) })
}

func (h *relayHandler) with(base slog.Handler, derive func(slog.Handler) slog.Handler) *relayHandler {
	return &relayHandler{
		base:     base,
		frontend: h.frontend,
		derive:   append(h.derive[:len(h.derive):len(h.derive)], derive),
	}
}
