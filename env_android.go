package main

/*
#cgo LDFLAGS: -llog
#include <android/log.h>
#include <stdlib.h>
static void marasiLog(const char *msg) { __android_log_write(ANDROID_LOG_INFO, "Marasi", msg); }
*/
import "C"

import (
	"log"
	"os"
	"strings"
	"unsafe"
)

// logcat writes the log package's lines to Android's log, under the tag
// Marasi: Go's stderr goes nowhere on Android, so a log.Fatal would
// otherwise leave only "process died".
type logcat struct{}

func (logcat) Write(p []byte) (int, error) {
	c := C.CString(string(p))
	defer C.free(unsafe.Pointer(c))
	C.marasiLog(c)
	return len(p), nil
}

// An Android app process starts with no $HOME, so os.UserConfigDir fails
// and NewApp can't find its settings. HOME becomes the app's private files
// directory, read from the process's own package name, before main runs.
func init() {
	log.SetOutput(logcat{})
	log.SetFlags(0)
	if os.Getenv("HOME") != "" {
		return
	}
	cmdline, err := os.ReadFile("/proc/self/cmdline")
	if err != nil {
		log.Printf("finding the app's files directory: %v", err)
		return
	}
	pkg := strings.SplitN(strings.TrimRight(string(cmdline), "\x00"), "\x00", 2)[0]
	pkg = strings.SplitN(pkg, ":", 2)[0]
	_ = os.Setenv("HOME", "/data/user/0/"+pkg+"/files")
}
