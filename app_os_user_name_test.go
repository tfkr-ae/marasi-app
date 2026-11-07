package main

import (
	"errors"
	"testing"
)

func TestSaveFileAsSuggestsOnlyTheBaseName(t *testing.T) {
	app := &App{}
	var asked saveDialogOptions
	app.saveFileDialog = func(options saveDialogOptions) (string, error) {
		asked = options
		return "", nil
	}

	if _, err := app.SaveFileAs("Save Artifact", "../../etc/shot.png", "", "", ""); err != nil {
		t.Fatal(err)
	}
	if asked.DefaultFilename != "shot.png" {
		t.Fatalf("wanted shot.png suggested, got %+v", asked)
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
