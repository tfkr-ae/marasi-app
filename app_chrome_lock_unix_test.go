//go:build unix

package main

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

// Marasi's CLI and service instances hold marasi_config.lock with flock, so
// the test holds it the same way.
func TestAppChromeSettingsTakeTheMarasiConfigLock(t *testing.T) {
	t.Run("should wait for the Marasi config lock before rereading and writing", func(t *testing.T) {
		app := newTestApp(t)
		writeMarasiConfig(t, app, "chrome_profiles:\n    - work\n")
		held, err := os.OpenFile(filepath.Join(app.marasiConfigDir, "marasi_config.lock"), os.O_RDWR|os.O_CREATE, 0600)
		if err != nil {
			t.Fatal(err)
		}
		defer held.Close()
		if err := unix.Flock(int(held.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
			t.Fatalf("holding the lock: %v", err)
		}
		done := make(chan []string)
		go func() {
			profiles, _ := app.AddChromeProfile("client")
			done <- profiles
		}()
		time.Sleep(150 * time.Millisecond)
		select {
		case profiles := <-done:
			t.Fatalf("wanted: the add to wait for the lock\ngot: %v", profiles)
		default:
		}
		// Another Marasi process changes the file while it holds the lock.
		writeMarasiConfig(t, app, "chrome_profiles:\n    - work\n    - cli\n")
		if err := unix.Flock(int(held.Fd()), unix.LOCK_UN); err != nil {
			t.Fatal(err)
		}
		select {
		case profiles := <-done:
			if !reflect.DeepEqual(profiles, []string{"work", "cli", "client"}) {
				t.Fatalf("wanted: [work cli client] after rereading\ngot: %v", profiles)
			}
		case <-time.After(5 * time.Second):
			t.Fatal("wanted: the add to finish once the lock was released")
		}
	})
}
