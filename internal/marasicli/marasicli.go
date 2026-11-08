// Package marasicli holds what the app and its build tooling (cmd/carry-cli)
// both need to fetch and verify the Marasi CLI from Marasi's releases.
package marasicli

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

// PublicKey is the minisign public key Marasi signs its releases'
// checksums.txt with (Marasi's
// docs/adr/2026-10-18-updates-are-signed-with-an-embedded-key.md, its
// MARASI_SIGNING_PUBLIC_KEY repository variable).
const PublicKey = "RWTKYt9SjZnVCHRuMsvU26+0Gh9A6/hGeLTU7Mn2ToTZ4oJ5dw3jIXsR"

// ReleaseSource is the GitHub releases API of the Marasi repository, which
// publishes the CLI builds.
const ReleaseSource = "https://api.github.com/repos/tfkr-ae/marasi"

// Assets is the release asset of the CLI for each GOOS/GOARCH Marasi
// publishes (Marasi's release.yml and nightly.yml).
var Assets = map[string]string{
	"darwin/arm64":  "marasi-darwin-arm64",
	"linux/amd64":   "marasi-linux-amd64",
	"windows/amd64": "marasi-windows-amd64.exe",
}

// TrustedComment is the trusted comment checksums.txt.minisig must carry for
// the CLI release version on channel ("release" or "nightly").
func TrustedComment(channel, version string) string {
	return "marasi " + channel + " " + version
}

// Release is the part of a GitHub release (the releases API's JSON) the app
// and cmd/carry-cli read.
type Release struct {
	TagName    string  `json:"tag_name"`
	Name       string  `json:"name"`
	Body       string  `json:"body"`
	HTMLURL    string  `json:"html_url"`
	Prerelease bool    `json:"prerelease"`
	Assets     []Asset `json:"assets"`
}

// Asset is a file attached to a Release.
type Asset struct {
	Name string `json:"name"`
	Size int64  `json:"size"`
	URL  string `json:"browser_download_url"`
}

// SignatureComment is the trusted comment of a minisign signature file, ""
// when it has none.
func SignatureComment(signature []byte) string {
	scanner := bufio.NewScanner(bytes.NewReader(signature))
	for scanner.Scan() {
		if comment, ok := strings.CutPrefix(scanner.Text(), "trusted comment: "); ok {
			return strings.TrimSpace(comment)
		}
	}
	return ""
}

// ParseChecksums reads sha256sum output, "<64 hex>  <name>" per line with
// "*<name>" in binary mode, as lowercase hex by name. Lines that are not a
// checksum are skipped.
func ParseChecksums(checksums []byte) map[string]string {
	sums := map[string]string{}
	scanner := bufio.NewScanner(bytes.NewReader(checksums))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) != 2 {
			continue
		}
		sum := strings.ToLower(fields[0])
		if decoded, err := hex.DecodeString(sum); err != nil || len(decoded) != sha256.Size {
			continue
		}
		sums[strings.TrimPrefix(fields[1], "*")] = sum
	}
	return sums
}
