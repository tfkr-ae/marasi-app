package main

import (
	"errors"
	"fmt"

	"github.com/Shopify/go-lua"
	"github.com/google/uuid"
	"github.com/tfkr-ae/marasi/domain"
	"github.com/tfkr-ae/marasi/extensions"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// emitFunc sends a Wails event to the frontend.
type emitFunc func(name string, data ...any)

// emit sends a Wails event once startup has given the app its context. Events
// fired before then have no frontend to reach and are dropped.
func (a *App) emit(name string, data ...any) {
	if a.ctx == nil {
		return
	}
	runtime.EventsEmit(a.ctx, name, data...)
}

func extensionLogHandler(name string, emit emitFunc) func(extensions.ExtensionLog) error {
	return func(log extensions.ExtensionLog) error {
		emit(fmt.Sprintf("%s-log", name), log)
		return nil
	}
}

func registerGUI(ext *extensions.Runtime, emit emitFunc) error {
	ext.LuaState.Global("marasi")

	if ext.LuaState.IsNil(-1) {
		ext.LuaState.Pop(1)
		return errors.New("checking marasi global")
	}

	funcs := []lua.RegistryFunction{
		{
			Name: "render",
			Function: func(l *lua.State) int {
				target := lua.CheckString(l, 2)
				schema := extensions.ParseTable(l, 3, extensions.GoValue)

				emit("extension_gui_render", map[string]any{
					"extensionName": ext.Data.Name,
					"target":        target,
					"schema":        schema,
				})
				return 0
			},
		},
		{
			Name: "update",
			Function: func(l *lua.State) int {
				key := lua.CheckString(l, 2)
				value := extensions.GoValue(l, 3)

				emit("extension_state_update", map[string]any{
					"extensionName": ext.Data.Name,
					"key":           key,
					"value":         value,
				})
				return 0
			},
		},
	}

	lua.NewLibrary(ext.LuaState, funcs)

	ext.LuaState.PushString("marasi-app")
	ext.LuaState.SetField(-2, "type")

	ext.LuaState.SetField(-2, "gui")
	ext.LuaState.Pop(1)
	return nil
}

// attachExtensionHooks gives an extension the app's GUI library and live log
// events. The project lifecycle applies it to every extension it loads, before
// the extension's code runs. The hooks read a.emitEvent when they fire, so they
// reach the frontend once startup has set a.ctx.
func (a *App) attachExtensionHooks(ext *extensions.Runtime) error {
	emit := func(name string, data ...any) { a.emitEvent(name, data...) }
	ext.OnLog = extensionLogHandler(ext.Data.Name, emit)
	if err := registerGUI(ext, emit); err != nil {
		return fmt.Errorf("attaching hooks to %s : %w", ext.Data.Name, err)
	}
	return nil
}

func (a *App) LoadExtensions() error {
	runtime.EventsOff(a.ctx, "extension_sync_state")
	runtime.EventsOff(a.ctx, "extension_call_function")

	runtime.EventsOn(a.ctx, "extension_call_function", func(data ...any) {
		if payload, ok := data[0].(map[string]any); ok {
			idString, okID := payload["extensionID"].(string)
			function, okFunc := payload["function"].(string)
			state, okState := payload["state"].(map[string]any)

			if !okID || !okFunc || !okState {
				return
			}

			extID, err := uuid.Parse(idString)
			if err != nil {
				return
			}

			for _, ext := range a.Proxy.Extensions {
				if ext.Data.ID == extID {
					ext.CallFunction(function, state)
				}
			}
		}
	})

	runtime.EventsOn(a.ctx, "extension_sync_state", func(data ...any) {
		if payload, ok := data[0].(map[string]any); ok {
			idString, okID := payload["extensionID"].(string)

			if !okID {
				return
			}

			extID, err := uuid.Parse(idString)
			if err != nil {
				return
			}

			var args []any
			if rawArgs, ok := payload["args"].([]any); ok {
				args = rawArgs
			}

			for _, ext := range a.Proxy.Extensions {
				if ext.Data.ID == extID {
					ext.CallFunction("sync", args...)
				}
			}
		}
	})
	return nil
}

func (a *App) GetExtensions() []*domain.Extension {
	extensions := make([]*domain.Extension, 0, len(a.Proxy.Extensions))
	for _, ext := range a.Proxy.Extensions {
		data := ext.MetadataSnapshot()
		extensions = append(extensions, &data)
	}
	return extensions
}
