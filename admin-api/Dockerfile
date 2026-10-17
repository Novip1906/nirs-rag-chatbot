# syntax=docker/dockerfile:1.7
FROM golang:1.26-bookworm AS builder

ENV CGO_ENABLED=0

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN go build -trimpath -ldflags="-s -w" -o /out/admin-api ./cmd/admin-api

FROM gcr.io/distroless/static-debian12:nonroot
EXPOSE 8091
COPY --from=builder /out/admin-api /admin-api
ENTRYPOINT ["/admin-api"]
CMD ["serve"]
