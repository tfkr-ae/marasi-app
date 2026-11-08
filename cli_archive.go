package main

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"errors"
	"io"
	"os"
	"strings"
)

// The Marasi CLI's archive builds: the same CLI as the bare executable,
// packed alone in a zip (macOS, Windows) or tar.gz (Linux). Some networks
// block bare executables from GitHub but let archives through, so an
// install or update downloads the archive whenever the release's signed
// checksums list it (spec "The carried CLI").

// cliArchives is the archive of the CLI for each GOOS/GOARCH Marasi
// publishes.
var cliArchives = map[string]string{
	"darwin/arm64":  "marasi-darwin-arm64.zip",
	"linux/amd64":   "marasi-linux-amd64.tar.gz",
	"windows/amd64": "marasi-windows-amd64.zip",
}

// cliExtractLimit caps the CLI extracted from an archive; the CLI is about
// 34 MB.
const cliExtractLimit = 512 << 20

const cliBadArchiveReason = "The archive doesn't hold just the Marasi CLI, nothing installed"

// cliArchive is this platform's archive asset.
func (a *App) cliArchive() (string, bool) {
	archive, ok := cliArchives[a.cliRuntime.goos+"/"+a.cliRuntime.goarch]
	return archive, ok
}

// extractCLI writes the CLI in the archive at path to dst. The archive must
// hold one regular file named entry and nothing else; anything else fails
// closed with nothing left at dst.
func (a *App) extractCLI(path, entry, dst string) error {
	var err error
	if strings.HasSuffix(path, ".zip") {
		err = a.extractCLIZip(path, entry, dst)
	} else {
		err = a.extractCLITarGz(path, entry, dst)
	}
	if err != nil {
		a.cliRuntime.remove(dst)
		var stepErr *installError
		if errors.As(err, &stepErr) {
			return err
		}
		return failed(UpdateFailureInstall, "Could not extract the CLI: %v", err)
	}
	return nil
}

func (a *App) extractCLIZip(path, entry, dst string) error {
	archive, err := zip.OpenReader(path)
	if err != nil {
		return failed(UpdateFailureInstall, cliBadArchiveReason)
	}
	defer archive.Close()
	if len(archive.File) != 1 {
		return failed(UpdateFailureInstall, cliBadArchiveReason)
	}
	file := archive.File[0]
	if file.Name != entry || !file.Mode().IsRegular() {
		return failed(UpdateFailureInstall, cliBadArchiveReason)
	}
	body, err := file.Open()
	if err != nil {
		return failed(UpdateFailureInstall, cliBadArchiveReason)
	}
	defer body.Close()
	return a.writeExtracted(dst, body)
}

func (a *App) extractCLITarGz(path, entry, dst string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	gz, err := gzip.NewReader(file)
	if err != nil {
		return failed(UpdateFailureInstall, cliBadArchiveReason)
	}
	defer gz.Close()
	archive := tar.NewReader(gz)
	header, err := archive.Next()
	if err != nil || header.Name != entry || header.Typeflag != tar.TypeReg {
		return failed(UpdateFailureInstall, cliBadArchiveReason)
	}
	if err := a.writeExtracted(dst, archive); err != nil {
		return err
	}
	if _, err := archive.Next(); err != io.EOF {
		return failed(UpdateFailureInstall, cliBadArchiveReason)
	}
	return nil
}

// writeExtracted writes src to dst, refusing a CLI over cliExtractLimit.
func (a *App) writeExtracted(dst string, src io.Reader) error {
	limited := &io.LimitedReader{R: src, N: cliExtractLimit + 1}
	if err := a.cliRuntime.writeFile(dst, limited); err != nil {
		return failed(UpdateFailureInstall, cliBadArchiveReason)
	}
	if limited.N == 0 {
		return failed(UpdateFailureInstall, cliBadArchiveReason)
	}
	return nil
}
