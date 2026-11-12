//go:build ios

package main

// #cgo CFLAGS: -x objective-c -fobjc-arc
// #cgo LDFLAGS: -framework AVFoundation -framework Vision -framework CoreImage -framework UIKit
// void marasiQRStart(double x, double y, double width, double height);
// void marasiQRMove(double x, double y, double width, double height);
// void marasiQRStop(void);
import "C"

func qrScanStart(r QRScanRect) error {
	C.marasiQRStart(C.double(r.X), C.double(r.Y), C.double(r.Width), C.double(r.Height))
	return nil
}

func qrScanMove(r QRScanRect) error {
	C.marasiQRMove(C.double(r.X), C.double(r.Y), C.double(r.Width), C.double(r.Height))
	return nil
}

func qrScanStop() error {
	C.marasiQRStop()
	return nil
}

// marasiQRScanned receives the text of the QR code the camera read.
//
//export marasiQRScanned
func marasiQRScanned(text *C.char) {
	emitQRScan(qrScanEvent, C.GoString(text))
}

// marasiQRFailed receives why the scanner couldn't run.
//
//export marasiQRFailed
func marasiQRFailed(reason *C.char) {
	emitQRScan(qrScanErrorEvent, C.GoString(reason))
}
