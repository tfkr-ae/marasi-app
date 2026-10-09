package main

import (
	"github.com/google/uuid"
	marasi "github.com/tfkr-ae/marasi"
	"github.com/tfkr-ae/marasi/domain"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func (a *App) configureWebSocketHandlers() {
	a.Proxy.WithOptions(
		marasi.WithWebSocketOpenHandler(func(conn domain.WebSocketConnection) error {
			runtime.EventsEmit(a.ctx, "ws-open", conn)
			return nil
		}),
		marasi.WithWebSocketMessageHandler(func(msg domain.WebSocketMessage) error {
			runtime.EventsEmit(a.ctx, "ws-message", msg)
			return nil
		}),
		marasi.WithWebSocketCloseHandler(func(conn domain.WebSocketConnection) error {
			runtime.EventsEmit(a.ctx, "ws-close", conn)
			return nil
		}),
		marasi.WithWebSocketInterceptHandler(func(msg domain.WebSocketMessage) error {
			runtime.EventsEmit(a.ctx, "ws-intercepted", msg)
			return nil
		}),
	)
}

func (a *App) GetWebSocketMessages(id uuid.UUID) ([]*domain.WebSocketMessage, error) {
	return a.Proxy.GetWebSocketMessages(id)
}

func (a *App) GetWebSocketConnection(id uuid.UUID) *domain.WebSocketConnection {
	conn, ok := a.Proxy.GetWebSocketConnection(id)
	if !ok {
		return nil
	}
	return &conn
}

func (a *App) InjectWebSocketMessage(id uuid.UUID, direction string, opcode int, payload string) error {
	_, err := a.Proxy.InjectWebSocketMessage(id, direction, opcode, []byte(payload))
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
	return a.Proxy.ForwardCheckpoint(messageID, marasi.CheckpointForward{
		Payload: &body,
		Opcode:  &opcode,
	})
}

func (a *App) DropWSIntercepted(messageID uuid.UUID) error {
	return a.Proxy.DropCheckpoint(messageID)
}
