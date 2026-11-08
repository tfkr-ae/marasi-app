// Command carry-cli fetches the Marasi CLI a release or nightly build of the
// app carries (ADR "The app carries a compressed CLI it installs once"). It
// reads the latest CLI release on the channel, verifies checksums.txt.minisig
// with the key the app trusts and a trusted comment of exactly
// "marasi <channel> <version>", checks the build's SHA-256, and writes the
// build gzipped to <out>/marasi.gz with its record in <out>/carried.json,
// which the carried_cli build tag embeds (cli_carried_embed.go). Any failure
// exits non-zero and leaves no <out>, so the app build fails.
//
//	go run ./cmd/carry-cli -channel nightly -platform darwin/arm64 -out carried_cli
//
// GH_TOKEN, when set, authenticates the GitHub API requests.
package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"aead.dev/minisign"

	"github.com/tfkr-ae/marasi-app/internal/marasicli"
)

// buildLimit caps the CLI build; smallLimit caps checksums.txt and its
// signature.
const (
	buildLimit = 512 << 20
	smallLimit = 64 << 10
)

type carryOptions struct {
	// channel is release or nightly.
	channel string
	// platform is GOOS/GOARCH.
	platform string
	// key is the minisign public key.
	key string
	// source is the GitHub releases API of the Marasi repository.
	source string
	// out is the folder to write; it must not exist.
	out    string
	token  string
	client *http.Client
}

func main() {
	opts := carryOptions{
		key:    marasicli.PublicKey,
		source: marasicli.ReleaseSource,
		token:  os.Getenv("GH_TOKEN"),
		client: &http.Client{Timeout: 10 * time.Minute},
	}
	flag.StringVar(&opts.channel, "channel", "", "the app's channel: release or nightly")
	flag.StringVar(&opts.platform, "platform", runtime.GOOS+"/"+runtime.GOARCH, "the platform to carry the CLI for, as GOOS/GOARCH")
	flag.StringVar(&opts.out, "out", "carried_cli", "the folder to write marasi.gz and carried.json to")
	flag.Parse()
	if err := carry(context.Background(), opts); err != nil {
		log.Fatalf("carry-cli: %v", err)
	}
}

// record is carried.json, which the app reads as its carriedCLI.
type record struct {
	Version string `json:"version"`
	Channel string `json:"channel"`
	GOOS    string `json:"goos"`
	GOARCH  string `json:"goarch"`
	SHA256  string `json:"sha256"`
}

// releaseAsset is the download URL of the release's asset name.
func releaseAsset(release marasicli.Release, name string) (string, error) {
	for _, asset := range release.Assets {
		if asset.Name == name {
			return asset.URL, nil
		}
	}
	return "", fmt.Errorf("the release has no %s", name)
}

func carry(ctx context.Context, opts carryOptions) error {
	if opts.channel != "release" && opts.channel != "nightly" {
		return fmt.Errorf("channel %q isn't release or nightly", opts.channel)
	}
	asset, ok := marasicli.Assets[opts.platform]
	if !ok {
		return fmt.Errorf("no Marasi CLI build for %s", opts.platform)
	}
	goos, goarch, _ := strings.Cut(opts.platform, "/")
	var key minisign.PublicKey
	if err := key.UnmarshalText([]byte(opts.key)); err != nil {
		return fmt.Errorf("reading the public key: %w", err)
	}

	releaseURL := opts.source + "/releases/latest"
	if opts.channel == "nightly" {
		releaseURL = opts.source + "/releases/tags/nightly"
	}
	body, err := opts.get(ctx, releaseURL, smallLimit*16)
	if err != nil {
		return fmt.Errorf("reading the %s release: %w", opts.channel, err)
	}
	var release marasicli.Release
	if err := json.Unmarshal(body, &release); err != nil {
		return fmt.Errorf("reading the %s release: %w", opts.channel, err)
	}
	version := release.TagName
	if opts.channel == "nightly" {
		version = release.Name
	}

	checksums, err := opts.getAsset(ctx, release, "checksums.txt", smallLimit)
	if err != nil {
		return err
	}
	signature, err := opts.getAsset(ctx, release, "checksums.txt.minisig", smallLimit)
	if err != nil {
		return err
	}
	if !minisign.Verify(key, checksums, signature) {
		return errors.New("checksums.txt.minisig: signature check failed")
	}
	want := marasicli.TrustedComment(opts.channel, version)
	if got := marasicli.SignatureComment(signature); got != want {
		return fmt.Errorf("checksums.txt.minisig: trusted comment %q, want %q", got, want)
	}
	sum, ok := marasicli.ParseChecksums(checksums)[asset]
	if !ok {
		return fmt.Errorf("the signed checksums don't list %s", asset)
	}
	build, err := opts.getAsset(ctx, release, asset, buildLimit)
	if err != nil {
		return err
	}
	if got := sha256.Sum256(build); hex.EncodeToString(got[:]) != sum {
		return fmt.Errorf("%s doesn't match its signed checksum", asset)
	}

	recorded, err := json.MarshalIndent(record{Version: version, Channel: opts.channel, GOOS: goos, GOARCH: goarch, SHA256: sum}, "", "  ")
	if err != nil {
		return err
	}
	if err := write(opts.out, build, recorded); err != nil {
		return err
	}
	fmt.Printf("Carrying Marasi CLI %s (%s) for %s, %d bytes gzipped from %d.\n", version, opts.channel, opts.platform, size(opts.out), len(build))
	return nil
}

// write writes marasi.gz and carried.json to a new folder, then renames it to
// out, so a failure leaves no out.
func write(out string, build, recorded []byte) error {
	if _, err := os.Stat(out); err == nil {
		return fmt.Errorf("%s already exists", out)
	}
	staged, err := os.MkdirTemp(filepath.Dir(out), ".carried-cli-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(staged)
	var gzipped bytes.Buffer
	gz, err := gzip.NewWriterLevel(&gzipped, gzip.BestCompression)
	if err != nil {
		return err
	}
	if _, err := gz.Write(build); err != nil {
		return err
	}
	if err := gz.Close(); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(staged, "marasi.gz"), gzipped.Bytes(), 0o644); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(staged, "carried.json"), append(recorded, '\n'), 0o644); err != nil {
		return err
	}
	if err := os.Chmod(staged, 0o755); err != nil {
		return err
	}
	return os.Rename(staged, out)
}

func size(out string) int64 {
	info, err := os.Stat(filepath.Join(out, "marasi.gz"))
	if err != nil {
		return 0
	}
	return info.Size()
}

func (opts carryOptions) getAsset(ctx context.Context, release marasicli.Release, name string, limit int64) ([]byte, error) {
	url, err := releaseAsset(release, name)
	if err != nil {
		return nil, err
	}
	data, err := opts.get(ctx, url, limit)
	if err != nil {
		return nil, fmt.Errorf("downloading %s: %w", name, err)
	}
	return data, nil
}

// get fetches url, refusing a body over limit.
func (opts carryOptions) get(ctx context.Context, url string, limit int64) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "marasi-app-carry-cli")
	if opts.token != "" && strings.HasPrefix(url, opts.source) {
		req.Header.Set("Authorization", "Bearer "+opts.token)
	}
	res, err := opts.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub answered %s", res.Status)
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("larger than %d bytes", limit)
	}
	return data, nil
}
