//go:build ios

package main

// Compiles scene_delegate_ios.m into the iOS archive; see that file.

// #cgo CFLAGS: -x objective-c -fobjc-arc
// #cgo LDFLAGS: -framework UIKit
import "C"
