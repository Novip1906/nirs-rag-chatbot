package main

import (
	"bytes"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/Novip1906/nirs-rag-chatbot/admin-api/internal/headimport"
)

func TestFinishSetHeads(t *testing.T) {
	clean := headimport.Report{Set: []string{"a"}, AlreadySet: []string{"b"}, NoDepartment: []string{}, NotFound: []string{}}
	missing := headimport.Report{Set: []string{"a"}, AlreadySet: []string{}, NoDepartment: []string{}, NotFound: []string{"x"}}
	homeless := headimport.Report{Set: []string{}, AlreadySet: []string{}, NoDepartment: []string{"y"}, NotFound: []string{}}
	cases := []struct {
		name   string
		report headimport.Report
		apply  bool
		fails  bool
		prints string
	}{
		{"всё перенесено", clean, true, false, `"set"`},
		{"не найден — ошибка", missing, true, true, `"x"`},
		{"без отдела — ошибка", homeless, true, true, `"y"`},
		{"сухой прогон не падает", missing, false, false, `"x"`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var out, hint bytes.Buffer
			err := finishSetHeads(&out, &hint, c.report, c.apply)
			require.Equal(t, c.fails, err != nil)
			require.Contains(t, out.String(), c.prints)
			require.Equal(t, !c.apply, hint.Len() > 0)
		})
	}
}
