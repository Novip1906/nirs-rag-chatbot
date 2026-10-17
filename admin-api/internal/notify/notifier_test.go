package notify

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func TestNotifier_PostsToAllTargets(t *testing.T) {
	var mu sync.Mutex
	var got []string
	handler := func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		got = append(got, r.Header.Get("Authorization")+" "+string(body))
		mu.Unlock()
	}
	a, b := httptest.NewServer(http.HandlerFunc(handler)), httptest.NewServer(http.HandlerFunc(handler))
	defer a.Close()
	defer b.Close()
	id := uuid.New()
	n := New([]string{a.URL, b.URL}, func(context.Context) (string, error) { return "tok", nil })
	n.EmployeeChanged(id)
	n.Wait()
	require.Len(t, got, 2)
	require.Equal(t, `Bearer tok {"type":"employee","id":"`+id.String()+`"}`, got[0])
}

func TestNotifier_DepartmentType(t *testing.T) {
	var mu sync.Mutex
	var got string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		got = string(body)
		mu.Unlock()
	}))
	defer srv.Close()
	id := uuid.New()
	n := New([]string{srv.URL}, func(context.Context) (string, error) { return "tok", nil })
	n.DepartmentChanged(id)
	n.Wait()
	require.Equal(t, `{"type":"department","id":"`+id.String()+`"}`, got)
}

func TestNotifier_FailingTargetDoesNotBlock(t *testing.T) {
	n := New([]string{"http://127.0.0.1:1"}, func(context.Context) (string, error) { return "tok", nil })
	n.DepartmentChanged(uuid.New())
	done := make(chan struct{})
	go func() { n.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("уведомление зависло")
	}
}
