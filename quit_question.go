package main

import (
	"log"
	"slices"
	"sync"
	"time"
)

// The quit question (spec "Owned runs and quitting"): when the app owns a
// run, quitting asks whether to stop Marasi too, after any unsaved-work
// prompt. The When quitting setting answers it ahead of time. Only owned
// runs (GLOSSARY "Owned run") are ever stopped, never another client's run
// or a remote, and "Restart now" never asks and never stops.

// whenQuittingKey is the When quitting setting in app config: ask (the
// default), keep or stop.
const whenQuittingKey = "when_quitting"

const (
	whenQuittingAsk  = "ask"
	whenQuittingKeep = "keep"
	whenQuittingStop = "stop"
)

// quitQuestionEvent asks the frontend "Stop Marasi too?". It carries a
// QuitQuestion and is answered through AnswerQuitQuestion.
const quitQuestionEvent = "quit-question"

// The answers to the quit question.
const (
	quitAnswerKeep   = "keep"
	quitAnswerStop   = "stop"
	quitAnswerCancel = "cancel"
)

// defaultQuitQuestionTimeout bounds the wait for an answer, so a frontend
// that can't answer doesn't leave Marasi unable to quit. No answer keeps
// Marasi running.
const defaultQuitQuestionTimeout = 5 * time.Minute

// QuitQuestion is quitQuestionEvent's payload: the saved names of the
// connections whose owned runs quitting would stop.
type QuitQuestion struct {
	Connections []string `json:"connections"`
}

type quitAnswer struct {
	answer   string
	remember bool
}

// quitQuestion holds the wait for the frontend's answer and the answer
// this quit got.
type quitQuestion struct {
	mu      sync.Mutex
	reply   chan quitAnswer
	timeout time.Duration
	// stop is set when this quit's answer was Stop.
	stop bool
	// answered is set once this quit has an answer, so ServiceShutdown
	// follows it rather than the setting.
	answered bool
}

// AnswerQuitQuestion is the frontend's answer to quitQuestionEvent: keep,
// stop or cancel, and whether to save keep or stop as When quitting.
func (a *App) AnswerQuitQuestion(answer string, remember bool) {
	a.quitQuestion.mu.Lock()
	reply := a.quitQuestion.reply
	a.quitQuestion.reply = nil
	a.quitQuestion.mu.Unlock()
	if reply != nil {
		reply <- quitAnswer{answer: answer, remember: remember}
	}
}

// whenQuitting is the When quitting setting; anything unknown reads as ask.
func (a *App) whenQuitting() string {
	if a.Config == nil {
		return whenQuittingAsk
	}
	a.Config.mu.Lock()
	defer a.Config.mu.Unlock()
	switch a.Config.WhenQuitting {
	case whenQuittingKeep, whenQuittingStop:
		return a.Config.WhenQuitting
	}
	return whenQuittingAsk
}

// ownedRunNames is the saved name of each local connection with an owned
// run, in the order the connections are listed.
func (a *App) ownedRunNames() []string {
	if a.Config == nil {
		return nil
	}
	owned := a.ownedRunConnections()
	var names []string
	for _, c := range a.ListConnections().Connections {
		if c.Kind == connectionKindLocal && slices.Contains(owned, c.ID) {
			names = append(names, c.Name)
		}
	}
	return names
}

// quitQuestionNames is the connections quitting now would ask about: the
// owned runs' names when When quitting is ask, else none.
func (a *App) quitQuestionNames() []string {
	if a.whenQuitting() != whenQuittingAsk {
		return nil
	}
	return a.ownedRunNames()
}

// asksOnQuit reports whether quitting now would ask the quit question.
func (a *App) asksOnQuit() bool {
	return len(a.quitQuestionNames()) > 0
}

// askAboutOwnedRuns asks the quit question when asksOnQuit, and reports
// whether to keep Marasi open (Cancel).
func (a *App) askAboutOwnedRuns() bool {
	names := a.quitQuestionNames()
	if len(names) == 0 {
		return false
	}
	reply := make(chan quitAnswer, 1)
	q := &a.quitQuestion
	q.mu.Lock()
	q.reply = reply
	timeout := q.timeout
	q.mu.Unlock()
	defer func() {
		q.mu.Lock()
		if q.reply == reply {
			q.reply = nil
		}
		q.mu.Unlock()
	}()
	if timeout <= 0 {
		timeout = defaultQuitQuestionTimeout
	}

	a.emitEvent(quitQuestionEvent, QuitQuestion{Connections: names})
	var answer quitAnswer
	select {
	case answer = <-reply:
	case <-time.After(timeout):
		log.Printf("[!] no answer to the quit question, keeping Marasi running")
		answer = quitAnswer{answer: quitAnswerKeep}
	}
	if answer.answer == quitAnswerCancel {
		return true
	}
	stop := answer.answer == quitAnswerStop
	if answer.remember {
		setting := whenQuittingKeep
		if stop {
			setting = whenQuittingStop
		}
		if err := a.Config.SetFlag(whenQuittingKey, setting); err != nil {
			log.Printf("[!] saving When quitting: %v", err)
		}
	}
	q.mu.Lock()
	q.stop, q.answered = stop, true
	q.mu.Unlock()
	return false
}

// stopsOwnedRunsOnQuit reports whether the shutdown stops the owned runs:
// never after "Restart now", as this quit's answer said, and otherwise as
// When quitting says (ask without an answer keeps them running).
func (a *App) stopsOwnedRunsOnQuit() bool {
	if a.restarting.Load() {
		return false
	}
	q := &a.quitQuestion
	q.mu.Lock()
	answered, stop := q.answered, q.stop
	q.mu.Unlock()
	if answered {
		return stop
	}
	return a.whenQuitting() == whenQuittingStop
}
