package main

import (
	"bytes"
	"compress/gzip"
	"io"
	"io/fs"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// newAssetHandler serves the frontend build, in which the build step
// (frontend/gzipBuild.js) replaced each file that compresses well with
// <name>.gz. Wails' own file server does the serving, so content types (by
// the original name), Range, HEAD and its fallbacks stay as they were; it
// sees each such file under its original name.
//
// With gzipPassthrough, a request that accepts gzip gets the stored bytes
// with Content-Encoding: gzip. Only a client that decodes it may get them,
// so main passes it only for the server build (serverBuild), whose client is
// a browser over HTTP. The native web views get no passthrough: WKWebView's
// custom scheme (macOS, iOS) neither sends Accept-Encoding nor decodes the
// body, Wails' Android path drops request and response headers, and
// WebView2 and WebKitGTK are untested, so every other response is
// decompressed here.
func newAssetHandler(build fs.FS, gzipPassthrough bool) http.Handler {
	decoded := application.AssetFileServerFS(gunzipFS{build})
	if !gzipPassthrough {
		return decoded
	}
	return http.HandlerFunc(func(rw http.ResponseWriter, req *http.Request) {
		rw.Header().Add("Vary", "Accept-Encoding")
		if !acceptsGzip(req.Header.Get("Accept-Encoding")) {
			decoded.ServeHTTP(rw, req)
			return
		}
		// One view per request, so it can tell the writer whether the file
		// Wails ended up serving was a stored .gz.
		view := &gzipFS{base: build}
		application.AssetFileServerFS(view).ServeHTTP(&encodingWriter{ResponseWriter: rw, view: view}, req)
	})
}

// acceptsGzip reports whether an Accept-Encoding value allows gzip.
func acceptsGzip(accept string) bool {
	for _, part := range strings.Split(accept, ",") {
		coding, params, _ := strings.Cut(strings.TrimSpace(part), ";")
		coding = strings.ToLower(strings.TrimSpace(coding))
		if coding != "gzip" && coding != "*" {
			continue
		}
		q := 1.0
		for _, param := range strings.Split(params, ";") {
			key, value, ok := strings.Cut(strings.TrimSpace(param), "=")
			if ok && strings.TrimSpace(key) == "q" {
				if parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64); err == nil {
					q = parsed
				}
			}
		}
		return q > 0
	}
	return false
}

// gzipFS presents <name>.gz as <name>, still compressed, and records whether
// the last file it opened was one.
type gzipFS struct {
	base    fs.FS
	encoded bool
}

func (g *gzipFS) Open(name string) (fs.File, error) {
	f, err := g.base.Open(name)
	if err == nil {
		g.encoded = false
		return f, nil
	}
	gz, gzErr := g.base.Open(name + ".gz")
	if gzErr != nil {
		return nil, err
	}
	g.encoded = true
	return gz, nil
}

// encodingWriter marks a response from a stored .gz as gzip-encoded.
type encodingWriter struct {
	http.ResponseWriter
	view        *gzipFS
	wroteHeader bool
}

func (w *encodingWriter) WriteHeader(code int) {
	if !w.wroteHeader {
		w.wroteHeader = true
		if w.view.encoded && (code == http.StatusOK || code == http.StatusPartialContent) {
			w.Header().Set("Content-Encoding", "gzip")
		}
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *encodingWriter) Write(b []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(b)
}

func (w *encodingWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

// gunzipFS presents <name>.gz as <name>, decompressed.
type gunzipFS struct{ base fs.FS }

func (g gunzipFS) Open(name string) (fs.File, error) {
	f, err := g.base.Open(name)
	if err == nil {
		return f, nil
	}
	gz, gzErr := g.base.Open(name + ".gz")
	if gzErr != nil {
		return nil, err
	}
	defer gz.Close()
	info, err := gz.Stat()
	if err != nil {
		return nil, err
	}
	r, err := gzip.NewReader(gz)
	if err != nil {
		return nil, &fs.PathError{Op: "open", Path: name, Err: err}
	}
	data, err := io.ReadAll(r)
	if err != nil {
		return nil, &fs.PathError{Op: "open", Path: name, Err: err}
	}
	return &memFile{Reader: bytes.NewReader(data), info: memInfo{name: info.Name()[:len(info.Name())-len(".gz")], size: int64(len(data)), mode: info.Mode(), modTime: info.ModTime()}}, nil
}

// memFile is a decompressed asset: a seekable reader, as http.ServeContent
// needs for Range.
type memFile struct {
	*bytes.Reader
	info memInfo
}

func (f *memFile) Stat() (fs.FileInfo, error) { return f.info, nil }
func (f *memFile) Close() error               { return nil }

type memInfo struct {
	name    string
	size    int64
	mode    fs.FileMode
	modTime time.Time
}

func (i memInfo) Name() string       { return i.name }
func (i memInfo) Size() int64        { return i.size }
func (i memInfo) Mode() fs.FileMode  { return i.mode }
func (i memInfo) ModTime() time.Time { return i.modTime }
func (i memInfo) IsDir() bool        { return false }
func (i memInfo) Sys() any           { return nil }
