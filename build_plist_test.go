package main

import (
	"encoding/xml"
	"errors"
	"io"
	"os"
	"testing"
)

// plistValue is a decoded plist value: a map for <dict>, a bool for
// <true/>/<false/>, a string for anything else this test reads.
type plistValue any

func decodePlistValue(d *xml.Decoder, start xml.StartElement) (plistValue, error) {
	switch start.Name.Local {
	case "dict":
		out := map[string]plistValue{}
		key := ""
		for {
			tok, err := d.Token()
			if err != nil {
				return nil, err
			}
			switch t := tok.(type) {
			case xml.StartElement:
				if t.Name.Local == "key" {
					if err := d.DecodeElement(&key, &t); err != nil {
						return nil, err
					}
					continue
				}
				v, err := decodePlistValue(d, t)
				if err != nil {
					return nil, err
				}
				out[key] = v
			case xml.EndElement:
				return out, nil
			}
		}
	case "true", "false":
		if err := d.Skip(); err != nil {
			return nil, err
		}
		return start.Name.Local == "true", nil
	default:
		var s string
		if err := d.DecodeElement(&s, &start); err != nil {
			return nil, err
		}
		return s, nil
	}
}

func readPlist(t *testing.T, path string) map[string]plistValue {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	d := xml.NewDecoder(f)
	d.Strict = false
	for {
		tok, err := d.Token()
		if errors.Is(err, io.EOF) {
			t.Fatalf("%s: no top-level dict", path)
		}
		if err != nil {
			t.Fatalf("%s: %v", path, err)
		}
		if s, ok := tok.(xml.StartElement); ok && s.Name.Local == "dict" {
			v, err := decodePlistValue(d, s)
			if err != nil {
				t.Fatalf("%s: %v", path, err)
			}
			return v.(map[string]plistValue)
		}
	}
}

// The web view reaches a remote Marasi's control API over plain HTTP at any
// host. Without these ATS exceptions macOS blocks every non-loopback fetch
// and a remote connection fails (the release plist once had none). On iOS,
// NSAllowsLocalNetworking alone passes a hostname but refuses an IP address
// such as a Tailscale 100.x one (NSURLErrorDomain -1022), which the release
// plist once did while the dev plist's NSAllowsArbitraryLoads hid it.
func TestBundlePlistsAllowPlainHTTPFromTheWebView(t *testing.T) {
	for _, path := range []string{
		"build/darwin/Info.plist", "build/darwin/Info.dev.plist",
		"build/ios/Info.plist", "build/ios/Info.dev.plist",
	} {
		ats, ok := readPlist(t, path)["NSAppTransportSecurity"].(map[string]plistValue)
		if !ok {
			t.Errorf("%s: no NSAppTransportSecurity dict", path)
			continue
		}
		for _, key := range []string{"NSAllowsArbitraryLoadsInWebContent", "NSAllowsLocalNetworking"} {
			if ats[key] != true {
				t.Errorf("%s: NSAppTransportSecurity.%s = %v, want true", path, key, ats[key])
			}
		}
		// Arbitrary loads would lift ATS for native networking too, and
		// would let a dev build pass what the release refuses.
		if ats["NSAllowsArbitraryLoads"] == true {
			t.Errorf("%s: NSAppTransportSecurity.NSAllowsArbitraryLoads = true, want it unset or false", path)
		}
	}
}
