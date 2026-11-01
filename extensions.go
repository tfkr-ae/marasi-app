package main

import (
	"errors"
	"fmt"

	"github.com/Shopify/go-lua"
	"github.com/google/uuid"
	"github.com/tfkr-ae/marasi/domain"
	"github.com/tfkr-ae/marasi/extensions"
)

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
// reach the frontend once main has set a.wails.
func (a *App) attachExtensionHooks(ext *extensions.Runtime) error {
	emit := func(name string, data ...any) { a.emitEvent(name, data...) }
	ext.OnLog = extensionLogHandler(ext.Data.Name, emit)
	if err := registerGUI(ext, emit); err != nil {
		return fmt.Errorf("attaching hooks to %s : %w", ext.Data.Name, err)
	}
	return nil
}

// LoadExtensions does not load extensions: the project lifecycle does that
// when a project opens. It sets the listeners for the two events extension
// UIs send, extension_call_function and extension_sync_state, which call
// into the open project's extensions. The frontend calls it after each open.
func (a *App) LoadExtensions() error {
	a.onEvent("extension_call_function", func(payload any) {
		if call, ok := decodeExtensionFunctionCall(payload); ok {
			a.callExtension(call)
		}
	})
	a.onEvent("extension_sync_state", func(payload any) {
		if call, ok := decodeExtensionSync(payload); ok {
			a.callExtension(call)
		}
	})
	return nil
}

// extensionCall is a call an extension UI asked for: function on the
// extension with extensionID, with args.
type extensionCall struct {
	extensionID uuid.UUID
	function    string
	args        []any
}

// decodeExtensionFunctionCall reads an extension_call_function payload,
// {extensionID, function, state}, as a call of function with state. It is
// false for a payload missing any of them.
func decodeExtensionFunctionCall(payload any) (extensionCall, bool) {
	fields, ok := payload.(map[string]any)
	if !ok {
		return extensionCall{}, false
	}
	id, okID := extensionID(fields)
	function, okFunc := fields["function"].(string)
	state, okState := fields["state"].(map[string]any)
	if !okID || !okFunc || !okState {
		return extensionCall{}, false
	}
	return extensionCall{extensionID: id, function: function, args: []any{state}}, true
}

// decodeExtensionSync reads an extension_sync_state payload,
// {extensionID, args}, as a call of sync with args, none when args is
// absent. It is false for a payload without a valid extensionID.
func decodeExtensionSync(payload any) (extensionCall, bool) {
	fields, ok := payload.(map[string]any)
	if !ok {
		return extensionCall{}, false
	}
	id, ok := extensionID(fields)
	if !ok {
		return extensionCall{}, false
	}
	args, _ := fields["args"].([]any)
	return extensionCall{extensionID: id, function: "sync", args: args}, true
}

func extensionID(fields map[string]any) (uuid.UUID, bool) {
	idString, ok := fields["extensionID"].(string)
	if !ok {
		return uuid.UUID{}, false
	}
	id, err := uuid.Parse(idString)
	return id, err == nil
}

// callExtension runs call on the open project's extension it names.
func (a *App) callExtension(call extensionCall) {
	for _, ext := range a.Proxy.Extensions {
		if ext.Data.ID == call.extensionID {
			ext.CallFunction(call.function, call.args...)
		}
	}
}

func (a *App) GetExtensions() []*domain.Extension {
	extensions := make([]*domain.Extension, 0, len(a.Proxy.Extensions))
	for _, ext := range a.Proxy.Extensions {
		data := ext.MetadataSnapshot()
		extensions = append(extensions, &data)
	}
	return extensions
}
