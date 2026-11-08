package main

import (
	"slices"
	"testing"
	"time"
)

// ownerApp is an App on cli that has started the Local instance's run
// "run-app", so it owns that run. cli then answers the quit's status check
// and stop.
func ownerApp(t *testing.T, cli *fakeCLI) *App {
	t.Helper()
	cli.answer("service status", 1, notRunning).
		answer("service status", 0, runOf("run-app")).
		answer("service start", 0, started).
		answer("service control pair", 0, paired).
		answer("service status", 0, runOf("run-app")).
		answer("service stop", 0, stopped)
	app := quittingApp(t, cli)
	if _, err := app.ConnectLocal(localConnectionID); err != nil {
		t.Fatal(err)
	}
	return app
}

// quitQuestions records each quit question the app asks, with the
// connections it names, on the returned channel.
func quitQuestions(app *App) <-chan QuitQuestion {
	asked := make(chan QuitQuestion, 4)
	app.emitEvent = func(name string, data ...any) {
		if name != quitQuestionEvent {
			return
		}
		question, _ := data[0].(QuitQuestion)
		asked <- question
	}
	return asked
}

func waitForQuestion(t *testing.T, asked <-chan QuitQuestion) QuitQuestion {
	t.Helper()
	select {
	case question := <-asked:
		return question
	case <-time.After(5 * time.Second):
		t.Fatal("wanted the quit question asked")
		return QuitQuestion{}
	}
}

// quitAnswering quits app and answers the quit question with answer, and
// reports whether Marasi quit, then runs the shutdown when it did.
func quitAnswering(t *testing.T, app *App, answer string, remember bool) bool {
	t.Helper()
	asked := quitQuestions(app)
	quit := recordQuits(app)
	if app.shouldQuit() {
		t.Fatal("wanted the quit held for the question")
	}
	waitForQuestion(t, asked)
	app.AnswerQuitQuestion(answer, remember)
	waitUntilAnswered(t, app)
	select {
	case <-quit:
		app.ServiceShutdown()
		return true
	case <-time.After(50 * time.Millisecond):
		return false
	}
}

func setWhenQuitting(t *testing.T, app *App, value string) {
	t.Helper()
	if err := app.Config.SetFlag(whenQuittingKey, value); err != nil {
		t.Fatal(err)
	}
}

func TestQuittingAsksAboutAnOwnedRunAndStopsItOnStop(t *testing.T) {
	cli := &fakeCLI{}
	app := ownerApp(t, cli)
	setWhenQuitting(t, app, whenQuittingAsk)

	if !quitAnswering(t, app, quitAnswerStop, false) {
		t.Fatal("wanted Stop to quit Marasi")
	}
	if cli.stops() != 1 {
		t.Fatalf("stopped the owned run %d times, want once (calls %v)", cli.stops(), cli.subcommands())
	}
}

func TestKeepRunningQuitsAndStopsNothing(t *testing.T) {
	cli := &fakeCLI{}
	app := ownerApp(t, cli)
	setWhenQuitting(t, app, whenQuittingAsk)

	if !quitAnswering(t, app, quitAnswerKeep, false) {
		t.Fatal("wanted Keep running to quit Marasi")
	}
	if cli.stops() != 0 {
		t.Fatalf("Keep running stopped the owned run (calls %v)", cli.subcommands())
	}
}

func TestCancellingTheQuitQuestionKeepsMarasiOpen(t *testing.T) {
	cli := &fakeCLI{}
	app := ownerApp(t, cli)
	setWhenQuitting(t, app, whenQuittingAsk)

	if quitAnswering(t, app, quitAnswerCancel, true) {
		t.Fatal("wanted Cancel to keep Marasi open")
	}
	if cli.stops() != 0 {
		t.Fatalf("Cancel stopped the owned run (calls %v)", cli.subcommands())
	}
	if got := app.Config.WhenQuitting; got != whenQuittingAsk {
		t.Fatalf("Cancel saved When quitting %q, want it left at ask", got)
	}
	// The next quit asks again.
	if !quitAnswering(t, app, quitAnswerStop, false) {
		t.Fatal("wanted the next quit to ask again and quit")
	}
}

func TestDontAskAgainSavesTheChoice(t *testing.T) {
	for answer, saved := range map[string]string{quitAnswerKeep: whenQuittingKeep, quitAnswerStop: whenQuittingStop} {
		t.Run(answer, func(t *testing.T) {
			cli := &fakeCLI{}
			app := ownerApp(t, cli)
			setWhenQuitting(t, app, whenQuittingAsk)

			quitAnswering(t, app, answer, true)

			// It is in the app config, so a relaunch has it too.
			relaunched := relaunchedApp(t, app, &fakeCLI{})
			if got := relaunched.Config.WhenQuitting; got != saved {
				t.Fatalf("saved When quitting %q, want %q", got, saved)
			}
		})
	}
}

func TestWhenQuittingAsksByDefault(t *testing.T) {
	app := newTestApp(t)
	if got := app.Config.WhenQuitting; got != whenQuittingAsk {
		t.Fatalf("When quitting is %q by default, want ask", got)
	}
}

func TestASavedWhenQuittingDoesNotAsk(t *testing.T) {
	for setting, wantStops := range map[string]int{whenQuittingKeep: 0, whenQuittingStop: 1} {
		t.Run(setting, func(t *testing.T) {
			cli := &fakeCLI{}
			app := ownerApp(t, cli)
			setWhenQuitting(t, app, setting)
			asked := quitQuestions(app)
			quit := recordQuits(app)

			app.quitApp()
			waitForQuit(t, quit)
			app.ServiceShutdown()

			if len(asked) != 0 {
				t.Fatal("asked the quit question with When quitting saved")
			}
			if cli.stops() != wantStops {
				t.Fatalf("stopped the owned run %d times, want %d (calls %v)", cli.stops(), wantStops, cli.subcommands())
			}
		})
	}
}

func TestQuittingWithoutAnOwnedRunDoesNotAsk(t *testing.T) {
	cli := (&fakeCLI{}).
		answer("service status", 0, runOf("run-other")).
		answer("service control pair", 0, paired).
		answer("service stop", 0, stopped)
	app := quittingApp(t, cli)
	setWhenQuitting(t, app, whenQuittingAsk)
	if _, err := app.ConnectLocal(localConnectionID); err != nil {
		t.Fatal(err)
	}
	asked := quitQuestions(app)
	quit := recordQuits(app)

	app.quitApp()
	waitForQuit(t, quit)
	app.ServiceShutdown()

	if len(asked) != 0 || cli.stops() != 0 {
		t.Fatalf("asked %d times and stopped %d times about a run the app doesn't own", len(asked), cli.stops())
	}
}

func TestTheQuitQuestionComesAfterTheUnsavedWorkPrompt(t *testing.T) {
	cli := &fakeCLI{}
	app := ownerApp(t, cli)
	setWhenQuitting(t, app, whenQuittingAsk)
	app.SetUnsavedDraftCount(1)
	var order []string
	asked := make(chan struct{}, 1)
	app.messageDialog = func(messageDialogOptions) (string, error) {
		order = append(order, "unsaved work")
		return "Close Marasi", nil
	}
	app.emitEvent = func(name string, _ ...any) {
		if name == quitQuestionEvent {
			order = append(order, "quit question")
			asked <- struct{}{}
		}
	}
	quit := recordQuits(app)

	app.shouldQuit()
	<-asked
	app.AnswerQuitQuestion(quitAnswerKeep, false)
	waitForQuit(t, quit)

	if !slices.Equal(order, []string{"unsaved work", "quit question"}) {
		t.Fatalf("asked %v, want the unsaved-work prompt then the quit question", order)
	}
}

func TestCancellingTheUnsavedWorkPromptDoesNotAskAboutMarasi(t *testing.T) {
	cli := &fakeCLI{}
	app := ownerApp(t, cli)
	setWhenQuitting(t, app, whenQuittingAsk)
	app.SetUnsavedDraftCount(1)
	withDialog(app, "Cancel")
	asked := quitQuestions(app)

	if prevent := app.beforeClose(); !prevent {
		t.Fatal("wanted cancelling to keep Marasi open")
	}
	if len(asked) != 0 {
		t.Fatal("asked about Marasi after the quit was cancelled")
	}
}

func TestClosingTheWindowAsksAboutAnOwnedRun(t *testing.T) {
	cli := &fakeCLI{}
	app := ownerApp(t, cli)
	setWhenQuitting(t, app, whenQuittingAsk)
	asked := quitQuestions(app)
	quit := recordQuits(app)
	go func() {
		waitForQuestion(t, asked)
		app.AnswerQuitQuestion(quitAnswerStop, false)
	}()

	app.windowClosing(func() {})
	waitForQuit(t, quit)
	app.ServiceShutdown()

	if cli.stops() != 1 {
		t.Fatalf("stopped the owned run %d times, want once (calls %v)", cli.stops(), cli.subcommands())
	}
}

func TestRestartNowNeverAsksAndNeverStops(t *testing.T) {
	for _, setting := range []string{whenQuittingAsk, whenQuittingStop} {
		t.Run(setting, func(t *testing.T) {
			app, _ := newInstalledApp(t)
			cli := &fakeCLI{}
			cli.answer("service status", 1, notRunning).
				answer("service status", 0, runOf("run-app")).
				answer("service start", 0, started).
				answer("service control pair", 0, paired).
				answer("service status", 0, runOf("run-app")).
				answer("service stop", 0, stopped)
			app.runCLI = cli.run
			app.findCLI = func() (string, error) { return "/bin/marasi", nil }
			app.newPassword = func() (string, error) { return "generated", nil }
			if _, err := app.ConnectLocal(localConnectionID); err != nil {
				t.Fatal(err)
			}
			setWhenQuitting(t, app, setting)
			asked := quitQuestions(app)
			recordRestarts(app)

			if restarted, err := app.RestartToUpdate(); !restarted || err != nil {
				t.Fatalf("wanted Marasi to restart, got %v %v", restarted, err)
			}
			if len(asked) != 0 {
				t.Fatal("Restart now asked the quit question")
			}
			if cli.stops() != 0 {
				t.Fatalf("Restart now stopped the owned run (calls %v)", cli.subcommands())
			}
		})
	}
}

func TestTheQuitQuestionNamesEveryOwnedLocalConnectionAndNoRemote(t *testing.T) {
	cli := &fakeCLI{}
	app := ownerApp(t, cli)
	setWhenQuitting(t, app, whenQuittingAsk)
	remote, err := app.AddConnection(NewConnection{Name: "Lab", URL: "http://10.0.0.5:9000", NoPassword: true})
	if err != nil {
		t.Fatal(err)
	}
	// A record against a remote can't come from the app, but if one did,
	// quitting must neither name nor stop it.
	app.saveOwnedRun(remote.ID, "run-remote")
	asked := quitQuestions(app)
	recordQuits(app)

	app.shouldQuit()
	question := waitForQuestion(t, asked)
	app.AnswerQuitQuestion(quitAnswerStop, false)
	waitUntilAnswered(t, app)
	app.ServiceShutdown()

	if !slices.Equal(question.Connections, []string{"Local"}) {
		t.Fatalf("the question named %v, want [Local]", question.Connections)
	}
	if cli.stops() != 1 {
		t.Fatalf("stopped %d times, want only the Local run (calls %v)", cli.stops(), cli.subcommands())
	}
}

func TestStopLeavesARunTheAppDoesNotOwnRunning(t *testing.T) {
	cli := (&fakeCLI{}).
		answer("service status", 1, notRunning).
		answer("service status", 0, runOf("run-app")).
		answer("service start", 0, started).
		answer("service control pair", 0, paired).
		// By the time the researcher answers, another client has replaced
		// the app's run.
		answer("service status", 0, runOf("run-other")).
		answer("service stop", 0, stopped)
	app := quittingApp(t, cli)
	setWhenQuitting(t, app, whenQuittingAsk)
	if _, err := app.ConnectLocal(localConnectionID); err != nil {
		t.Fatal(err)
	}

	if !quitAnswering(t, app, quitAnswerStop, false) {
		t.Fatal("wanted Stop to quit Marasi")
	}
	if cli.stops() != 0 {
		t.Fatalf("Stop stopped another client's run (calls %v)", cli.subcommands())
	}
}
