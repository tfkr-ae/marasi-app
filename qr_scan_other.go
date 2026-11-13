//go:build !ios

package main

// Only the iOS app scans; the desktop app pairs by pasting the payload.

func qrScanStart(QRScanRect) error { return errQRScanUnsupported }
func qrScanMove(QRScanRect) error  { return errQRScanUnsupported }
func qrScanStop() error            { return nil }
