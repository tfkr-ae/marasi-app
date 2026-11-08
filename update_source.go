package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/tfkr-ae/marasi-app/internal/marasicli"
)

// releaseSource reads Marasi App releases from the GitHub releases API at
// base (https://api.github.com/repos/<owner>/<repo>, or a fake in tests).
type releaseSource struct {
	base   string
	client *http.Client
}

// githubRelease is the part of a GitHub release the app reads.
type githubRelease struct {
	Tag        string
	Name       string
	Notes      string
	Page       string
	Prerelease bool
	Assets     []releaseAsset
}

// releaseAsset is a file attached to a release.
type releaseAsset struct {
	Name string
	Size int64
	URL  string
}

// asset returns the release's asset called name.
func (r githubRelease) asset(name string) (releaseAsset, bool) {
	for _, asset := range r.Assets {
		if asset.Name == name {
			return asset, true
		}
	}
	return releaseAsset{}, false
}

// errReleaseNotFound: GitHub has no such release (no release published yet,
// or the nightly is being republished).
var errReleaseNotFound = errors.New("release not found")

// latestRelease returns the latest release that is not a prerelease.
func (s releaseSource) latestRelease(ctx context.Context) (githubRelease, error) {
	return s.get(ctx, "/releases/latest")
}

// releaseByTag returns the release tagged tag, such as "nightly".
func (s releaseSource) releaseByTag(ctx context.Context, tag string) (githubRelease, error) {
	return s.get(ctx, "/releases/tags/"+url.PathEscape(tag))
}

func (s releaseSource) get(ctx context.Context, path string) (githubRelease, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimSuffix(s.base, "/")+path, nil)
	if err != nil {
		return githubRelease{}, fmt.Errorf("building the GitHub request: %w", err)
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "marasi-app")

	res, err := s.client.Do(req)
	if err != nil {
		return githubRelease{}, fmt.Errorf("could not reach GitHub: %w", unwrapURLError(err))
	}
	defer res.Body.Close()

	switch {
	case res.StatusCode == http.StatusNotFound:
		return githubRelease{}, errReleaseNotFound
	case res.StatusCode == http.StatusForbidden && res.Header.Get("X-RateLimit-Remaining") == "0",
		res.StatusCode == http.StatusTooManyRequests:
		return githubRelease{}, errors.New("GitHub's rate limit for update checks is used up; try again in an hour")
	case res.StatusCode != http.StatusOK:
		return githubRelease{}, fmt.Errorf("GitHub answered %s", res.Status)
	}

	var body marasicli.Release
	if err := json.NewDecoder(io.LimitReader(res.Body, 4<<20)).Decode(&body); err != nil {
		return githubRelease{}, fmt.Errorf("reading GitHub's answer: %w", err)
	}
	release := githubRelease{
		Tag:        body.TagName,
		Name:       body.Name,
		Notes:      body.Body,
		Page:       body.HTMLURL,
		Prerelease: body.Prerelease,
	}
	for _, asset := range body.Assets {
		release.Assets = append(release.Assets, releaseAsset{Name: asset.Name, Size: asset.Size, URL: asset.URL})
	}
	return release, nil
}

// unwrapURLError drops the "Get <url>:" prefix net/http adds, which repeats
// the API address in a message meant for a researcher.
func unwrapURLError(err error) error {
	var urlErr *url.Error
	if errors.As(err, &urlErr) {
		return urlErr.Err
	}
	return err
}
