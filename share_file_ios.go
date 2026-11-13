//go:build ios

package main

// #cgo CFLAGS: -x objective-c -fobjc-arc
// #cgo LDFLAGS: -framework UIKit
// #include <stdlib.h>
// void marasiShareFile(unsigned int id, const char *path);
import "C"

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"unsafe"
)

// iOS has no save dialog (Wails' returns an error), so a Save As hands the
// file to the share sheet: Save to Files, AirDrop, Mail.
func init() { platformShareFile = shareFile }

var (
	shareLock    sync.Mutex
	shareNext    uint
	shareResults = map[uint]chan bool{}
)

// shareFile writes data to a temporary file named name, shows the share
// sheet for it and waits for the researcher. It returns name when the file
// went somewhere, "" when they cancelled.
func shareFile(name string, data []byte) (string, error) {
	dir, err := os.MkdirTemp("", "marasi-share-")
	if err != nil {
		return "", fmt.Errorf("sharing %s: %w", name, err)
	}
	defer os.RemoveAll(dir)
	path := filepath.Join(dir, filepath.Base(name))
	if err := os.WriteFile(path, data, 0600); err != nil {
		return "", fmt.Errorf("sharing %s: %w", name, err)
	}

	done := make(chan bool, 1)
	shareLock.Lock()
	shareNext++
	id := shareNext
	shareResults[id] = done
	shareLock.Unlock()

	cpath := C.CString(path)
	defer C.free(unsafe.Pointer(cpath))
	C.marasiShareFile(C.uint(id), cpath)
	if !<-done {
		return "", nil
	}
	return filepath.Base(name), nil
}

// marasiShareFileDone receives whether the share sheet sent the file.
//
//export marasiShareFileDone
func marasiShareFileDone(id C.uint, completed C.int) {
	shareLock.Lock()
	done, ok := shareResults[uint(id)]
	delete(shareResults, uint(id))
	shareLock.Unlock()
	if ok {
		done <- completed != 0
	}
}
