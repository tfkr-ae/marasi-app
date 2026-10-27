package main

import (
	"strings"
	"testing"
	"time"

	"github.com/tfkr-ae/marasi/domain"
)

func TestAppReportPayload(t *testing.T) {
	t.Run("should include the test cases by default", func(t *testing.T) {
		app := newLogbookApp(t)

		payload, err := app.buildReportPayload(reportMetadata(map[string]any{}))
		if err != nil {
			t.Fatalf("building payload: %v", err)
		}

		if len(payload.TestCases) != 1 || len(payload.Findings) != 1 {
			t.Fatalf("wanted: 1 test case and 1 finding\ngot: %d test cases and %d findings", len(payload.TestCases), len(payload.Findings))
		}
	})

	t.Run("should include the test cases when include_test_cases is true", func(t *testing.T) {
		app := newLogbookApp(t)

		payload, err := app.buildReportPayload(reportMetadata(map[string]any{"include_test_cases": true}))
		if err != nil {
			t.Fatalf("building payload: %v", err)
		}

		if len(payload.TestCases) != 1 {
			t.Fatalf("wanted: 1 test case\ngot: %d", len(payload.TestCases))
		}
	})

	t.Run("should leave the test cases out when include_test_cases is false", func(t *testing.T) {
		app := newLogbookApp(t)

		payload, err := app.buildReportPayload(reportMetadata(map[string]any{"include_test_cases": false}))
		if err != nil {
			t.Fatalf("building payload: %v", err)
		}

		if len(payload.TestCases) != 0 || len(payload.Findings) != 1 {
			t.Fatalf("wanted: 0 test cases and 1 finding\ngot: %d test cases and %d findings", len(payload.TestCases), len(payload.Findings))
		}
	})

	t.Run("should drop the default template's Test Cases section when include_test_cases is false", func(t *testing.T) {
		app := newLogbookApp(t)

		with := renderDefaultReport(t, app, map[string]any{})
		without := renderDefaultReport(t, app, map[string]any{"include_test_cases": false})

		if !strings.Contains(with, "# Test Cases") {
			t.Fatalf("wanted: a Test Cases section by default\ngot:\n%s", with)
		}
		if strings.Contains(without, "# Test Cases") || strings.Contains(without, "Report test case") {
			t.Fatalf("wanted: no Test Cases section\ngot:\n%s", without)
		}
		if !strings.Contains(without, "Report finding") {
			t.Fatalf("wanted: the finding still in the report\ngot:\n%s", without)
		}
	})
}

// newLogbookApp opens the scratchpad with one titled finding and one titled
// test case.
func newLogbookApp(t *testing.T) *App {
	t.Helper()
	app := newScratchpadApp(t)
	testCase, err := app.CreateDraftTestCase(nil)
	if err != nil {
		t.Fatalf("creating test case: %v", err)
	}
	testCase.Title = "Report test case"
	if err := app.SaveTestCase(testCase); err != nil {
		t.Fatalf("saving test case: %v", err)
	}
	finding, err := app.CreateDraftFinding(nil, nil)
	if err != nil {
		t.Fatalf("creating finding: %v", err)
	}
	finding.Title = "Report finding"
	if err := app.SaveFinding(finding); err != nil {
		t.Fatalf("saving finding: %v", err)
	}
	return app
}

func reportMetadata(custom map[string]any) domain.ReportMetadata {
	now := time.Now()
	return domain.ReportMetadata{
		Title:            "Report",
		Start:            now,
		End:              now,
		CreatedAt:        now,
		CustomProperties: custom,
	}
}

func renderDefaultReport(t *testing.T, app *App, custom map[string]any) string {
	t.Helper()
	payload, err := app.buildReportPayload(reportMetadata(custom))
	if err != nil {
		t.Fatalf("building payload: %v", err)
	}
	template, err := app.Proxy.ReportGenerator.LoadTemplate("default_template.md")
	if err != nil {
		t.Fatalf("loading default template: %v", err)
	}
	report, err := app.Proxy.ReportGenerator.Execute(template, payload)
	if err != nil {
		t.Fatalf("rendering report: %v", err)
	}
	return string(report)
}
