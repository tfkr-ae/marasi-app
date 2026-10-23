package main

import (
	"errors"
	"log"
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

// CheckpointSettled is the checkpoint-settled event's payload: an item that
// left Checkpoint because it was forwarded or dropped. RequestID is a
// WebSocket message's upgrade request, so the connection's view can refresh.
type CheckpointSettled struct {
	ID        uuid.UUID
	Type      string
	RequestID uuid.UUID
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
// time once the item has left Checkpoint. A forward or drop that succeeds
// emits checkpoint-settled, so the Checkpoint page and the WebSocket modal
// both drop the item whichever of them acted.
func (a *App) settleCheckpoint(id uuid.UUID, settle func() error) error {
	at, known := a.checkpointTimes.get(id)
	item, held := a.Proxy.GetCheckpoint(id)
	err := settle()
	if known && (err == nil || errors.Is(err, marasi.ErrCheckpointNotFound)) {
		a.checkpointTimes.forgetIf(id, at)
	}
	if err == nil && held {
		a.emitEvent("checkpoint-settled", CheckpointSettled{ID: id, Type: item.Type, RequestID: item.RequestID})
	}
	if errors.Is(err, marasi.ErrCheckpointNotFound) {
		return checkpointGoneError(id, err)
	}
	return err
}

// checkpointGone is the code of a forward or drop of an item that has
// already left Checkpoint: "settling Checkpoint item: checkpoint_gone
// (<uuid>): ...". The frontend treats the item as gone rather than failed.
const checkpointGone = "checkpoint_gone"

func checkpointGoneError(id uuid.UUID, err error) error {
	return codedError("settling Checkpoint item", checkpointGone, []string{id.String()}, err)
}

// CheckpointForwardItem is one item of a ForwardCheckpoints call. Body
// follows ForwardCheckpoint: empty forwards the item as held.
type CheckpointForwardItem struct {
	ID   uuid.UUID
	Body string
}

// CheckpointBulkResult counts a bulk action's items: Done were forwarded or
// dropped, Gone had already left Checkpoint, Failed are still held because
// their forward or drop failed.
type CheckpointBulkResult struct {
	Done   int
	Gone   int
	Failed int
}

// ForwardCheckpoints forwards each item as ForwardCheckpoint does, without
// intercepting the response. It acts on the ids given, so items held during
// the call stay held. An id that has already left counts as gone; any other
// failure counts as failed, is logged, and does not stop the rest.
func (a *App) ForwardCheckpoints(items []CheckpointForwardItem) (CheckpointBulkResult, error) {
	return settleCheckpoints(len(items), func(i int) (uuid.UUID, error) {
		return items[i].ID, a.ForwardCheckpoint(items[i].ID, items[i].Body, false)
	})
}

// DropCheckpoints drops each id as DropCheckpoint does, with the same
// counting as ForwardCheckpoints.
func (a *App) DropCheckpoints(ids []uuid.UUID) (CheckpointBulkResult, error) {
	return settleCheckpoints(len(ids), func(i int) (uuid.UUID, error) {
		return ids[i], a.DropCheckpoint(ids[i])
	})
}

func settleCheckpoints(n int, settle func(i int) (uuid.UUID, error)) (CheckpointBulkResult, error) {
	var result CheckpointBulkResult
	for i := range n {
		id, err := settle(i)
		switch {
		case err == nil:
			result.Done++
		case errors.Is(err, marasi.ErrCheckpointNotFound):
			result.Gone++
		default:
			result.Failed++
			log.Printf("settling Checkpoint item %s: %v", id, err)
		}
	}
	return result, nil
}
