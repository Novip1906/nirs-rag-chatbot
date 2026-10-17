package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
)

const requestTimeout = 3 * time.Second

type TokenSource func(ctx context.Context) (string, error)

type Notifier struct {
	urls  []string
	token TokenSource
	http  *http.Client
	wg    sync.WaitGroup
}

func New(urls []string, token TokenSource) *Notifier {
	return &Notifier{urls: urls, token: token, http: &http.Client{Timeout: requestTimeout}}
}

func (n *Notifier) EmployeeChanged(id uuid.UUID) { n.publish("employee", id) }

func (n *Notifier) DepartmentChanged(id uuid.UUID) { n.publish("department", id) }

func (n *Notifier) Wait() { n.wg.Wait() }

func (n *Notifier) publish(kind string, id uuid.UUID) {
	body, err := json.Marshal(struct {
		Type string    `json:"type"`
		ID   uuid.UUID `json:"id"`
	}{kind, id})
	if err != nil {
		slog.Warn("не удалось собрать уведомление", "type", kind, "error", err)
		return
	}
	for _, target := range n.urls {
		n.wg.Add(1)
		go func() {
			defer n.wg.Done()
			if err := n.post(target, body); err != nil {
				slog.Warn("уведомление не доставлено", "url", target, "type", kind, "id", id, "error", err)
			}
		}()
	}
}

func (n *Notifier) post(target string, body []byte) error {
	ctx, cancel := context.WithTimeout(context.Background(), requestTimeout)
	defer cancel()
	token, err := n.token(ctx)
	if err != nil {
		return fmt.Errorf("token: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, target, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := n.http.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("status %d", resp.StatusCode)
	}
	return nil
}
