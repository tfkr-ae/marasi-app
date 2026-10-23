package main

import (
	"errors"
	"sync"
	"time"

	"github.com/google/uuid"
	marasi "github.com/tfkr-ae/marasi"
	"github.com/tfkr-ae/marasi/domain"
)

// CheckpointItem is a held Checkpoint item with the time it was intercepted.
type CheckpointItem struct {
	domain.CheckpointItem
	InterceptedAt time.Time
}

// CheckpointAbandoned is the checkpoint-abandoned event's payload: an item
// Marasi dropped itself because its client left.
type CheckpointAbandoned struct {
	ID   uuid.UUID
	Type string
}

// checkpointTimes records when each held item was intercepted, by item id.
// A request and its held response share an id, so the response restamps it.
type checkpointTimes struct {
	mu    sync.Mutex
	times map[uuid.UUID]time.Time
}

func (c *checkpointTimes) set(id uuid.UUID, at time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.times == nil {
		c.times = make(map[uuid.UUID]time.Time)
	}
	c.times[id] = at
}

func (c *checkpointTimes) get(id uuid.UUID) (time.Time, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	at, ok := c.times[id]
	return at, ok
}

// stamp returns the time recorded for id, recording now when there is none.
func (c *checkpointTimes) stamp(id uuid.UUID, now time.Time) time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	if at, ok := c.times[id]; ok {
		return at
	}
	if c.times == nil {
		c.times = make(map[uuid.UUID]time.Time)
	}
	c.times[id] = now
	return now
}

func (c *checkpointTimes) forget(id uuid.UUID) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.times, id)
}

// forgetIf forgets id only while it still holds at, so a response held with
// the same id after its request was forwarded keeps its own time.
func (c *checkpointTimes) forgetIf(id uuid.UUID, at time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if current, ok := c.times[id]; ok && current.Equal(at) {
		delete(c.times, id)
	}
}

// configureCheckpointHandlers records interception times and sends Marasi's
// Checkpoint events to the frontend through the app's emitter, read when
// they fire so tests can swap it.
func (a *App) configureCheckpointHandlers() {
	a.Proxy.WithOptions(
		marasi.WithInterceptHandler(func(item domain.CheckpointItem) error {
			a.checkpointTimes.set(item.ID, time.Now())
			a.emitEvent("intercepted", item.Type)
			return nil
		}),
		marasi.WithCheckpointAbandonedHandler(func(item domain.CheckpointItem) error {
			a.checkpointTimes.forget(item.ID)
			a.emitEvent("checkpoint-abandoned", CheckpointAbandoned{ID: item.ID, Type: item.Type})
			return nil
		}),
	)
}

// GetCheckpointItems returns the held items oldest first, as Marasi orders
// them, each with the time it was intercepted.
func (a *App) GetCheckpointItems() []CheckpointItem {
	held := a.Proxy.CheckpointItems()
	now := time.Now()
	items := make([]CheckpointItem, len(held))
	for i, item := range held {
		items[i] = CheckpointItem{CheckpointItem: item, InterceptedAt: a.checkpointTimes.stamp(item.ID, now)}
	}
	return items
}

// settleCheckpoint runs a forward or drop of id and forgets its interception
// time once the item has left Checkpoint.
func (a *App) settleCheckpoint(id uuid.UUID, settle func() error) error {
	at, known := a.checkpointTimes.get(id)
	err := settle()
	if known && (err == nil || errors.Is(err, marasi.ErrCheckpointNotFound)) {
		a.checkpointTimes.forgetIf(id, at)
	}
	return err
}
