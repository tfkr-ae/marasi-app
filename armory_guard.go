package main

import (
	"errors"
	"time"
)

// The Armory runs on the Marasi service, so only the frontend knows which
// runs are active: it gathers them from every template's runs. It reports
// how many with SetActiveArmoryRunCount, as it reports unsaved Launchpad
// drafts, so quitting or switching the project can warn first. Once the
// researcher goes ahead, Go asks the frontend to cancel them with
// cancelArmoryRunsEvent and waits for ArmoryRunsCancelled.

// cancelArmoryRunsEvent asks the frontend to cancel every active Armory run
// and answer with ArmoryRunsCancelled once none is running.
const cancelArmoryRunsEvent = "armory-cancel-runs"

// defaultArmoryCancelTimeout bounds the wait for the frontend's answer. The
// frontend gives the runs 5 seconds to stop, so this leaves it time to say so.
const defaultArmoryCancelTimeout = 10 * time.Second

// SetActiveArmoryRunCount records how many Armory runs are active on the
// service. The frontend calls it whenever that number changes.
func (a *App) SetActiveArmoryRunCount(count int) {
	a.activeArmoryRuns.Store(int64(count))
}

// ArmoryRunsCancelled is the frontend's answer to cancelArmoryRunsEvent:
// problem is "" when no run is active any longer, else why not. An answer
// nobody waits for is dropped.
func (a *App) ArmoryRunsCancelled(problem string) {
	a.armoryCancelMu.Lock()
	reply := a.armoryCancelReply
	a.armoryCancelReply = nil
	a.armoryCancelMu.Unlock()
	if reply != nil {
		reply <- problem
	}
}

func (a *App) hasActiveArmoryRuns() bool {
	return a.activeArmoryRuns.Load() > 0
}

// cancelArmoryRuns asks the frontend to cancel every active Armory run and
// waits for its answer. It reports whether the runs stopped.
func (a *App) cancelArmoryRuns() (bool, error) {
	reply := make(chan string, 1)
	a.armoryCancelMu.Lock()
	a.armoryCancelReply = reply
	a.armoryCancelMu.Unlock()
	defer func() {
		a.armoryCancelMu.Lock()
		if a.armoryCancelReply == reply {
			a.armoryCancelReply = nil
		}
		a.armoryCancelMu.Unlock()
	}()

	a.emitEvent(cancelArmoryRunsEvent)
	timeout := a.armoryCancelTimeout
	if timeout <= 0 {
		timeout = defaultArmoryCancelTimeout
	}
	select {
	case problem := <-reply:
		if problem != "" {
			return false, errors.New(problem)
		}
		return true, nil
	case <-time.After(timeout):
		return false, errors.New("timed out cancelling active Armory runs")
	}
}
