package main

import (
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestSaveFileAsWritesTheBytesWhereChosen(t *testing.T) {
	app := &App{}
	path := filepath.Join(t.TempDir(), "Report.md")
	var asked saveDialogOptions
	app.saveFileDialog = func(options saveDialogOptions) (string, error) {
		asked = options
		return path, nil
	}

	saved, err := app.SaveFileAs("Save Report", "Report.md", "Markdown (*.md)", "*.md", base64.StdEncoding.EncodeToString([]byte("# Report\n")))
	if err != nil || saved != path {
		t.Fatalf("wanted the file saved at %s, got %q %v", path, saved, err)
	}
	if asked.Title != "Save Report" || asked.DefaultFilename != "Report.md" {
		t.Fatalf("wanted the title and name suggested, got %+v", asked)
	}
	if len(asked.Filters) != 1 || asked.Filters[0] != (fileFilter{DisplayName: "Markdown (*.md)", Pattern: "*.md"}) {
		t.Fatalf("wanted the one filter, got %+v", asked.Filters)
	}
	written, err := os.ReadFile(path)
	if err != nil || string(written) != "# Report\n" {
		t.Fatalf("wanted the bytes in %s, got %q (%v)", path, written, err)
	}
}

func TestSaveFileAsSuggestsOnlyTheBaseNameAndNoFilterWithoutAPattern(t *testing.T) {
	app := &App{}
	var asked saveDialogOptions
	app.saveFileDialog = func(options saveDialogOptions) (string, error) {
		asked = options
		return "", nil
	}

	if _, err := app.SaveFileAs("Save Artifact", "../../etc/shot.png", "", "", ""); err != nil {
		t.Fatal(err)
	}
	if asked.DefaultFilename != "shot.png" || len(asked.Filters) != 0 {
		t.Fatalf("wanted shot.png and no filters, got %+v", asked)
	}
}

func TestSaveFileAsWritesNothingWhenCancelled(t *testing.T) {
	app := &App{}
	app.saveFileDialog = func(saveDialogOptions) (string, error) { return "", nil }
	wrote := false
	restore := replaceWriteSavedFile(func(string, []byte, os.FileMode) error { wrote = true; return nil })
	defer restore()

	saved, err := app.SaveFileAs("Save Report", "Report.md", "", "", base64.StdEncoding.EncodeToString([]byte("x")))
	if saved != "" || err != nil || wrote {
		t.Fatalf("wanted a cancel to write nothing, got %q %v wrote=%v", saved, err, wrote)
	}
}

func TestSaveFileAsRefusesBytesThatAreNotBase64BeforeAsking(t *testing.T) {
	app := &App{}
	asked := false
	app.saveFileDialog = func(saveDialogOptions) (string, error) { asked = true; return "/tmp/x", nil }

	if _, err := app.SaveFileAs("Save Report", "Report.md", "", "", "not base64!"); err == nil || asked {
		t.Fatalf("wanted a refusal before the dialog, got %v asked=%v", err, asked)
	}
}

func TestSaveFileAsReportsAFailedWrite(t *testing.T) {
	app := &App{}
	app.saveFileDialog = func(saveDialogOptions) (string, error) { return "/nowhere/Report.md", nil }
	restore := replaceWriteSavedFile(func(string, []byte, os.FileMode) error { return errors.New("disk full") })
	defer restore()

	if saved, err := app.SaveFileAs("Save Report", "Report.md", "", "", ""); saved != "" || err == nil {
		t.Fatalf("wanted the write error, got %q %v", saved, err)
	}
}

func TestOSUserNamePrefersTheFullName(t *testing.T) {
	cases := []struct {
		name, full, login, want string
		fails                   bool
	}{
		{name: "full name", full: "Ada Lovelace", login: "ada", want: "Ada Lovelace"},
		{name: "login only", login: "ada", want: "ada"},
		{name: "lookup fails", fails: true, want: "User"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			before := lookupOSUser
			defer func() { lookupOSUser = before }()
			lookupOSUser = func() (string, string, error) {
				if c.fails {
					return "", "", errors.New("no user")
				}
				return c.full, c.login, nil
			}
			if got := (&App{}).OSUserName(); got != c.want {
				t.Fatalf("wanted %q, got %q", c.want, got)
			}
		})
	}
}
