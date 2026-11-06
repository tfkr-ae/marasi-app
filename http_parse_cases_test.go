package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"testing"
)

// The Checkpoint editor's malformed warning runs in the frontend
// (frontend/src/lib/checkpoint/httpParse.js), a port of reading the text
// with net/http. Its test compares the port with the answers recorded in
// httpParse.cases.json; this test keeps those answers what net/http says.
func TestHTTPParseCasesMatchNetHTTP(t *testing.T) {
	data, err := os.ReadFile("frontend/src/lib/checkpoint/httpParse.cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Type  string `json:"type"`
		Text  string `json:"text"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		got := ""
		reader := bufio.NewReader(bytes.NewReader([]byte(c.Text)))
		switch c.Type {
		case "request":
			if _, err := http.ReadRequest(reader); err != nil {
				got = err.Error()
			}
		case "response":
			if _, err := http.ReadResponse(reader, nil); err != nil {
				got = err.Error()
			}
		}
		if got != c.Error {
			t.Errorf("%s %q: net/http says %q, the case records %q", c.Type, c.Text, got, c.Error)
		}
	}
}
