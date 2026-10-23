package main

import (
	"errors"
	"net/http"
	"time"

	"github.com/google/martian"
	"github.com/google/martian/fifo"
	"github.com/google/uuid"
	marasi "github.com/tfkr-ae/marasi"
	"github.com/tfkr-ae/marasi/core"
	"github.com/tfkr-ae/marasi/domain"
	marasiws "github.com/tfkr-ae/marasi/websocket"
)

// configureWebSocketHandlers sends Marasi's WebSocket events to the frontend
// through the app's emitter. The handlers read a.emitEvent when they fire, so
// tests can swap it to observe the events.
func (a *App) configureWebSocketHandlers() {
	a.Proxy.WithOptions(
		marasi.WithWebSocketOpenHandler(func(conn domain.WebSocketConnection) error {
			a.emitEvent("ws-open", conn)
			return nil
		}),
		marasi.WithWebSocketMessageHandler(func(msg domain.WebSocketMessage) error {
			a.emitEvent("ws-message", msg)
			return nil
		}),
		marasi.WithWebSocketCloseHandler(func(conn domain.WebSocketConnection) error {
			a.emitEvent("ws-close", conn)
			return nil
		}),
		marasi.WithWebSocketInterceptHandler(func(msg domain.WebSocketMessage) error {
			a.checkpointTimes.set(msg.ID, time.Now())
			a.emitEvent("ws-intercepted", msg)
			return nil
		}),
		marasi.WithWebSocketProgressHandler(a.progressRelay()),
	)
	a.watchDroppedUpgrades()
}

// webSocketUpgradeState is the ws-state event: an upgrade request whose
// handshake ended without a connection, as "failed" or "dropped".
type webSocketUpgradeState struct {
	RequestID uuid.UUID
	State     string
}

// watchDroppedUpgrades wraps Marasi's modifier pipeline so an upgrade
// response the pipeline drops emits ws-state. Marasi records websocket.state
// failed or dropped for it in the database only, so without this the Ledger
// row would stay pending until it is read again. The pipeline drops the
// response when the handshake fails, an extension calls res:drop(), or
// Checkpoint drops it.
func (a *App) watchDroppedUpgrades() {
	inner := a.Proxy.Modifiers
	outer := fifo.NewGroup()
	outer.AddRequestModifier(inner)
	outer.AddResponseModifier(martian.ResponseModifierFunc(func(res *http.Response) error {
		err := inner.ModifyResponse(res)
		if errors.Is(err, marasi.ErrDropped) {
			a.emitDroppedUpgrade(res.Request)
		}
		return err
	}))
	a.Proxy.Modifiers = outer
}

// emitDroppedUpgrade emits ws-state for req when it is an upgrade request.
// Marasi has already stored "failed" for a handshake it could not complete;
// any other drop is stored as "dropped" once the pipeline returns.
func (a *App) emitDroppedUpgrade(req *http.Request) {
	if req == nil || !marasiws.IsUpgradeRequest(req) {
		return
	}
	requestID, ok := core.RequestIDFromContext(req.Context())
	if !ok {
		return
	}
	state := "dropped"
	if a.Proxy.TrafficRepo != nil {
		if metadata, err := a.Proxy.TrafficRepo.GetMetadata(requestID); err == nil && metadata["websocket.state"] == "failed" {
			state = "failed"
		}
	}
	a.emitEvent("ws-state", webSocketUpgradeState{RequestID: requestID, State: state})
}

// progressQueueSize bounds the progress records waiting to be emitted. Marasi
// throttles progress per message, so a full queue means the frontend is far
// behind and dropping a record only skips an intermediate count.
const progressQueueSize = 64

// progressRelay returns a progress handler that never blocks Marasi's relay.
// Records go to one goroutine that emits ws-progress in arrival order; a
// record that finds the queue full is dropped.
func (a *App) progressRelay() func(domain.WebSocketMessageProgress) error {
	queue := make(chan domain.WebSocketMessageProgress, progressQueueSize)
	go func() {
		for progress := range queue {
			a.emitEvent("ws-progress", progress)
		}
	}()
	return func(progress domain.WebSocketMessageProgress) error {
		select {
		case queue <- progress:
		default:
		}
		return nil
	}
}

func (a *App) GetWebSocketMessages(id uuid.UUID) ([]*domain.WebSocketMessage, error) {
	return a.Proxy.GetWebSocketMessages(id)
}

// GetWebSocketConnection returns the stored connection record for an upgrade
// request, live or closed, so the Connection tab can show a connection that
// has already closed. Before the record is stored it falls back to Marasi's live state,
// which has no Deflate or RemovedExtensions.
func (a *App) GetWebSocketConnection(id uuid.UUID) *domain.WebSocketConnection {
	if a.Proxy.WebSocketRepo != nil {
		if record, err := a.Proxy.WebSocketRepo.GetConnectionByRequestID(id); err == nil && record != nil {
			return record
		}
	}
	conn, ok := a.Proxy.GetWebSocketConnection(id)
	if !ok {
		return nil
	}
	return &conn
}

// InjectWebSocketMessage sends payload on the connection's direction leg.
// On a permessage-deflate connection, text and binary messages are
// compressed unless neverCompress is set.
func (a *App) InjectWebSocketMessage(id uuid.UUID, direction string, opcode int, payload string, neverCompress bool) error {
	_, err := a.Proxy.InjectWebSocketMessage(id, direction, opcode, []byte(payload), marasiws.InjectOptions{NeverCompress: neverCompress})
	return err
}

func (a *App) CloseWebSocket(id uuid.UUID, code int, reason string) error {
	return a.Proxy.CloseWebSocket(id, code, reason)
}

func (a *App) GetWSInterceptFlag() bool {
	return a.Proxy.GetWebSocketIntercept()
}

func (a *App) SetWSIntercept(enabled bool) bool {
	a.Proxy.SetWebSocketIntercept(enabled)
	return a.Proxy.GetWebSocketIntercept()
}

func (a *App) ToggleWSIntercept() bool {
	return a.SetWSIntercept(!a.Proxy.GetWebSocketIntercept())
}

func (a *App) GetWSIntercepted(requestID uuid.UUID) *domain.WebSocketMessage {
	for _, msg := range a.Proxy.GetPendingWebSocketInterceptions() {
		if msg.RequestID == requestID {
			cp := msg
			return &cp
		}
	}
	return nil
}

func (a *App) ForwardWSIntercepted(messageID uuid.UUID, opcode int, payload string) error {
	body := []byte(payload)
	return a.settleCheckpoint(messageID, func() error {
		return a.Proxy.ForwardCheckpoint(messageID, marasi.CheckpointForward{
			Payload: &body,
			Opcode:  &opcode,
		})
	})
}

func (a *App) DropWSIntercepted(messageID uuid.UUID) error {
	return a.DropCheckpoint(messageID)
}
