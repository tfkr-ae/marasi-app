package main

// platformShareFile replaces the save dialog where there is none: iOS sets
// it to the share sheet (share_file_ios.go). Elsewhere it is nil, and a Save
// As shows the save dialog.
var platformShareFile func(name string, data []byte) (string, error)
