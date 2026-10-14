package main

import (
	"fmt"

	"github.com/tfkr-ae/marasi/domain"
)

// CountContentTypes returns every content type in the project with its pair
// count, most common first, for the Ledger's Types menu. Excluded types are
// counted too. Pairs still waiting for a response count under "".
func (a *App) CountContentTypes() ([]*domain.ContentTypeCount, error) {
	traffic, err := a.Proxy.GetTrafficRepo()
	if err != nil {
		return nil, fmt.Errorf("counting content types: %w", err)
	}
	counts, err := traffic.CountContentTypes()
	if err != nil {
		return nil, fmt.Errorf("counting content types: %w", err)
	}
	return counts, nil
}
