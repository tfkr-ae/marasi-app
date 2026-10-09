package main

import (
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/tfkr-ae/marasi/domain"
)

// trafficQueryPageSize is the largest page marasi's traffic query serves.
const trafficQueryPageSize = 500

// TrafficQueryResult is one page of query results, newest first.
type TrafficQueryResult struct {
	Items         []*domain.RequestResponseSummary
	NextCursor    *uuid.UUID // nil when no older page exists
	IndexComplete bool
	QueryError    *TrafficQueryError // nil when the query is valid
}

// TrafficQueryError reports an invalid query in the researcher's own text.
type TrafficQueryError struct {
	Message  string
	Position int // 1-based offset into the researcher's query text, as marasi reports it
}

// QueryTraffic runs the researcher's query against the project's traffic.
func (a *App) QueryTraffic(query string, cursor *uuid.UUID) (TrafficQueryResult, error) {
	traffic, err := a.Proxy.GetTrafficRepo()
	if err != nil {
		return TrafficQueryResult{}, fmt.Errorf("querying traffic: %w", err)
	}
	if a.Proxy.ConfigRepo == nil {
		return TrafficQueryResult{}, errors.New("querying traffic: no project is open")
	}
	excluded, err := a.Proxy.ConfigRepo.GetFilters()
	if err != nil {
		return TrafficQueryResult{}, fmt.Errorf("reading content-type exclusion: %w", err)
	}
	// Validate the researcher's text on its own first, so error positions
	// refer to what they typed and unbalanced parentheses can't pair up with
	// the parentheses added around it. Marasi has no standalone validator; a
	// one-row query is the cheapest way to parse.
	if _, _, _, err := traffic.ListTraffic(nil, 1, query); err != nil {
		if queryErr, ok := asQueryError(err); ok {
			return TrafficQueryResult{QueryError: queryErr}, nil
		}
		return TrafficQueryResult{}, fmt.Errorf("validating traffic query: %w", err)
	}
	exclusion := newContentTypeExclusion(excluded)
	items, next, indexComplete, err := traffic.ListTraffic(cursor, trafficQueryPageSize, exclusion.apply(query))
	if queryErr, ok := asQueryError(err); ok {
		return TrafficQueryResult{QueryError: queryErr}, nil
	}
	if err != nil {
		return TrafficQueryResult{}, fmt.Errorf("querying traffic: %w", err)
	}
	return TrafficQueryResult{Items: exclusion.filter(items), NextCursor: next, IndexComplete: indexComplete}, nil
}

// contentTypeExclusion hides the same pairs as the live view's exclusion,
// which matches stored content types exactly. Most values become
// content_type != terms in the query. Marasi reads a * at either end of a
// value as a wildcard and has no escape for it, so those values are matched
// exactly here instead, after the page is fetched. That can leave a page
// short, but the cursor still continues from the last pair marasi returned.
type contentTypeExclusion struct {
	queryTerms []string
	exact      map[string]bool
}

func newContentTypeExclusion(excluded []string) contentTypeExclusion {
	exclusion := contentTypeExclusion{exact: map[string]bool{}}
	for _, contentType := range excluded {
		switch {
		case contentType == "":
			// In-flight pairs have no content type; the live view shows them.
		case strings.HasPrefix(contentType, "*") || strings.HasSuffix(contentType, "*"):
			exclusion.exact[contentType] = true
		default:
			exclusion.queryTerms = append(exclusion.queryTerms, contentType)
		}
	}
	return exclusion
}

// apply ANDs the researcher's query, in parentheses, with one
// content_type != term per excluded type. Marasi's != keeps pairs without a
// content type, so in-flight pairs stay visible as in the live view.
func (e contentTypeExclusion) apply(query string) string {
	if len(e.queryTerms) == 0 {
		return query
	}
	var combined strings.Builder
	combined.WriteString("(" + query + ")")
	for _, contentType := range e.queryTerms {
		combined.WriteString(" AND content_type != " + aipString(contentType))
	}
	return combined.String()
}

func (e contentTypeExclusion) filter(items []*domain.RequestResponseSummary) []*domain.RequestResponseSummary {
	if len(e.exact) == 0 {
		return items
	}
	kept := items[:0]
	for _, item := range items {
		if !e.exact[item.ContentType] {
			kept = append(kept, item)
		}
	}
	return kept
}

// aipString writes s as an AIP-160 string literal.
func aipString(s string) string {
	return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(s) + `"`
}

// asQueryError reports whether err is marasi's invalid-query error. Wails turns
// Go errors into plain strings, so the binding returns it as data instead.
func asQueryError(err error) (*TrafficQueryError, bool) {
	var queryErr *domain.QueryError
	if !errors.As(err, &queryErr) {
		return nil, false
	}
	return &TrafficQueryError{Message: queryErr.Message, Position: queryErr.Position}, true
}
