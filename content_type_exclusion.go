package main

import (
	"fmt"
	"mime"
	"slices"
	"strings"

	"go.yaml.in/yaml/v3"
)

// The content-type exclusion hides pairs by content type from every traffic
// read. The app default lives in the app config; a project that has edited
// its list keeps it as the service client setting ledger.exclusion, which the
// frontend reads and writes, and stops following the default
// (docs/adr/2026-10-16-app-defaults-with-project-overrides.md).
const contentTypeExclusionConfigKey = "ledger_content_type_exclusion"

// seededContentTypeExclusion is the default Marasi seeded into app.filters,
// which every project followed before the exclusion moved to the app.
var seededContentTypeExclusion = []string{
	"audio/aac", "image/apng", "image/avif", "video/x-msvideo", "image/bmp",
	"audio/midi", "audio/x-midi", "image/gif", "image/vnd.microsoft.icon",
	"image/jpeg", "audio/mpeg", "video/mp4", "video/mpeg", "audio/ogg",
	"video/ogg", "image/png", "image/svg+xml", "image/tiff", "video/mp2t",
	"audio/wav", "audio/webm", "video/webm", "image/webp", "video/3gpp",
	"audio/3gpp", "video/3gpp2", "audio/3gpp2", "application/vnd.ms-fontobject",
	"font/otf", "font/ttf", "font/woff", "font/woff2", "application/x-abiword",
	"application/vnd.amazon.ebook", "application/x-cdf", "application/x-csh",
	"application/epub+zip", "application/vnd.apple.installer+xml",
	"application/vnd.oasis.opendocument.presentation",
	"application/vnd.oasis.opendocument.spreadsheet",
	"application/vnd.oasis.opendocument.text", "application/vnd.visio",
	"application/vnd.mozilla.xul+xml", "application/javascript",
	"application/octet-stream", "binary/octet-stream", "image/x-icon",
	"image/vnd.djvu", "image/x-portable-pixmap", "image/x-portable-bitmap",
	"audio/basic", "audio/aiff", "audio/x-aiff", "audio/x-wav",
	"audio/x-mpegurl", "audio/x-ms-wma", "video/quicktime", "video/x-flv",
	"video/x-ms-wmv", "application/pdf", "application/msword",
	"application/vnd.ms-excel", "application/vnd.ms-powerpoint",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation",
	"application/rtf", "application/x-rar-compressed",
	"application/x-7z-compressed", "application/zip", "application/x-tar",
	"application/gzip", "application/x-font-ttf", "application/x-font-woff",
	"text/css", "text/calendar", "text/vcard", "application/x-shockwave-flash",
	"application/x-bzip", "application/x-bzip2",
}

// normalizeExclusion parses each value with mime.ParseMediaType, lowercases
// it and drops its parameters, as Marasi does. A value must be an exact type
// such as "text/html" or a whole major type such as "image/*". It returns an
// empty list rather than nil so it stores as [].
func normalizeExclusion(values []string) ([]string, error) {
	normalized := make([]string, len(values))
	for i, value := range values {
		mediaType, _, err := mime.ParseMediaType(value)
		major, minor, ok := strings.Cut(mediaType, "/")
		switch {
		case err != nil || !ok || major == "" || minor == "":
			return nil, fmt.Errorf("invalid content-type exclusion %q: want type/subtype or type/*", value)
		case strings.Contains(major, "*") || (strings.Contains(minor, "*") && minor != "*"):
			return nil, fmt.Errorf("invalid content-type exclusion %q: * may only stand for a whole subtype, as in image/*", value)
		}
		normalized[i] = mediaType
	}
	return normalized, nil
}

// parseContentTypeExclusion reads the app default from its config node.
func parseContentTypeExclusion(node *yaml.Node) ([]string, error) {
	var values []string
	if err := node.Decode(&values); err != nil {
		return nil, err
	}
	return normalizeExclusion(values)
}

// GetDefaultContentTypeExclusion returns the app default exclusion.
func (a *App) GetDefaultContentTypeExclusion() []string {
	a.Config.mu.Lock()
	defer a.Config.mu.Unlock()
	return slices.Clone(a.Config.contentTypeExclusion)
}

// SetDefaultContentTypeExclusion replaces the app default exclusion, which
// every project that has not edited its own list follows.
func (a *App) SetDefaultContentTypeExclusion(values []string) error {
	normalized, err := normalizeExclusion(values)
	if err != nil {
		return err
	}
	cfg := a.Config
	cfg.mu.Lock()
	defer cfg.mu.Unlock()
	if err := writeConfigKeys(cfg.path(), map[string]any{contentTypeExclusionConfigKey: normalized}); err != nil {
		return fmt.Errorf("saving default content-type exclusion: %w", err)
	}
	cfg.contentTypeExclusion = normalized
	return nil
}
