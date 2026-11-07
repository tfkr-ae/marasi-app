package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// fakeReleaseServer stands in for the GitHub releases API of the Marasi App
// repository. Point an App at it with app.releaseSource = server.URL().
//
// It serves:
//   - GET /releases/latest: the most recently published non-prerelease
//   - GET /releases/tags/{tag}: any published release, prereleases included
//   - GET /download/{tag}/{asset}: the bytes of an asset added with addAsset
//
// Every request is recorded, so tests can assert that nothing was fetched.
type fakeReleaseServer struct {
	t      *testing.T
	server *httptest.Server

	mu       sync.Mutex
	releases map[string]*fakeRelease // by tag
	latest   string                  // tag of the latest non-prerelease
	assets   map[string][]byte       // "tag/name" -> bytes
	stalled  map[string]bool         // "tag/name" of assets whose download hangs
	failWith int                     // status answered to every request, 0 for none
	requests []string                // "METHOD path" in arrival order
}

// fakeRelease is the subset of a GitHub release the app reads.
type fakeRelease struct {
	Tag        string
	Name       string
	Notes      string
	Prerelease bool
	Assets     []string // asset names, served under /download/{tag}/{name}
}

func newFakeReleaseServer(t *testing.T) *fakeReleaseServer {
	t.Helper()
	f := &fakeReleaseServer{
		t:        t,
		releases: map[string]*fakeRelease{},
		assets:   map[string][]byte{},
		stalled:  map[string]bool{},
	}
	f.server = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.server.Close)
	return f
}

// URL is the release-source base URL to hold on App.
func (f *fakeReleaseServer) URL() string { return f.server.URL }

// publish adds or replaces a release. A non-prerelease becomes the latest.
func (f *fakeReleaseServer) publish(release fakeRelease) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if release.Name == "" {
		release.Name = release.Tag
	}
	f.releases[release.Tag] = &release
	if !release.Prerelease {
		f.latest = release.Tag
	}
}

// publishRelease publishes a dated release with release notes.
func (f *fakeReleaseServer) publishRelease(tag, notes string) {
	f.publish(fakeRelease{Tag: tag, Notes: notes})
}

// unpublish deletes a release, as the nightly workflow does mid-publish.
func (f *fakeReleaseServer) unpublish(tag string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.releases, tag)
	if f.latest == tag {
		f.latest = ""
	}
}

// addAsset attaches an asset to a published release and serves its bytes.
func (f *fakeReleaseServer) addAsset(tag, name string, data []byte) {
	f.mu.Lock()
	defer f.mu.Unlock()
	release, ok := f.releases[tag]
	if !ok {
		f.t.Fatalf("adding asset %s to unpublished release %s", name, tag)
	}
	release.Assets = append(release.Assets, name)
	f.assets[tag+"/"+name] = data
}

// stall makes downloads of an asset send half its bytes and then hang until
// the client gives up, like a download on a slow link.
func (f *fakeReleaseServer) stall(tag, name string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.stalled[tag+"/"+name] = true
}

// fail makes every later request answer status; 0 serves normally again.
func (f *fakeReleaseServer) fail(status int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.failWith = status
}

// requestCount is the number of requests the server has received.
func (f *fakeReleaseServer) requestCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.requests)
}

// requested reports the recorded requests as "METHOD path".
func (f *fakeReleaseServer) requested() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.requests...)
}

func (f *fakeReleaseServer) serve(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.requests = append(f.requests, r.Method+" "+r.URL.Path)
	if f.failWith != 0 {
		http.Error(w, http.StatusText(f.failWith), f.failWith)
		return
	}
	path := r.URL.Path
	switch {
	case path == "/releases/latest":
		f.writeRelease(w, f.releases[f.latest])
	case strings.HasPrefix(path, "/releases/tags/"):
		f.writeRelease(w, f.releases[strings.TrimPrefix(path, "/releases/tags/")])
	case strings.HasPrefix(path, "/download/"):
		key := strings.TrimPrefix(path, "/download/")
		data, ok := f.assets[key]
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Length", fmt.Sprint(len(data)))
		if !f.stalled[key] {
			_, _ = w.Write(data)
			return
		}
		// Send half, then hang until the client gives up, without holding
		// the server's lock.
		_, _ = w.Write(data[:len(data)/2])
		w.(http.Flusher).Flush()
		f.mu.Unlock()
		<-r.Context().Done()
		f.mu.Lock()
	default:
		http.NotFound(w, r)
	}
}

func (f *fakeReleaseServer) writeRelease(w http.ResponseWriter, release *fakeRelease) {
	if release == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"message":"Not Found"}`))
		return
	}
	type asset struct {
		Name string `json:"name"`
		Size int    `json:"size"`
		URL  string `json:"browser_download_url"`
	}
	assets := []asset{}
	for _, name := range release.Assets {
		assets = append(assets, asset{
			Name: name,
			Size: len(f.assets[release.Tag+"/"+name]),
			URL:  f.server.URL + "/download/" + release.Tag + "/" + name,
		})
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"tag_name":   release.Tag,
		"name":       release.Name,
		"body":       release.Notes,
		"prerelease": release.Prerelease,
		"draft":      false,
		"html_url":   "https://github.com/tfkr-ae/marasi-app/releases/tag/" + release.Tag,
		"assets":     assets,
	})
}

// newUpdateApp returns an App running the build channel and version given,
// reading releases from releases and recording the events it emits.
func newUpdateApp(t *testing.T, channel, runningVersion string, releases *fakeReleaseServer) (*App, *recordedEvents) {
	t.Helper()
	app := newTestApp(t)
	events := &recordedEvents{}
	app.emitEvent = events.emit
	app.build = BuildInfo{Channel: channel, Version: runningVersion}
	app.releaseSource = releases.URL()
	return app, events
}
