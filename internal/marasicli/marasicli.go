// Package marasicli holds what the app and its build tooling (cmd/carry-cli)
// both need to fetch and verify the Marasi CLI from Marasi's releases.
package marasicli

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
