package main

import (
	"testing"
	"time"

	"github.com/google/uuid"
	marasi "github.com/tfkr-ae/marasi"
	"github.com/tfkr-ae/marasi/domain"
)

type interruptedRunRepo struct {
	domain.ArmoryRepository
	template *domain.ArmoryTemplate
	runs     []*domain.ArmoryRun
	updated  []*domain.ArmoryRun
}

type activeRunRepo struct {
	domain.ArmoryRepository
	run     *domain.ArmoryRun
	deleted bool
}

func (repo *activeRunRepo) GetArmoryRun(uuid.UUID) (*domain.ArmoryRun, error) {
	return repo.run, nil
}

func (repo *activeRunRepo) DeleteArmoryTemplate(uuid.UUID) error {
	repo.deleted = true
	return nil
}

type activeArmoryService struct {
	marasi.ArmoryService
	repo domain.ArmoryRepository
	ids  []uuid.UUID
}

func (service *activeArmoryService) Repo() domain.ArmoryRepository {
	return service.repo
}

func (service *activeArmoryService) ActiveRunIDs() []uuid.UUID {
	return service.ids
}

func (repo *interruptedRunRepo) GetArmoryTemplates() ([]*domain.ArmoryTemplate, error) {
	return []*domain.ArmoryTemplate{repo.template}, nil
}

func (repo *interruptedRunRepo) GetArmoryRuns(uuid.UUID) ([]*domain.ArmoryRun, error) {
	return repo.runs, nil
}

func (repo *interruptedRunRepo) UpdateArmoryRun(run *domain.ArmoryRun) error {
	repo.updated = append(repo.updated, run)
	return nil
}

func TestRecoverInterruptedArmoryRuns(t *testing.T) {
	templateID := uuid.Must(uuid.NewV7())
	active := &domain.ArmoryRun{ID: uuid.Must(uuid.NewV7()), TemplateID: templateID, Status: domain.ArmoryRunInProgress}
	complete := &domain.ArmoryRun{ID: uuid.Must(uuid.NewV7()), TemplateID: templateID, Status: domain.ArmoryRunCompleted}
	repo := &interruptedRunRepo{
		template: &domain.ArmoryTemplate{ID: templateID},
		runs:     []*domain.ArmoryRun{active, complete},
	}

	before := time.Now()
	if err := recoverInterruptedArmoryRuns(repo); err != nil {
		t.Fatalf("recovering interrupted runs: %v", err)
	}
	if len(repo.updated) != 1 || repo.updated[0] != active {
		t.Fatalf("wanted only the interrupted run updated, got %v", repo.updated)
	}
	if active.Status != domain.ArmoryRunCancelled {
		t.Fatalf("wanted cancelled status, got %s", active.Status)
	}
	if active.FinishedAt == nil || active.FinishedAt.Before(before) {
		t.Fatalf("wanted a recovery finish time, got %v", active.FinishedAt)
	}
	if complete.FinishedAt != nil {
		t.Fatalf("wanted completed run unchanged, got finish time %v", complete.FinishedAt)
	}
}

func TestDeleteArmoryTemplateRejectsActiveRun(t *testing.T) {
	templateID := uuid.Must(uuid.NewV7())
	runID := uuid.Must(uuid.NewV7())
	repo := &activeRunRepo{run: &domain.ArmoryRun{ID: runID, TemplateID: templateID}}
	app := &App{Proxy: &marasi.Proxy{Armory: &activeArmoryService{repo: repo, ids: []uuid.UUID{runID}}}}

	if err := app.DeleteArmoryTemplate(templateID); err == nil {
		t.Fatal("wanted active template deletion rejected")
	}
	if repo.deleted {
		t.Fatal("active template was deleted")
	}
}
