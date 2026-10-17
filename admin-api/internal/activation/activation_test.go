package activation

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestLoop_RunsUntilCancelled(t *testing.T) {
	var calls atomic.Int32
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		Loop(ctx, 5*time.Millisecond, func(context.Context) (int, error) {
			if calls.Add(1)%2 == 0 {
				return 0, errors.New("сбой")
			}
			return 1, nil
		})
		close(done)
	}()
	require.Eventually(t, func() bool { return calls.Load() >= 2 }, 2*time.Second, 5*time.Millisecond)
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("цикл не завершился после отмены")
	}
}
