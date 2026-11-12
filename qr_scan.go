package main

import (
	"errors"
	"sync"
)

// The pairing QR scanner, for the iOS app, which can't run the Marasi CLI
// and pairs with a remote instead. The camera preview is a native view laid
// over a box the page keeps for it (qr_scan_ios.m); its decoded text comes
// back as a qrScanEvent. These bindings exist on every platform so the
// generated bindings always carry them; only iOS has a camera to open.

// The events the scanner sends: the decoded text of the first QR code it
// sees, then it stops; or why it couldn't scan ("camera-denied",
// "no-camera" or "camera-failed").
const (
	qrScanEvent      = "qr-scan.result"
	qrScanErrorEvent = "qr-scan.error"
)

// QRScanRect is where the preview goes, in the web view's CSS pixels, which
// are the screen's points: the iOS web view fills the screen from its top left.
type QRScanRect struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

var errQRScanUnsupported = errors.New("scanning a QR code needs the iOS app")

// qrScanApp is the app whose frontend gets the scanner's events: the native
// side calls back into Go without one.
var (
	qrScanMu  sync.Mutex
	qrScanApp *App
)

// StartQRScan opens the camera and shows its preview over rect, asking for
// camera access first when iOS hasn't yet.
func (a *App) StartQRScan(rect QRScanRect) error {
	qrScanMu.Lock()
	qrScanApp = a
	qrScanMu.Unlock()
	return qrScanStart(rect)
}

// MoveQRScan moves the preview, after the page's layout changed (a fold,
// a rotation).
func (a *App) MoveQRScan(rect QRScanRect) error {
	return qrScanMove(rect)
}

// StopQRScan closes the camera and removes the preview.
func (a *App) StopQRScan() error {
	return qrScanStop()
}

// emitQRScan sends a scanner event to the app that started the scan.
func emitQRScan(name string, data any) {
	qrScanMu.Lock()
	app := qrScanApp
	qrScanMu.Unlock()
	if app != nil && app.emitEvent != nil {
		app.emitEvent(name, data)
	}
}
