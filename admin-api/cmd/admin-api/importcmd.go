package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/config"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/importer"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/keycloak"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/store"
)

func runImport(args []string) error {
	fs := flag.NewFlagSet("import", flag.ContinueOnError)
	aiPath := fs.String("ai-export", "", "файл users.json из AI")
	departments := fs.String("departments", "", "имена групп, которые считаются отделами, через запятую")
	adminSubs := fs.String("admin-subs", "", "идентификаторы единого входа тех, кто получает признак администратора сверх админов AI, через запятую")
	splitNames := fs.Bool("split-names", false, "если фамилия пуста, а в имени несколько слов, первое слово считать именем, остальное фамилией")
	apply := fs.Bool("apply", false, "записать результат в базу")
	if err := fs.Parse(args); err != nil {
		return err
	}
	cfg, err := config.LoadImport()
	if err != nil {
		return err
	}

	var ai []importer.AIRecord
	if *aiPath != "" {
		raw, err := os.ReadFile(*aiPath)
		if err != nil {
			return err
		}
		if err := json.Unmarshal(raw, &ai); err != nil {
			return fmt.Errorf("%s: %w", *aiPath, err)
		}
	}

	ai = importer.WithExtraAdmins(ai, strings.Split(*adminSubs, ","))

	ctx := context.Background()
	kc := keycloak.New(cfg.KeycloakAdminURL, cfg.KeycloakRealm, cfg.KeycloakClientID, cfg.KeycloakSecret)
	var src importer.Source = kc
	users, err := src.ListUsers(ctx)
	if err != nil {
		return err
	}
	plan := importer.BuildWithOptions(users, ai, strings.Split(*departments, ","), importer.Options{SplitNames: *splitNames})
	importer.Print(os.Stdout, plan)

	s, err := store.Open(cfg.PostgresDSN)
	if err != nil {
		return err
	}
	defer func() { _ = s.Close() }()
	if !*apply {
		has, err := importer.HasData(ctx, s)
		switch {
		case err != nil:
			fmt.Printf("Предупреждение: не удалось проверить базу: %v\n", err)
		case has:
			fmt.Println(importer.NotEmptyWarning)
		}
		fmt.Println(importer.DryRunNotice)
		return nil
	}
	if err := importer.Apply(ctx, s, plan); err != nil {
		return err
	}
	fmt.Println("Перенос выполнен")
	return nil
}
