package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"aead.dev/minisign"
)

// A fake Marasi releases API: one latest release and a nightly, signed with
// a key made for the test.

var cliBuild = []byte("#!/bin/sh\necho marasi\n")

type release struct {
	tag, name string
	assets    map[string][]byte
}

type releases struct {
	server *httptest.Server
	byPath map[string]*release
}

func newReleases(t *testing.T) *releases {
	t.Helper()
	r := &releases{byPath: map[string]*release{}}
	r.server = httptest.NewServer(http.HandlerFunc(r.serve))
	t.Cleanup(r.server.Close)
	return r
}

func (r *releases) serve(w http.ResponseWriter, req *http.Request) {
	if rel, ok := r.byPath[req.URL.Path]; ok {
		type asset struct {
			Name string `json:"name"`
			URL  string `json:"browser_download_url"`
		}
		body := struct {
			Tag    string  `json:"tag_name"`
			Name   string  `json:"name"`
			Assets []asset `json:"assets"`
		}{Tag: rel.tag, Name: rel.name}
		for name := range rel.assets {
			body.Assets = append(body.Assets, asset{name, r.server.URL + "/download/" + rel.tag + "/" + name})
		}
		json.NewEncoder(w).Encode(body)
		return
	}
	for _, rel := range r.byPath {
		if name, ok := strings.CutPrefix(req.URL.Path, "/download/"+rel.tag+"/"); ok {
			if data, ok := rel.assets[name]; ok {
				w.Write(data)
				return
			}
		}
	}
	http.NotFound(w, req)
}

// publish adds a release with build as asset, its checksums, and a
// signature over checksums with comment, by key.
func (r *releases) publish(path string, rel *release, asset string, build, checksums []byte, key minisign.PrivateKey, comment string) {
	if checksums == nil {
		checksums = []byte(fmt.Sprintf("%x  %s\n", sha256.Sum256(build), asset))
	}
	rel.assets = map[string][]byte{
		asset:                    build,
		"checksums.txt":          checksums,
		"checksums.txt.minisig":  minisign.SignWithComments(key, checksums, comment, ""),
		"marasi-windows-amd64.x": []byte("another build"),
	}
	r.byPath[path] = rel
}

func newKey(t *testing.T) (minisign.PublicKey, minisign.PrivateKey) {
	t.Helper()
	public, private, err := minisign.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return public, private
}

func options(t *testing.T, r *releases, public minisign.PublicKey, channel string) carryOptions {
	t.Helper()
	text, err := public.MarshalText()
	if err != nil {
		t.Fatal(err)
	}
	return carryOptions{
		channel: channel, platform: "linux/amd64", key: string(text),
		source: r.server.URL, out: filepath.Join(t.TempDir(), "carried_cli"),
		client: r.server.Client(),
	}
}

func TestCarryWritesTheVerifiedCLIGzippedWithItsRecord(t *testing.T) {
	for _, tc := range []struct {
		channel, path, tag, name, version string
	}{
		{"release", "/releases/latest", "06.11.2026", "06.11.2026", "06.11.2026"},
		{"nightly", "/releases/tags/nightly", "nightly", "07.11.2026 (nightly 7d411bd)", "07.11.2026 (nightly 7d411bd)"},
	} {
		t.Run(tc.channel, func(t *testing.T) {
			r := newReleases(t)
			public, private := newKey(t)
			r.publish(tc.path, &release{tag: tc.tag, name: tc.name}, "marasi-linux-amd64", cliBuild, nil, private, "marasi "+tc.channel+" "+tc.version)
			opts := options(t, r, public, tc.channel)

			if err := carry(context.Background(), opts); err != nil {
				t.Fatal(err)
			}

			gzipped, err := os.ReadFile(filepath.Join(opts.out, "marasi.gz"))
			if err != nil {
				t.Fatal(err)
			}
			gz, err := gzip.NewReader(bytes.NewReader(gzipped))
			if err != nil {
				t.Fatal(err)
			}
			if data, _ := io.ReadAll(gz); !bytes.Equal(data, cliBuild) {
				t.Fatalf("carried %q, want the release's build", data)
			}
			var record map[string]string
			data, err := os.ReadFile(filepath.Join(opts.out, "carried.json"))
			if err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(data, &record); err != nil {
				t.Fatal(err)
			}
			want := map[string]string{
				"version": tc.version, "channel": tc.channel, "goos": "linux", "goarch": "amd64",
				"sha256": fmt.Sprintf("%x", sha256.Sum256(cliBuild)),
			}
			if fmt.Sprint(record) != fmt.Sprint(want) {
				t.Fatalf("record = %v, want %v", record, want)
			}
		})
	}
}

func TestCarryFailsAndWritesNothingWhenVerificationFails(t *testing.T) {
	asset := "marasi-linux-amd64"
	honest := []byte(fmt.Sprintf("%x  %s\n", sha256.Sum256(cliBuild), asset))
	for name, tc := range map[string]struct {
		publish func(r *releases, private, other minisign.PrivateKey)
		want    string
	}{
		"signed by another key": {
			publish: func(r *releases, _, other minisign.PrivateKey) {
				r.publish("/releases/latest", &release{tag: "06.11.2026"}, asset, cliBuild, nil, other, "marasi release 06.11.2026")
			},
			want: "signature",
		},
		"another program's signed checksums": {
			publish: func(r *releases, private, _ minisign.PrivateKey) {
				r.publish("/releases/latest", &release{tag: "06.11.2026"}, asset, cliBuild, nil, private, "marasi-app release 06.11.2026")
			},
			want: "trusted comment",
		},
		"another channel's signed checksums": {
			publish: func(r *releases, private, _ minisign.PrivateKey) {
				r.publish("/releases/latest", &release{tag: "06.11.2026"}, asset, cliBuild, nil, private, "marasi nightly 06.11.2026")
			},
			want: "trusted comment",
		},
		"build that doesn't match its checksum": {
			publish: func(r *releases, private, _ minisign.PrivateKey) {
				r.publish("/releases/latest", &release{tag: "06.11.2026"}, asset, []byte("evil"), honest, private, "marasi release 06.11.2026")
			},
			want: "checksum",
		},
		"checksums that don't list the build": {
			publish: func(r *releases, private, _ minisign.PrivateKey) {
				r.publish("/releases/latest", &release{tag: "06.11.2026"}, asset, cliBuild, []byte("ab  other\n"), private, "marasi release 06.11.2026")
			},
			want: "don't list",
		},
		"no release": {
			publish: func(*releases, minisign.PrivateKey, minisign.PrivateKey) {},
			want:    "404",
		},
	} {
		t.Run(name, func(t *testing.T) {
			r := newReleases(t)
			public, private := newKey(t)
			_, other := newKey(t)
			tc.publish(r, private, other)
			opts := options(t, r, public, "release")

			err := carry(context.Background(), opts)

			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("carry = %v, want an error naming %q", err, tc.want)
			}
			if _, err := os.Stat(opts.out); !os.IsNotExist(err) {
				t.Fatalf("carry left %s behind", opts.out)
			}
		})
	}
}

func TestCarryRefusesAPlatformWithNoCLIBuild(t *testing.T) {
	r := newReleases(t)
	public, _ := newKey(t)
	opts := options(t, r, public, "release")
	opts.platform = "darwin/amd64"

	if err := carry(context.Background(), opts); err == nil || !strings.Contains(err.Error(), "no Marasi CLI build") {
		t.Fatalf("carry = %v, want no build for darwin/amd64", err)
	}
}
