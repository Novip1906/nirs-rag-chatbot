package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/config"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/headimport"
	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/store"
)

func runSetHeads(args []string) error {
	fs := flag.NewFlagSet("set-heads", flag.ContinueOnError)
	file := fs.String("file", "", "JSON-массив объектов с полем employee_id")
	apply := fs.Bool("apply", false, "записать результат в базу")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *file == "" {
		return fmt.Errorf("--file: обязателен")
	}
	raw, err := os.ReadFile(*file)
	if err != nil {
		return err
	}
	var entries []headimport.Entry
	if err := json.Unmarshal(raw, &entries); err != nil {
		return fmt.Errorf("%s: %w", *file, err)
	}
	cfg, err := config.LoadDatabase()
	if err != nil {
		return err
	}
	s, err := store.Open(cfg.PostgresDSN)
	if err != nil {
		return err
	}
	defer func() { _ = s.Close() }()
	report, err := headimport.Run(context.Background(), s, entries, *apply)
	if err != nil {
		return err
	}
	return finishSetHeads(os.Stdout, os.Stderr, report, *apply)
}

func finishSetHeads(out, hint io.Writer, report headimport.Report, apply bool) error {
	enc := json.NewEncoder(out)
	enc.SetIndent("", "  ")
	if err := enc.Encode(report); err != nil {
		return err
	}
	if !apply {
		_, err := fmt.Fprintln(hint, "Ничего не записано. Для применения добавьте --apply")
		return err
	}
	if len(report.NotFound) > 0 || len(report.NoDepartment) > 0 {
		return fmt.Errorf("перенесены не все: не найдено %d, без отдела %d", len(report.NotFound), len(report.NoDepartment))
	}
	return nil
}
