# rabbitcli — static single-binary builds (no runtime dependency on the target machine)
# Rename the CLI without touching source: make build NAME=acmecli
# (drives the binary name, env var prefix ACMECLI_*, ~/.config/acmecli, log file names)
NAME    ?= rabbitcli
VERSION ?= 0.1.0
PKG     := github.com/RabbitAI-Lab/RabbitCLI-Bootstrap/internal/cli
LDFLAGS := -s -w -X $(PKG).Version=$(VERSION) -X $(PKG).Name=$(NAME)
BUILD   := CGO_ENABLED=0 go build -trimpath -ldflags "$(LDFLAGS)"

.PHONY: build install clean release

build: ## Build for the current platform
	$(BUILD) -o bin/$(NAME) ./cmd/rabbitcli

install: build ## Install to /usr/local/bin
	install -m 755 bin/$(NAME) /usr/local/bin/$(NAME)

release: clean ## Cross-compile all targets (incl. Kylin: linux amd64/arm64/loong64)
	CGO_ENABLED=0 GOOS=linux   GOARCH=amd64   go build -trimpath -ldflags "$(LDFLAGS)" -o dist/$(NAME)-linux-amd64       ./cmd/rabbitcli
	CGO_ENABLED=0 GOOS=linux   GOARCH=arm64   go build -trimpath -ldflags "$(LDFLAGS)" -o dist/$(NAME)-linux-arm64       ./cmd/rabbitcli
	CGO_ENABLED=0 GOOS=linux   GOARCH=loong64 go build -trimpath -ldflags "$(LDFLAGS)" -o dist/$(NAME)-linux-loong64     ./cmd/rabbitcli
	CGO_ENABLED=0 GOOS=darwin  GOARCH=amd64   go build -trimpath -ldflags "$(LDFLAGS)" -o dist/$(NAME)-darwin-amd64      ./cmd/rabbitcli
	CGO_ENABLED=0 GOOS=darwin  GOARCH=arm64   go build -trimpath -ldflags "$(LDFLAGS)" -o dist/$(NAME)-darwin-arm64      ./cmd/rabbitcli
	CGO_ENABLED=0 GOOS=windows GOARCH=amd64   go build -trimpath -ldflags "$(LDFLAGS)" -o dist/$(NAME)-windows-amd64.exe ./cmd/rabbitcli
	cd dist && sha256sum * > SHA256SUMS.txt

clean:
	rm -rf bin dist
