package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/zalando/go-keyring"
)

// Connection passwords (spec "Keychain"). A release build keeps them in the
// OS keychain; a development build, and a keychain that refuses (Linux
// without Secret Service), keeps them in passwordFileName, a 0600 file in
// the app config dir. App config holds only a reference: "keychain:<id>" or
// "file:<id>".

// keychainService is the keychain item's service name; the account is the
// connection id.
const keychainService = "Marasi"

// passwordFileName is the fallback file, a JSON map of id to password.
const passwordFileName = "marasi_app_passwords.json"

// keychain is the OS keychain, replaceable in tests. App.keychain is nil
// when the app doesn't use it (a development build).
type keychain struct {
	set    func(service, account, secret string) error
	get    func(service, account string) (string, error)
	remove func(service, account string) error
}

// osKeychain is the OS keychain through go-keyring: macOS Keychain, Windows
// Credential Manager, or Secret Service on Linux.
func osKeychain() *keychain {
	return &keychain{set: keyring.Set, get: keyring.Get, remove: keyring.Delete}
}

// releaseBuild reports whether this is a release or nightly build (signed;
// build_info.go), the builds that use the OS keychain.
func releaseBuild() bool {
	return Channel(buildChannel).valid()
}

// platformKeychain is the platform's own secure store where go-keyring
// has none: Android sets it (keychain_android.go). It never prompts, so
// every build uses it.
var platformKeychain func() *keychain

// useKeychainRuntime points App.keychain at the platform's secure store
// when it has one, else at the OS keychain on a release build. It leaves
// it nil on a desktop development build, which rebuilds too often for a
// keychain prompt each time.
func (a *App) useKeychainRuntime() {
	switch {
	case platformKeychain != nil:
		a.keychain = platformKeychain()
	case releaseBuild():
		a.keychain = osKeychain()
	}
}

const (
	keychainRefPrefix = "keychain:"
	fileRefPrefix     = "file:"
)

// storePassword saves `password` for the connection `id` and returns the
// reference app config keeps. Callers hold Config.mu.
func (a *App) storePassword(id, password string) (string, error) {
	if a.keychain != nil {
		err := a.keychain.set(keychainService, id, password)
		if err == nil {
			return keychainRefPrefix + id, nil
		}
		log.Printf("[!] the keychain refused the password for %s, keeping it in %s: %v", id, passwordFileName, err)
	}
	passwords, err := a.readPasswordFile()
	if err != nil {
		return "", err
	}
	passwords[id] = password
	if err := a.writePasswordFile(passwords); err != nil {
		return "", err
	}
	return fileRefPrefix + id, nil
}

// loadPassword reads the password `ref` points at; "" for no reference.
// Callers hold Config.mu.
func (a *App) loadPassword(ref string) (string, error) {
	switch {
	case ref == "":
		return "", nil
	case strings.HasPrefix(ref, keychainRefPrefix):
		if a.keychain == nil {
			return "", errors.New("the password is in the keychain, which a development build doesn't use")
		}
		return a.keychain.get(keychainService, strings.TrimPrefix(ref, keychainRefPrefix))
	case strings.HasPrefix(ref, fileRefPrefix):
		passwords, err := a.readPasswordFile()
		if err != nil {
			return "", err
		}
		password, ok := passwords[strings.TrimPrefix(ref, fileRefPrefix)]
		if !ok {
			return "", fmt.Errorf("no saved password in %s", passwordFileName)
		}
		return password, nil
	}
	return "", fmt.Errorf("unknown password reference %q", ref)
}

// forgetPassword removes the password `ref` points at. Callers hold
// Config.mu.
func (a *App) forgetPassword(ref string) error {
	switch {
	case strings.HasPrefix(ref, keychainRefPrefix):
		if a.keychain == nil {
			return nil
		}
		return a.keychain.remove(keychainService, strings.TrimPrefix(ref, keychainRefPrefix))
	case strings.HasPrefix(ref, fileRefPrefix):
		passwords, err := a.readPasswordFile()
		if err != nil {
			return err
		}
		delete(passwords, strings.TrimPrefix(ref, fileRefPrefix))
		return a.writePasswordFile(passwords)
	}
	return nil
}

func (a *App) passwordFilePath() string {
	return filepath.Join(a.Config.ConfigDir, passwordFileName)
}

func (a *App) readPasswordFile() (map[string]string, error) {
	passwords := map[string]string{}
	data, err := os.ReadFile(a.passwordFilePath())
	if errors.Is(err, os.ErrNotExist) {
		return passwords, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading %s: %w", passwordFileName, err)
	}
	if err := json.Unmarshal(data, &passwords); err != nil {
		return nil, fmt.Errorf("reading %s: %w", passwordFileName, err)
	}
	return passwords, nil
}

// writePasswordFile writes the file atomically, readable by the user only.
func (a *App) writePasswordFile(passwords map[string]string) error {
	data, err := json.MarshalIndent(passwords, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(a.Config.ConfigDir, passwordFileName+".*")
	if err != nil {
		return fmt.Errorf("writing %s: %w", passwordFileName, err)
	}
	defer os.Remove(tmp.Name())
	if err := tmp.Chmod(0600); err != nil {
		tmp.Close()
		return fmt.Errorf("writing %s: %w", passwordFileName, err)
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return fmt.Errorf("writing %s: %w", passwordFileName, err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return fmt.Errorf("writing %s: %w", passwordFileName, err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("writing %s: %w", passwordFileName, err)
	}
	if err := os.Rename(tmp.Name(), a.passwordFilePath()); err != nil {
		return fmt.Errorf("writing %s: %w", passwordFileName, err)
	}
	return nil
}
