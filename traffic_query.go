package main

import (
	"errors"
	"fmt"
	"strconv"

	"github.com/google/uuid"
	"github.com/tfkr-ae/marasi/domain"
)

// trafficQueryPageSize is the number of pairs a QueryTraffic page holds when
// the request names no limit.
const trafficQueryPageSize = 500

// maxTrafficQueryPageSize bounds the pairs one QueryTraffic page may ask for.
const maxTrafficQueryPageSize = 1000

// TrafficPageRequest asks for one page of the project's traffic.
type TrafficPageRequest struct {
	Query string
	// OrderBy is one field with an optional " desc", as Marasi sorts
	// (requested_at, method, host, path, status_code, content_type, length).
	// "" is "requested_at desc".
	OrderBy string
	// Cursor is "" for the first page (the last page when Direction is
	// "backward"), else a NextCursor or PrevCursor from an earlier page under
	// the same OrderBy. The page starts just past it.
	Cursor string
	// Direction is "backward" to read the rows before Cursor; anything else
	// reads the rows after it.
	Direction string
	// AsOf is "" for the newest pair at read time, else an AsOf from an
	// earlier page, so every page of one set of results lists the same pairs.
	AsOf string
	// Limit is the page's size; 0 is trafficQueryPageSize.
	Limit int
	// IgnoreExclusion lists the pairs the content-type exclusion hides too.
	IgnoreExclusion bool
}

// TrafficQueryResult is one page of a project's traffic, in display order.
type TrafficQueryResult struct {
	Items      []*domain.RequestResponseSummary
	NextCursor *string // cursor at the page's last row; nil when nothing follows
	PrevCursor *string // cursor at the page's first row; nil when nothing precedes
	// AsOf bounds the results; pass it back on every later page. "" when the
	// project has no pairs.
	AsOf          string
	IndexComplete bool
	QueryError    *TrafficQueryError // nil when the query is valid
}

// TrafficQueryError reports an invalid query in the researcher's own text.
type TrafficQueryError struct {
	Message  string
	Position int // 1-based offset into the researcher's query text; 0 when the fault is in the exclusion or the sort
}

// QueryTraffic reads one page of the project's traffic that matches the
// researcher's query, minus the project's content-type exclusion unless req
// ignores it.
func (a *App) QueryTraffic(req TrafficPageRequest) (TrafficQueryResult, error) {
	traffic, err := a.Proxy.GetTrafficRepo()
	if err != nil {
		return TrafficQueryResult{}, fmt.Errorf("querying traffic: %w", err)
	}
	var exclusion []string
	if !req.IgnoreExclusion {
		exclusion, err = a.GetContentTypeExclusion()
		if err != nil {
			return TrafficQueryResult{}, fmt.Errorf("querying traffic: %w", err)
		}
	}
	asOf, err := parseOptionalPairID("as_of", req.AsOf)
	if err != nil {
		return TrafficQueryResult{}, fmt.Errorf("querying traffic: %w", err)
	}
	limit := req.Limit
	if limit <= 0 {
		limit = trafficQueryPageSize
	}
	limit = min(limit, maxTrafficQueryPageSize)
	direction := domain.Forward
	if req.Direction == "backward" {
		direction = domain.Backward
	}
	page, err := traffic.ListTraffic(domain.TrafficQuery{
		Text:      req.Query,
		Exclusion: exclusion,
		OrderBy:   req.OrderBy,
		Cursor:    req.Cursor,
		Direction: direction,
		AsOf:      asOf,
		Limit:     limit,
	})
	if queryErr, ok := asQueryError(err); ok {
		return TrafficQueryResult{QueryError: queryErr}, nil
	}
	if err != nil {
		return TrafficQueryResult{}, fmt.Errorf("querying traffic: %w", err)
	}
	result := TrafficQueryResult{
		Items:         page.Items,
		NextCursor:    page.NextCursor,
		PrevCursor:    page.PrevCursor,
		IndexComplete: searchIndexComplete(page.Complete),
	}
	if page.AsOf != nil {
		result.AsOf = page.AsOf.String()
	}
	return result, nil
}

// QueryArmoryRunTraffic reads one page of the pairs an Armory run sent,
// whatever their content type, as QueryTraffic reads the project's. req.Query
// narrows the run further ("" for all of it, or a group such as
// `status_code = 403`); req.OrderBy "" is "requested_at", oldest first.
func (a *App) QueryArmoryRunTraffic(runID string, req TrafficPageRequest) (TrafficQueryResult, error) {
	query, err := armoryRunQuery(runID)
	if err != nil {
		return TrafficQueryResult{}, fmt.Errorf("querying run traffic: %w", err)
	}
	if req.Query != "" {
		query += " AND (" + req.Query + ")"
	}
	req.Query = query
	if req.OrderBy == "" {
		req.OrderBy = "requested_at"
	}
	req.IgnoreExclusion = true
	return a.QueryTraffic(req)
}

// ArmoryRunTrafficCounts is an Armory run's pairs counted by one field.
type ArmoryRunTrafficCounts struct {
	// Counts holds each distinct value with its exact count, most common
	// first. Pairs with no response yet count under "".
	Counts []*domain.TrafficFieldCount
	// AsOf bounds the counts: only pairs with an id at or below it count.
	// A query Selection of the run or a group passes it as its as_of.
	// "" when the project has no pairs.
	AsOf string
}

// CountArmoryRunTraffic counts an Armory run's pairs, whatever their content
// type, by field ("status_code" or "length") under asOf, or under the newest
// pair when asOf is "": each distinct value with its exact count, most
// common first, and the as_of used. A malformed run id or as_of, or a field
// Marasi cannot count by, is a Go error.
func (a *App) CountArmoryRunTraffic(runID string, field string, asOf string) (ArmoryRunTrafficCounts, error) {
	query, err := armoryRunQuery(runID)
	if err != nil {
		return ArmoryRunTrafficCounts{}, fmt.Errorf("counting run traffic: %w", err)
	}
	if asOf == "" {
		// A one-pair read reports the newest pair as its bound.
		page, err := a.QueryArmoryRunTraffic(runID, TrafficPageRequest{Limit: 1})
		if err != nil {
			return ArmoryRunTrafficCounts{}, fmt.Errorf("counting run traffic: %w", err)
		}
		asOf = page.AsOf
	}
	bound, err := parseOptionalPairID("as_of", asOf)
	if err != nil {
		return ArmoryRunTrafficCounts{}, fmt.Errorf("counting run traffic: %w", err)
	}
	traffic, err := a.Proxy.GetTrafficRepo()
	if err != nil {
		return ArmoryRunTrafficCounts{}, fmt.Errorf("counting run traffic: %w", err)
	}
	counts, err := traffic.CountTrafficByField(domain.TrafficFieldCountQuery{Text: query, Field: field, AsOf: bound})
	if err != nil {
		return ArmoryRunTrafficCounts{}, fmt.Errorf("counting run traffic: %w", err)
	}
	return ArmoryRunTrafficCounts{Counts: counts.Counts, AsOf: asOf}, nil
}

// armoryRunQuery is the traffic query for the pairs the Armory run runID
// sent. Marasi indexes it.
func armoryRunQuery(runID string) (string, error) {
	id, err := uuid.Parse(runID)
	if err != nil {
		return "", fmt.Errorf("run id %q: %w", runID, err)
	}
	return "metadata.armory_run_id = " + strconv.Quote(id.String()), nil
}

// parseOptionalPairID parses a pair id the frontend passed back, or returns
// nil for "".
func parseOptionalPairID(name, value string) (*uuid.UUID, error) {
	if value == "" {
		return nil, nil
	}
	id, err := uuid.Parse(value)
	if err != nil {
		return nil, fmt.Errorf("%s %q is not a pair id: %w", name, value, err)
	}
	return &id, nil
}

// searchIndexComplete reports whether every search index job has finished.
func searchIndexComplete(complete map[domain.JobName]bool) bool {
	for _, job := range domain.SearchIndexJobs {
		if !complete[job] {
			return false
		}
	}
	return true
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
