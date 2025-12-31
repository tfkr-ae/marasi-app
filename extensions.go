package main

import (
	"errors"
	"fmt"

	"github.com/Shopify/go-lua"
	"github.com/google/uuid"
	"github.com/tfkr-ae/marasi"
	"github.com/tfkr-ae/marasi/domain"
	"github.com/tfkr-ae/marasi/extensions"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func (a *App) withExtLogHandler() func(*extensions.Runtime) error {
	return func(ext *extensions.Runtime) error {
		extensions.ExtensionWithLogHandler(func(log extensions.ExtensionLog) error {
			runtime.EventsEmit(a.ctx, fmt.Sprintf("%s-log", ext.Data.Name), log)
			return nil
		})
		return nil
	}
}

func (a *App) withGUILoader() func(*extensions.Runtime) error {
	return func(ext *extensions.Runtime) error {
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

					runtime.EventsEmit(a.ctx, "extension_gui_render", map[string]any{
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

					runtime.EventsEmit(a.ctx, "extension_state_update", map[string]any{
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
}

func (a *App) LoadExtensions() error {
	exts, err := a.Proxy.ExtensionRepo.GetExtensions()
	if err != nil {
		return fmt.Errorf("getting extensions : %w", err)
	}

	err = a.Proxy.WithOptions(
		marasi.WithExtensions(
			exts,
			a.withExtLogHandler(),
			a.withGUILoader(),
		),
	)
	if err != nil {
		return fmt.Errorf("proxy with extensions: %w", err)
	}
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
		extensions = append(extensions, ext.Data)
	}
	return extensions
}
