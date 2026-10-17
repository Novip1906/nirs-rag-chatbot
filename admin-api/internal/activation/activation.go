package activation

import (
	"context"
	"log/slog"
	"time"
)

func Loop(ctx context.Context, interval time.Duration, run func(context.Context) (int, error)) {
	timer := time.NewTimer(interval)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		n, err := run(ctx)
		switch {
		case err != nil:
			slog.Error("проверка приглашённых прервана", "error", err.Error())
		case n > 0:
			slog.Info("приглашённые вошли", "count", n)
		}
		timer.Reset(interval)
	}
}
