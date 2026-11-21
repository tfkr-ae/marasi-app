package main

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

func gzipped(t *testing.T, text string) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := gzip.NewWriter(&buf)
	if _, err := w.Write([]byte(text)); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// testAssets is a frontend build after compression: text files only as
// <name>.gz, a PNG as it was.
func testAssets(t *testing.T) fstest.MapFS {
	return fstest.MapFS{
		"index.html.gz":                 {Data: gzipped(t, "<html>app</html>")},
		"settings.html.gz":              {Data: gzipped(t, "<html>settings</html>")},
		"tools/cyberchef/index.html.gz": {Data: gzipped(t, "<html>chef</html>")},
		"tools/cyberchef/main.js.gz":    {Data: gzipped(t, "window.chef = 1;")},
		"fonts/Virgil.woff2":            {Data: []byte("wOF2 not compressed")},
		"logo.png":                      {Data: []byte("\x89PNG\r\n\x1a\nrest")},
	}
}

func serveAsset(h http.Handler, method, path string, header http.Header) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, nil)
	for k, v := range header {
		req.Header[k] = v
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestAssetsDecompressWhenTheClientDoesNotAcceptGzip(t *testing.T) {
	h := newAssetHandler(testAssets(t), true)

	rec := serveAsset(h, http.MethodGet, "/tools/cyberchef/main.js", nil)

	if rec.Code != http.StatusOK {
		t.Fatalf("status %d, want 200", rec.Code)
	}
	if got := rec.Body.String(); got != "window.chef = 1;" {
		t.Fatalf("body %q, want the decompressed script", got)
	}
	if got := rec.Header().Get("Content-Encoding"); got != "" {
		t.Fatalf("Content-Encoding %q, want none", got)
	}
	if got := rec.Header().Get("Content-Type"); got != "text/javascript; charset=utf-8" {
		t.Fatalf("Content-Type %q", got)
	}
}

func gunzipBody(t *testing.T, body []byte) string {
	t.Helper()
	r, err := gzip.NewReader(bytes.NewReader(body))
	if err != nil {
		t.Fatalf("body is not gzip: %v", err)
	}
	text, err := io.ReadAll(r)
	if err != nil {
		t.Fatal(err)
	}
	return string(text)
}

func TestAssetsPassGzipThroughToAClientThatAcceptsIt(t *testing.T) {
	h := newAssetHandler(testAssets(t), true)

	rec := serveAsset(h, http.MethodGet, "/tools/cyberchef/main.js", http.Header{"Accept-Encoding": {"gzip, deflate, br"}})

	if rec.Code != http.StatusOK {
		t.Fatalf("status %d, want 200", rec.Code)
	}
	if got := rec.Header().Get("Content-Encoding"); got != "gzip" {
		t.Fatalf("Content-Encoding %q, want gzip", got)
	}
	if got := rec.Header().Get("Vary"); got != "Accept-Encoding" {
		t.Fatalf("Vary %q, want Accept-Encoding", got)
	}
	if got := rec.Header().Get("Content-Type"); got != "text/javascript; charset=utf-8" {
		t.Fatalf("Content-Type %q, want the script's", got)
	}
	if got := gunzipBody(t, rec.Body.Bytes()); got != "window.chef = 1;" {
		t.Fatalf("decoded body %q", got)
	}
}

func TestAssetsDecompressWithoutPassthroughEvenWhenGzipIsAccepted(t *testing.T) {
	// A native web view's custom scheme: WKWebView neither decodes the body
	// nor (on macOS) sends Accept-Encoding.
	h := newAssetHandler(testAssets(t), false)

	rec := serveAsset(h, http.MethodGet, "/tools/cyberchef/main.js", http.Header{"Accept-Encoding": {"gzip"}})

	if got := rec.Header().Get("Content-Encoding"); got != "" {
		t.Fatalf("Content-Encoding %q, want none", got)
	}
	if got := rec.Body.String(); got != "window.chef = 1;" {
		t.Fatalf("body %q, want the decompressed script", got)
	}
}

func TestAssetsDecompressWhenTheClientRefusesGzip(t *testing.T) {
	h := newAssetHandler(testAssets(t), true)

	for _, accept := range []string{"identity", "gzip;q=0", "br", "deflate, gzip; q=0.0"} {
		rec := serveAsset(h, http.MethodGet, "/tools/cyberchef/main.js", http.Header{"Accept-Encoding": {accept}})
		if got := rec.Header().Get("Content-Encoding"); got != "" {
			t.Errorf("Accept-Encoding %q: Content-Encoding %q, want none", accept, got)
		}
		if got := rec.Body.String(); got != "window.chef = 1;" {
			t.Errorf("Accept-Encoding %q: body %q", accept, got)
		}
	}
}

func TestAssetsLeaveUncompressedFilesAsTheyAre(t *testing.T) {
	for _, passthrough := range []bool{false, true} {
		h := newAssetHandler(testAssets(t), passthrough)
		for path, want := range map[string]struct{ contentType, body string }{
			"/logo.png":           {"image/png", "\x89PNG\r\n\x1a\nrest"},
			"/fonts/Virgil.woff2": {"font/woff2", "wOF2 not compressed"},
		} {
			rec := serveAsset(h, http.MethodGet, path, http.Header{"Accept-Encoding": {"gzip"}})
			if rec.Code != http.StatusOK || rec.Body.String() != want.body {
				t.Errorf("passthrough %v, %s: status %d body %q", passthrough, path, rec.Code, rec.Body.String())
			}
			if got := rec.Header().Get("Content-Type"); got != want.contentType {
				t.Errorf("passthrough %v, %s: Content-Type %q, want %q", passthrough, path, got, want.contentType)
			}
			if got := rec.Header().Get("Content-Encoding"); got != "" {
				t.Errorf("passthrough %v, %s: Content-Encoding %q, want none", passthrough, path, got)
			}
		}
	}
}

func TestAssetsAnswerAMissingFileWith404(t *testing.T) {
	for _, passthrough := range []bool{false, true} {
		h := newAssetHandler(testAssets(t), passthrough)
		for _, path := range []string{"/missing.js", "/tools/cyberchef/missing.js"} {
			rec := serveAsset(h, http.MethodGet, path, http.Header{"Accept-Encoding": {"gzip"}})
			if rec.Code != http.StatusNotFound {
				t.Errorf("passthrough %v, %s: status %d, want 404", passthrough, path, rec.Code)
			}
			if got := rec.Header().Get("Content-Encoding"); got != "" {
				t.Errorf("passthrough %v, %s: Content-Encoding %q on a 404", passthrough, path, got)
			}
		}
	}
}

// Wails' file server serves dir/ as dir/index.html and an extensionless path
// as <path>.html; both must find the stored .gz.
func TestAssetsKeepTheFileServersFallbacks(t *testing.T) {
	for _, passthrough := range []bool{false, true} {
		h := newAssetHandler(testAssets(t), passthrough)
		for path, want := range map[string]string{
			"/":                 "<html>app</html>",
			"/index.html":       "<html>app</html>",
			"/settings":         "<html>settings</html>",
			"/tools/cyberchef/": "<html>chef</html>",
		} {
			for _, accept := range []string{"", "gzip"} {
				rec := serveAsset(h, http.MethodGet, path, http.Header{"Accept-Encoding": {accept}})
				body := rec.Body.String()
				if rec.Header().Get("Content-Encoding") == "gzip" {
					body = gunzipBody(t, rec.Body.Bytes())
				}
				if rec.Code != http.StatusOK || body != want {
					t.Errorf("passthrough %v, %s, accept %q: status %d body %q, want %q", passthrough, path, accept, rec.Code, body, want)
				}
				if got := rec.Header().Get("Content-Type"); got != "text/html; charset=utf-8" {
					t.Errorf("passthrough %v, %s: Content-Type %q", passthrough, path, got)
				}
			}
		}
	}
}

func TestAssetsAnswerHeadAndRangeOnTheDecompressedFile(t *testing.T) {
	h := newAssetHandler(testAssets(t), false)

	head := serveAsset(h, http.MethodHead, "/tools/cyberchef/main.js", nil)
	if head.Code != http.StatusOK || head.Body.Len() != 0 {
		t.Fatalf("HEAD: status %d, %d body bytes", head.Code, head.Body.Len())
	}
	if got := head.Header().Get("Content-Length"); got != "16" {
		t.Fatalf("HEAD: Content-Length %q, want the decompressed 16", got)
	}

	part := serveAsset(h, http.MethodGet, "/tools/cyberchef/main.js", http.Header{"Range": {"bytes=7-10"}})
	if part.Code != http.StatusPartialContent || part.Body.String() != "chef" {
		t.Fatalf("Range: status %d body %q, want 206 \"chef\"", part.Code, part.Body.String())
	}
}

func TestAssetsVaryOnAcceptEncodingWithPassthrough(t *testing.T) {
	h := newAssetHandler(testAssets(t), true)

	rec := serveAsset(h, http.MethodGet, "/tools/cyberchef/main.js", nil)

	if got := rec.Header().Get("Vary"); got != "Accept-Encoding" {
		t.Fatalf("Vary %q on the decompressed answer, want Accept-Encoding", got)
	}
}
