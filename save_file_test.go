package main

import (
	"encoding/base64"
	"errors"
	"path/filepath"
	"testing"
)

// SaveFileAs writes bytes the frontend fetched from the service (the proxy
// certificate, a report, an artifact) where the user chooses.

// recordedWrites replaces writeSavedFile for the test and records each write.
func recordedWrites(t *testing.T) map[string][]byte {
	t.Helper()
	writes := map[string][]byte{}
	previous := writeSavedFile
	writeSavedFile = func(path string, data []byte) error {
		writes[path] = data
		return nil
	}
	t.Cleanup(func() { writeSavedFile = previous })
	return writes
}

func TestSaveFileAsWritesTheBytesWhereChosen(t *testing.T) {
	app := &App{}
	writes := recordedWrites(t)
	path := filepath.Join(t.TempDir(), "marasi-proxy.crt")
	var asked saveDialogOptions
	app.saveFileDialog = func(options saveDialogOptions) (string, error) {
		asked = options
		return path, nil
	}
	pem := "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n"

	saved, err := app.SaveFileAs("Save Proxy Certificate", "marasi-proxy.crt", "Certificate Files (*.crt)", "*.crt", base64.StdEncoding.EncodeToString([]byte(pem)))
	if err != nil || saved != path {
		t.Fatalf("wanted %s saved, got %q (%v)", path, saved, err)
	}
	if string(writes[path]) != pem {
		t.Fatalf("wanted the PEM written to %s, got %q", path, writes[path])
	}
	if asked.Title != "Save Proxy Certificate" || asked.DefaultFilename != "marasi-proxy.crt" {
		t.Fatalf("wanted the title and name suggested, got %+v", asked)
	}
	if len(asked.Filters) != 2 || asked.Filters[0] != (fileFilter{DisplayName: "Certificate Files (*.crt)", Pattern: "*.crt"}) || asked.Filters[1].Pattern != "*.*" {
		t.Fatalf("wanted the named filter then All Files, got %+v", asked.Filters)
	}
}

func TestSaveFileAsWritesNothingWhenCancelled(t *testing.T) {
	app := &App{}
	writes := recordedWrites(t)
	app.saveFileDialog = func(saveDialogOptions) (string, error) { return "", nil }

	saved, err := app.SaveFileAs("Save", "a.txt", "Text", "*.txt", base64.StdEncoding.EncodeToString([]byte("x")))
	if err != nil || saved != "" || len(writes) != 0 {
		t.Fatalf("wanted a quiet cancel, got %q %v %v", saved, err, writes)
	}
}

func TestSaveFileAsRefusesBytesThatAreNotBase64BeforeAsking(t *testing.T) {
	app := &App{}
	writes := recordedWrites(t)
	app.saveFileDialog = func(saveDialogOptions) (string, error) {
		t.Fatal("wanted no dialog for bad content")
		return "", nil
	}

	if _, err := app.SaveFileAs("Save", "a.txt", "", "", "not base64!"); err == nil || len(writes) != 0 {
		t.Fatalf("wanted a refusal and nothing written, got %v %v", err, writes)
	}
}

func TestSaveFileAsReportsAFailedWrite(t *testing.T) {
	app := &App{}
	previous := writeSavedFile
	writeSavedFile = func(string, []byte) error { return errors.New("disk full") }
	t.Cleanup(func() { writeSavedFile = previous })
	app.saveFileDialog = func(saveDialogOptions) (string, error) { return "/tmp/x", nil }

	if saved, err := app.SaveFileAs("Save", "x", "", "", ""); err == nil || saved != "" {
		t.Fatalf("wanted the write's error, got %q %v", saved, err)
	}
}

func TestCopyingTheCertificatePutsTheServicePEMOnTheClipboard(t *testing.T) {
	app := &App{}
	var copied []string
	app.setClipboardText = func(text string) error {
		copied = append(copied, text)
		return nil
	}
	pem := "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n"

	if ok, err := app.CopyCertToClipboard(pem); !ok || err != nil {
		t.Fatalf("wanted the certificate copied, got %v %v", ok, err)
	}
	if len(copied) != 1 || copied[0] != pem {
		t.Fatalf("wanted the PEM copied once, got %q", copied)
	}
	if ok, err := app.CopyCertToClipboard(""); ok || err == nil || len(copied) != 1 {
		t.Fatalf("wanted an empty certificate refused, got %v %v", ok, err)
	}
}
