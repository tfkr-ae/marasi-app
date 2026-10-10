package main

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

// Go-side validation of keybinding profiles. The catalog (action ids, menu
// contexts, factory defaults) is owned by the frontend and sent with each
// save; this file mirrors the rules of frontend/src/lib/keybindings
// (keys.js normalizeBinding, gate.js isReservedBinding, keymap.js
// resolution, profiles.js validation). Keep them in step.

const openMenuAction = "global.open-menu"

// globalContext is eligible in every app state, so a binding there overlaps
// every other context.
const globalContext = "global"

var (
	actionIDPattern  = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$`)
	profileIDPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)
)

// Canonical binding text: modifiers in the order meta, ctrl, alt, shift, then
// the lowercase key, joined by "+". Mirrors normalizeBinding in keys.js.
var bindingModifiers = []string{"meta", "ctrl", "alt", "shift"}

var modifierAliases = map[string]string{
	"meta": "meta", "cmd": "meta", "command": "meta", "⌘": "meta",
	"ctrl": "ctrl", "control": "ctrl", "⌃": "ctrl",
	"alt": "alt", "option": "alt", "⌥": "alt",
	"shift": "shift", "⇧": "shift",
}

var keyAliases = map[string]string{
	"↩": "enter", "return": "enter", "esc": "escape",
	"up": "arrowup", "down": "arrowdown", "left": "arrowleft", "right": "arrowright",
	" ": "space", "+": "plus",
}

var namedKeys = func() map[string]bool {
	keys := map[string]bool{}
	for _, key := range []string{"enter", "escape", "tab", "space", "plus", "backspace", "delete", "insert",
		"home", "end", "pageup", "pagedown", "arrowup", "arrowdown", "arrowleft", "arrowright"} {
		keys[key] = true
	}
	for i := 1; i <= 24; i++ {
		keys[fmt.Sprintf("f%d", i)] = true
	}
	return keys
}()

// canonicalBinding returns the canonical form of a binding, or "" when the
// text is not exactly one key plus known modifiers.
func canonicalBinding(text string) string {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return ""
	}
	var tokens []string
	switch {
	case strings.HasSuffix(trimmed, "++"):
		tokens = append(strings.Split(trimmed[:len(trimmed)-2], "+"), "+")
	case trimmed == "+":
		tokens = []string{"+"}
	default:
		tokens = strings.Split(trimmed, "+")
	}
	keyToken := strings.TrimSpace(tokens[len(tokens)-1])
	held := map[string]bool{}
	for _, token := range tokens[:len(tokens)-1] {
		modifier, ok := modifierAliases[strings.ToLower(strings.TrimSpace(token))]
		if !ok {
			return ""
		}
		held[modifier] = true
	}
	if keyToken == "" {
		return ""
	}
	if _, isModifier := modifierAliases[strings.ToLower(keyToken)]; isModifier {
		return ""
	}
	key := canonicalKey(keyToken)
	if key == "" {
		return ""
	}
	parts := []string{}
	for _, modifier := range bindingModifiers {
		if held[modifier] {
			parts = append(parts, modifier)
		}
	}
	return strings.Join(append(parts, key), "+")
}

func canonicalKey(token string) string {
	lower := strings.ToLower(token)
	if alias, ok := keyAliases[token]; ok {
		return alias
	}
	if alias, ok := keyAliases[lower]; ok {
		return alias
	}
	if utf8.RuneCountInString(token) == 1 {
		return lower
	}
	if namedKeys[lower] {
		return lower
	}
	return ""
}

// isReservedBinding mirrors gate.js: Escape, Tab and Enter with no modifier
// other than Shift belong to dialogs and focus traversal.
func isReservedBinding(binding string) bool {
	switch strings.TrimPrefix(binding, "shift+") {
	case "escape", "tab", "enter":
		return true
	}
	return false
}

// keybindingCatalog indexes the catalog sent by the frontend.
type keybindingCatalog struct {
	actions []KeybindingAction
	byID    map[string]KeybindingAction
}

func newKeybindingCatalog(actions []KeybindingAction) (keybindingCatalog, error) {
	catalog := keybindingCatalog{actions: actions, byID: map[string]KeybindingAction{}}
	for _, action := range actions {
		if !actionIDPattern.MatchString(action.ID) || action.Context == "" {
			return catalog, fmt.Errorf("invalid catalog action %q", action.ID)
		}
		if _, ok := catalog.byID[action.ID]; ok {
			return catalog, fmt.Errorf("duplicate catalog action %q", action.ID)
		}
		catalog.byID[action.ID] = action
	}
	if _, ok := catalog.byID[openMenuAction]; !ok {
		return catalog, fmt.Errorf("catalog has no %s action", openMenuAction)
	}
	return catalog, nil
}

// checkKeybindingStructure validates the section without a catalog. It is
// used for the saved section on load and before every save.
func checkKeybindingStructure(config KeybindingConfig) error {
	if config.Version != keybindingsVersion {
		if config.Version > keybindingsVersion {
			return fmt.Errorf("keybindings version %d is not supported (this Marasi reads version %d)", config.Version, keybindingsVersion)
		}
		return fmt.Errorf("keybindings version %d is invalid", config.Version)
	}
	if len(config.Profiles) == 0 {
		return errors.New("keybindings have no profiles")
	}
	ids := map[string]bool{}
	names := map[string]bool{}
	for _, profile := range config.Profiles {
		if !profileIDPattern.MatchString(profile.ID) {
			return fmt.Errorf("profile id %q is invalid", profile.ID)
		}
		if ids[profile.ID] {
			return fmt.Errorf("profile id %q is used twice", profile.ID)
		}
		ids[profile.ID] = true
		name := strings.ToLower(strings.TrimSpace(profile.Name))
		if name == "" {
			return fmt.Errorf("profile %q has no name", profile.ID)
		}
		if names[name] {
			return fmt.Errorf("profile name %q is used twice", strings.TrimSpace(profile.Name))
		}
		names[name] = true
		for platform, overrides := range profile.Overrides {
			if platform != platformMacOS && platform != platformWindowsLinux {
				return fmt.Errorf("profile %q has unknown platform %q", profile.Name, platform)
			}
			actions := map[string]bool{}
			for _, override := range overrides {
				where := fmt.Sprintf("profile %q (%s) action %q", profile.Name, platform, override.Action)
				if !actionIDPattern.MatchString(override.Action) {
					return fmt.Errorf("%s: invalid action id", where)
				}
				if actions[override.Action] {
					return fmt.Errorf("%s: overridden twice", where)
				}
				actions[override.Action] = true
				if override.Keys == nil {
					return fmt.Errorf("%s: missing keys (use [] to unbind)", where)
				}
				for _, key := range override.Keys {
					binding := canonicalBinding(key)
					if binding == "" {
						return fmt.Errorf("%s: %q is not a binding", where, key)
					}
					if isReservedBinding(binding) {
						return fmt.Errorf("%s: %q is reserved for dialogs and focus", where, key)
					}
				}
			}
		}
	}
	if !ids[config.ActiveProfile] {
		return fmt.Errorf("active profile %q does not exist", config.ActiveProfile)
	}
	return nil
}

// resolveVariant returns each catalog action's bindings in one platform
// variant: the override when present, otherwise the factory defaults.
// Overrides for actions missing from the catalog are dormant and ignored.
func resolveVariant(catalog keybindingCatalog, platform string, overrides []KeybindingOverride) map[string][]string {
	overridden := map[string][]string{}
	for _, override := range overrides {
		overridden[override.Action] = override.Keys
	}
	resolved := map[string][]string{}
	for _, action := range catalog.actions {
		source, ok := overridden[action.ID]
		if !ok {
			source = action.Defaults[platform]
		}
		resolved[action.ID] = canonicalBindings(source)
	}
	return resolved
}

func canonicalBindings(keys []string) []string {
	bindings := []string{}
	seen := map[string]bool{}
	for _, key := range keys {
		if binding := canonicalBinding(key); binding != "" && !seen[binding] {
			seen[binding] = true
			bindings = append(bindings, binding)
		}
	}
	return bindings
}

// validateKeybindings checks the whole section: its structure, then every
// profile and platform variant against the catalog.
func validateKeybindings(config KeybindingConfig, actions []KeybindingAction) error {
	if err := checkKeybindingStructure(config); err != nil {
		return err
	}
	catalog, err := newKeybindingCatalog(actions)
	if err != nil {
		return err
	}
	var problems []error
	for _, profile := range config.Profiles {
		for _, platform := range keybindingPlatforms {
			resolved := resolveVariant(catalog, platform, profile.Overrides[platform])
			for _, problem := range variantProblems(catalog, resolved) {
				problems = append(problems, fmt.Errorf("profile %q (%s): %s", profile.Name, platform, problem))
			}
		}
	}
	return errors.Join(problems...)
}

// variantProblems: the menu opening must be bound, no other action may share
// one of its bindings (same context is a duplicate, any other context
// shadows it, because global is always eligible), and no two actions in the
// same context may share a binding.
func variantProblems(catalog keybindingCatalog, resolved map[string][]string) []string {
	var problems []string
	if len(resolved[openMenuAction]) == 0 {
		problems = append(problems, fmt.Sprintf("menu opening (%s) is unbound", openMenuAction))
	}
	owners := map[string][]KeybindingAction{}
	for _, action := range catalog.actions {
		for _, binding := range resolved[action.ID] {
			owners[binding] = append(owners[binding], action)
		}
	}
	for _, action := range catalog.actions {
		for _, binding := range resolved[action.ID] {
			for _, other := range owners[binding] {
				if other.ID == action.ID {
					break // report each pair once, in catalog order
				}
				switch {
				case other.Context == action.Context:
					problems = append(problems, fmt.Sprintf("%s is bound to both %s and %s in context %s", binding, other.ID, action.ID, action.Context))
				case other.ID == openMenuAction || action.ID == openMenuAction:
					problems = append(problems, fmt.Sprintf("%s opens the menu but %s shadows it", binding, nonMenu(other, action).ID))
				}
			}
		}
	}
	return problems
}

func nonMenu(a, b KeybindingAction) KeybindingAction {
	if a.ID == openMenuAction {
		return b
	}
	return a
}
