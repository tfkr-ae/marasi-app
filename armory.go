package main

import (
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/tfkr-ae/marasi/domain"
	"github.com/tfkr-ae/marasi/wordlist"
)

// GetArmoryTemplates returns all templates in the active project.
func (a *App) GetArmoryTemplates() ([]*domain.ArmoryTemplate, error) {
	return a.Proxy.Armory.Repo().GetArmoryTemplates()
}

// CreateArmoryTemplate creates a template in the active project.
func (a *App) CreateArmoryTemplate(name, description, rawTemplate string) (*domain.ArmoryTemplate, error) {
	id, err := uuid.NewV7()
	if err != nil {
		return nil, fmt.Errorf("creating armory template ID: %w", err)
	}

	template := &domain.ArmoryTemplate{ID: id, Name: name, Description: description, RawTemplate: rawTemplate}
	if err := a.Proxy.Armory.Repo().CreateArmoryTemplate(template); err != nil {
		return nil, err
	}
	return template, nil
}

// CreateArmoryTemplateFromRequest creates a template from a captured request.
func (a *App) CreateArmoryTemplateFromRequest(requestID uuid.UUID) (*domain.ArmoryTemplate, error) {
	row, err := a.Proxy.TrafficRepo.GetRequestResponseRow(requestID)
	if err != nil {
		return nil, err
	}
	name := fmt.Sprintf("%s %s%s", row.Request.Method, row.Request.Host, row.Request.Path)
	return a.CreateArmoryTemplate(name, "Imported from request history", string(row.Request.Raw))
}

// UpdateArmoryTemplate updates a template in the active project.
func (a *App) UpdateArmoryTemplate(id uuid.UUID, name, description, rawTemplate string) error {
	return a.Proxy.Armory.Repo().UpdateArmoryTemplate(&domain.ArmoryTemplate{
		ID: id, Name: name, Description: description, RawTemplate: rawTemplate,
	})
}

// DeleteArmoryTemplate deletes a template from the active project.
func (a *App) DeleteArmoryTemplate(id uuid.UUID) error {
	for _, runID := range a.Proxy.Armory.ActiveRunIDs() {
		run, err := a.Proxy.Armory.Repo().GetArmoryRun(runID)
		if err != nil {
			return err
		}
		if run.TemplateID == id {
			return fmt.Errorf("cannot delete template with active armory runs")
		}
	}
	return a.Proxy.Armory.Repo().DeleteArmoryTemplate(id)
}

// GetArmoryRuns returns all runs created from a template.
func (a *App) GetArmoryRuns(templateID uuid.UUID) ([]*domain.ArmoryRun, error) {
	return a.Proxy.Armory.Repo().GetArmoryRuns(templateID)
}

// GetArmoryRun returns a run by ID.
func (a *App) GetArmoryRun(id uuid.UUID) (*domain.ArmoryRun, error) {
	return a.Proxy.Armory.Repo().GetArmoryRun(id)
}

// ValidateArmoryRun validates an unsaved run configuration.
func (a *App) ValidateArmoryRun(rawTemplate string, runType domain.ArmoryAttackType, wordlists []string, maxConcurrent int) error {
	return a.Proxy.Armory.ValidateRun(&domain.ArmoryRun{
		TemplateSnapshot: rawTemplate,
		Wordlists:        wordlists,
		Status:           domain.ArmoryRunDraft,
		AttackType:       runType,
		MaxConcurrent:    maxConcurrent,
	})
}

// CreateArmoryRun creates a draft run from the current template contents.
func (a *App) CreateArmoryRun(templateID uuid.UUID, runType domain.ArmoryAttackType, useHTTPS bool, wordlists []string, maxConcurrent int) (*domain.ArmoryRun, error) {
	template, err := a.Proxy.Armory.Repo().GetArmoryTemplate(templateID)
	if err != nil {
		return nil, err
	}
	id, err := uuid.NewV7()
	if err != nil {
		return nil, fmt.Errorf("creating armory run ID: %w", err)
	}

	run := &domain.ArmoryRun{
		ID:               id,
		TemplateID:       template.ID,
		TemplateSnapshot: template.RawTemplate,
		UseHTTPS:         useHTTPS,
		Wordlists:        wordlists,
		Status:           domain.ArmoryRunDraft,
		AttackType:       runType,
		MaxConcurrent:    maxConcurrent,
		CreatedAt:        time.Now(),
	}
	if err := a.Proxy.Armory.ValidateRun(run); err != nil {
		return nil, err
	}
	if err := a.Proxy.Armory.Repo().CreateArmoryRun(run); err != nil {
		return nil, err
	}
	return run, nil
}

// StartArmoryRun starts a persisted draft run.
func (a *App) StartArmoryRun(id uuid.UUID) error {
	return a.Proxy.Armory.StartRun(id)
}

// CancelArmoryRun cancels an active run.
func (a *App) CancelArmoryRun(id uuid.UUID) error {
	return a.Proxy.Armory.CancelRun(id)
}

// DeleteArmoryRun deletes a run from the active project.
func (a *App) DeleteArmoryRun(id uuid.UUID) error {
	for _, runID := range a.Proxy.Armory.ActiveRunIDs() {
		if runID == id {
			return fmt.Errorf("cannot delete an active armory run")
		}
	}
	return a.Proxy.Armory.Repo().DeleteArmoryRun(id)
}

// GetActiveArmoryRunIDs returns the active run IDs.
func (a *App) GetActiveArmoryRunIDs() []uuid.UUID {
	return a.Proxy.Armory.ActiveRunIDs()
}

// GetArmoryWordlists returns all available wordlists.
func (a *App) GetArmoryWordlists() ([]wordlist.Info, error) {
	return a.Proxy.WordlistManager.List()
}

// PreviewArmoryWordlist returns the first entries from a wordlist.
func (a *App) PreviewArmoryWordlist(name string, limit int) ([]string, error) {
	iterator, err := a.Proxy.WordlistManager.Open(name)
	if err != nil {
		return nil, err
	}
	defer iterator.Close()

	entries := make([]string, 0)
	for len(entries) < limit && iterator.Scan() {
		entries = append(entries, iterator.Text())
	}
	if err := iterator.Err(); err != nil {
		return nil, err
	}
	return entries, nil
}

// GetArmoryRunRequests returns the requests associated with a run.
func (a *App) GetArmoryRunRequests(runID uuid.UUID) ([]*domain.RequestResponseRow, error) {
	entries, err := a.Proxy.Armory.Repo().GetArmoryEntries(runID)
	if err != nil {
		return nil, err
	}

	ids := make([]uuid.UUID, len(entries))
	for index, entry := range entries {
		ids[index] = entry.RequestID
	}
	if len(ids) == 0 {
		return []*domain.RequestResponseRow{}, nil
	}
	return a.Proxy.TrafficRepo.GetRequestResponseRows(ids)
}
