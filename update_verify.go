package main

import (
	"crypto/sha256"
	"encoding/hex"
	"io"

	"aead.dev/minisign"
	"github.com/tfkr-ae/marasi-app/internal/marasicli"
)

// verifyChecksums checks that signature is the Marasi signing key's
// signature over checksums (docs/adr/2026-10-17-updates-are-signed-with-an-embedded-key.md) and returns the checksums it signs,
// by asset name, as lowercase hex SHA-256.
func verifyChecksums(key minisign.PublicKey, checksums, signature []byte) (map[string]string, error) {
	if !minisign.Verify(key, checksums, signature) {
		return nil, failed(UpdateFailureSignature, "the release's checksums are not signed by the Marasi signing key")
	}
	return marasicli.ParseChecksums(checksums), nil
}

// copyHashing copies src to dst, reporting each chunk to progress, and
// returns the SHA-256 of what it copied in hex.
func copyHashing(dst io.Writer, src io.Reader, progress *progressReporter) (string, error) {
	hash := sha256.New()
	_, err := io.Copy(io.MultiWriter(dst, hash, progress), src)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

// progressReporter counts downloaded bytes and reports them when the whole
// percentage changes (or every MiB when the size is unknown), so a large
// download sends about a hundred events.
type progressReporter struct {
	total    int64
	received int64
	reported int64
	report   func(UpdateProgress)
}

func newProgressReporter(total int64, report func(UpdateProgress)) *progressReporter {
	p := &progressReporter{total: total, reported: -1, report: report}
	p.send()
	return p
}

func (p *progressReporter) Write(b []byte) (int, error) {
	p.received += int64(len(b))
	if p.step(p.received) != p.step(p.reported) {
		p.send()
	}
	return len(b), nil
}

// done reports the final count, if it was not just reported.
func (p *progressReporter) done() {
	if p.reported != p.received {
		p.send()
	}
}

func (p *progressReporter) send() {
	p.reported = p.received
	p.report(UpdateProgress{Received: p.received, Total: p.total})
}

func (p *progressReporter) step(n int64) int64 {
	if n < 0 {
		return -1
	}
	if p.total > 0 {
		return n * 100 / p.total
	}
	return n >> 20
}
