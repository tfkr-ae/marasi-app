package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/google/uuid"
	"github.com/tfkr-ae/marasi/domain"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

func (a *App) CreateDraftFinding(requests []uuid.UUID, tcUUID *uuid.UUID) (*domain.Finding, error) {
	findingUUID, err := uuid.NewV7()
	if err != nil {
		return nil, fmt.Errorf("generating uuid for finindg : %w", err)
	}

	draftFinding := &domain.Finding{
		ID:            findingUUID,
		TestCaseID:    tcUUID,
		Title:         "Draft Finding",
		Requests:      requests,
		CVSSVector:    "",
		CVSSScore:     0.0,
		TreatmentPlan: "",
		Severity:      "High",
		WriteUp:       "Writeup",
		Artifacts:     make([]*domain.ArtifactMetadata, 0),
	}

	err = a.Proxy.ReportingRepo.SaveFinding(draftFinding)
	if err != nil {
		return nil, fmt.Errorf("creating draft finding : %w", err)
	}
	return draftFinding, nil
}
func (a *App) CreateDraftTestCase(requests []uuid.UUID) (*domain.TestCase, error) {
	tcUUID, err := uuid.NewV7()
	if err != nil {
		return nil, fmt.Errorf("generating uuid for test case : %w", err)
	}
	draftTC := &domain.TestCase{
		ID:          tcUUID,
		Title:       "Draft Test Case",
		Description: "Test Case Description",
		Category:    "XSS",
		Tags:        []string{},
		Requests:    requests,
		Artifacts:   make([]*domain.ArtifactMetadata, 0),
		Note:        "Test Note",
	}

	err = a.Proxy.ReportingRepo.SaveTestCase(draftTC)
	if err != nil {
		return nil, fmt.Errorf("creating draft test case : %w", err)
	}

	return draftTC, nil
}

func (a *App) SaveTestCase(tc *domain.TestCase) error {
	return a.Proxy.ReportingRepo.SaveTestCase(tc)
}

func (a *App) SaveFinding(fnd *domain.Finding) error {
	return a.Proxy.ReportingRepo.SaveFinding(fnd)
}

func (a *App) DeleteTestCase(tcUUID uuid.UUID) error {
	return a.Proxy.ReportingRepo.DeleteTestCase(tcUUID)
}

func (a *App) DeleteFinding(findingUUID uuid.UUID) error {
	return a.Proxy.ReportingRepo.DeleteFinding(findingUUID)
}

func (a *App) ListTestCases() ([]*domain.TestCase, error) {
	return a.Proxy.ReportingRepo.ListTestCases()
}

func (a *App) ListFindings() ([]*domain.Finding, error) {
	return a.Proxy.ReportingRepo.ListFindings()
}

func (a *App) LinkRequestToTestCase(tcUUID, requestUUID uuid.UUID) error {
	return a.Proxy.ReportingRepo.LinkRequestToTestCase(tcUUID, requestUUID)
}

func (a *App) UnlinkRequestFromTestCase(tcUUID, requestUUID uuid.UUID) error {
	return a.Proxy.ReportingRepo.UnlinkRequestFromTestCase(tcUUID, requestUUID)
}

func (a *App) LinkRequestToFinding(findingUUID, requestUUID uuid.UUID) error {
	return a.Proxy.ReportingRepo.LinkRequestToFinding(findingUUID, requestUUID)
}

func (a *App) UnlinkRequestFromFinding(findingUUID, requestUUID uuid.UUID) error {
	return a.Proxy.ReportingRepo.UnlinkRequestFromFinding(findingUUID, requestUUID)
}

func (a *App) SaveArtifactToFinding(findingUUID uuid.UUID, filename, mimetype string, size int64, data []byte) (*domain.ArtifactMetadata, error) {
	artifactUUID, err := uuid.NewV7()
	if err != nil {
		return nil, fmt.Errorf("generating uuid for artifact : %w", err)
	}

	artifact := &domain.Artifact{
		ArtifactMetadata: &domain.ArtifactMetadata{
			ID:       artifactUUID,
			Filename: filename,
			MimeType: mimetype,
			Size:     size,
		},
		FindingID: &findingUUID,
		Data:      data,
	}

	err = a.Proxy.ReportingRepo.SaveArtifact(artifact)
	if err != nil {
		return nil, err
	}
	return artifact.ArtifactMetadata, nil
}

func (a *App) SaveArtifactToTestCase(tcUUID uuid.UUID, filename, mimetype string, size int64, data []byte) (*domain.ArtifactMetadata, error) {
	artifactUUID, err := uuid.NewV7()
	if err != nil {
		return nil, fmt.Errorf("generating uuid for artifact : %w", err)
	}

	artifact := &domain.Artifact{
		ArtifactMetadata: &domain.ArtifactMetadata{
			ID:       artifactUUID,
			Filename: filename,
			MimeType: mimetype,
			Size:     size,
		},
		TestCaseID: &tcUUID,
		Data:       data,
	}

	err = a.Proxy.ReportingRepo.SaveArtifact(artifact)
	if err != nil {
		return nil, err
	}
	return artifact.ArtifactMetadata, nil
}

func (a *App) GetArtifact(artifactUUID uuid.UUID) (*domain.Artifact, error) {
	return a.Proxy.ReportingRepo.GetArtifact(artifactUUID)
}

func (a *App) DeleteArtifact(artifactUUID uuid.UUID) error {
	return a.Proxy.ReportingRepo.DeleteArtifact(artifactUUID)
}

func (a *App) DownloadArtifact(artifactUUID uuid.UUID) (bool, error) {
	art, err := a.Proxy.ReportingRepo.GetArtifact(artifactUUID)
	if err != nil {
		return false, err
	}

	home, _ := os.UserHomeDir()
	safeFilename := filepath.Base(art.Filename)

	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		DefaultDirectory: filepath.Join(home, "Downloads"),
		DefaultFilename:  safeFilename,
		Title:            "Save Artifact",
	})

	if err != nil {
		return false, err
	}

	if path == "" {
		return false, nil
	}

	err = os.WriteFile(path, art.Data, 0600)
	if err != nil {
		return false, err
	}

	return true, nil
}
