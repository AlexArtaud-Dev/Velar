FROM golang:1.22-alpine AS builder

RUN apk add --no-cache git ca-certificates

WORKDIR /app

COPY go.mod ./
RUN GOFLAGS=-mod=mod go mod download

COPY . .
RUN GOFLAGS=-mod=mod CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o velar ./cmd/server

FROM alpine:3.19

RUN apk add --no-cache ca-certificates wireguard-tools iptables nftables

WORKDIR /app

COPY --from=builder /app/velar .

EXPOSE 8080

ENTRYPOINT ["./velar"]
