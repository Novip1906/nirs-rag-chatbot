package httpapi

import "net/http"

func WithPathPrefix(prefix string, next http.Handler) http.Handler {
	if prefix == "" {
		return next
	}
	stripped := http.StripPrefix(prefix, next)
	mux := http.NewServeMux()
	mux.Handle(prefix+"/", stripped)
	mux.Handle("/", next)
	return mux
}
