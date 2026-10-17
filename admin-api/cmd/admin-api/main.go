package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/activation"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/auth"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/config"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/httpapi"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/keycloak"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/notify"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/reconcile"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/service"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/store"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: admin-api serve|migrate|import|set-heads")
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "serve":
		err = serve()
	case "migrate":
		err = migrate()
	case "import":
		err = runImport(os.Args[2:])
	case "set-heads":
		err = runSetHeads(os.Args[2:])
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n", os.Args[1])
		os.Exit(2)
	}
	if err != nil {
		slog.Error(os.Args[1]+" failed", "error", err.Error())
		os.Exit(1)
	}
}

func migrate() error {
	cfg, err := config.LoadDatabase()
	if err != nil {
		return err
	}
	s, err := store.Open(cfg.PostgresDSN)
	if err != nil {
		return err
	}
	defer func() { _ = s.Close() }()
	return s.Migrate(context.Background())
}

func serve() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	s, err := store.Open(cfg.PostgresDSN)
	if err != nil {
		return err
	}
	defer func() { _ = s.Close() }()

	kc := keycloak.New(cfg.KeycloakAdminURL, cfg.KeycloakRealm, cfg.KeycloakClientID, cfg.KeycloakSecret).WithInvite(cfg.InviteClientID, cfg.InviteRedirectURL)
	notifyTokens := keycloak.NewTokenSource(keycloak.TokenEndpoint(cfg.KeycloakAdminURL, cfg.KeycloakRealm), cfg.NotifyClientID, cfg.NotifyClientSecret, &http.Client{Timeout: 3 * time.Second})
	notifier := notify.New(cfg.NotifyURLs, notifyTokens.Token)
	svc := &service.Service{Store: s, IdP: kc, Notifier: notifier, NewPassword: service.GeneratePassword, Now: time.Now, InviteTTL: cfg.InviteTTL, NewToken: service.GenerateToken}

	mw := &auth.Middleware{
		Validator:     auth.NewJWKSValidatorFromURL(cfg.JWKSURL, cfg.Issuer),
		Audience:      cfg.Audience,
		ReaderClients: cfg.ReaderClients,
		AdminClients:  cfg.AdminClients,
	}
	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           httpapi.WithPathPrefix(cfg.HTTPPathPrefix, httpapi.NewHandler(svc, mw, cfg.PublicBaseURL)),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	if cfg.ReconcileInterval > 0 {
		go reconcile.Loop(ctx, cfg.ReconcileInterval, func(ctx context.Context) (reconcile.Report, error) {
			return reconcile.Run(ctx, s, kc, cfg.ReconcileMaxDisables, cfg.ReconcileMaxEnables)
		})
	}

	go activation.Loop(ctx, cfg.ActivationInterval, svc.RefreshActivation)

	errc := make(chan error, 1)
	go func() { errc <- srv.ListenAndServe() }()
	slog.Info("admin-api слушает", "addr", cfg.HTTPAddr)

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	notifier.Wait()
	return nil
}
