package main

import (
	"testing"

	"github.com/tfkr-ae/marasi/domain"
)

func TestAppExtensions(t *testing.T) {
	t.Run("should list saved code after running an extension", func(t *testing.T) {
		app := newScratchpadApp(t)
		code := `print("saved")`
		if err := app.RunExtension("workshop", code); err != nil {
			t.Fatalf("running workshop: %v", err)
		}
		workshop := findExtension(t, app.GetExtensions(), "workshop")
		if workshop.LuaContent != code {
			t.Fatalf("wanted: %q\ngot: %q", code, workshop.LuaContent)
		}
	})

	t.Run("should list saved code after running the workshop", func(t *testing.T) {
		app := newScratchpadApp(t)
		code := `print("workshop")`
		app.DoExtender(code)
		workshop := findExtension(t, app.GetExtensions(), "workshop")
		if workshop.LuaContent != code {
			t.Fatalf("wanted: %q\ngot: %q", code, workshop.LuaContent)
		}
	})
}

func findExtension(t *testing.T, extensions []*domain.Extension, name string) *domain.Extension {
	t.Helper()
	for _, extension := range extensions {
		if extension.Name == name {
			return extension
		}
	}
	t.Fatalf("extension %s not listed", name)
	return nil
}
