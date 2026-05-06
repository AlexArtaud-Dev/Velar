.PHONY: dev build up down logs restart lint-go lint-ts test-go db-backup \
        slave-build slave-up slave-down slave-logs

dev:
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up

build:
	docker compose build --no-cache

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f

restart:
	docker compose restart

lint-go:
	cd backend && golangci-lint run ./...

lint-ts:
	cd frontend && npm run lint

test-go:
	cd backend && go test ./...

slave-build:
	docker compose -f docker-compose.slave.yml build --no-cache

slave-up:
	docker compose -f docker-compose.slave.yml up -d

slave-down:
	docker compose -f docker-compose.slave.yml down

slave-logs:
	docker compose -f docker-compose.slave.yml logs -f

db-backup:
	curl -s -X GET http://localhost:$(APP_PORT)/api/v1/admin/backup \
		-H "Authorization: Bearer $$(cat /tmp/velar_token 2>/dev/null || echo '')"
