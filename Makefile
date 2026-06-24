SHELL := /bin/bash

PYTHON := .venv/bin/python
PIP := .venv/bin/pip
RUFF := .venv/bin/ruff
COVERAGE := .venv/bin/coverage
CLIPPY_FLAGS := -D warnings -D clippy::cognitive_complexity -D clippy::too_many_lines
HOST_TRIPLE := $(shell rustc -vV 2>/dev/null | awk '/host:/ { print $$2 }')
LLAMA_HELPER_EXT := $(if $(findstring windows,$(HOST_TRIPLE)),.exe,)
LLAMA_HELPER_BIN := frontend/src-tauri/binaries/llama-helper-$(HOST_TRIPLE)$(LLAMA_HELPER_EXT)

.PHONY: bootstrap prepare-sidecars format format-check lint typecheck test coverage duplication maintainability validate install-hooks clean

bootstrap:
	cd frontend && pnpm install --frozen-lockfile
	python3 -m venv .venv
	$(PIP) install --upgrade pip
	$(PIP) install -r requirements-dev.txt

prepare-sidecars:
	@test -n "$(HOST_TRIPLE)" || (echo "Unable to determine Rust host triple" && exit 1)
	@if [ ! -x "$(LLAMA_HELPER_BIN)" ]; then \
		cargo build -p llama-helper; \
		mkdir -p frontend/src-tauri/binaries; \
		cp "target/debug/llama-helper$(LLAMA_HELPER_EXT)" "$(LLAMA_HELPER_BIN)"; \
	fi

format:
	cd frontend && pnpm run format
	cargo fmt --all
	$(RUFF) format mcp scripts

format-check:
	cd frontend && pnpm run format:check
	cargo fmt --all -- --check
	$(RUFF) format --check mcp scripts

lint: prepare-sidecars
	cd frontend && pnpm run lint
	cd frontend && pnpm run lint:md
	cargo clippy --workspace --all-targets -- $(CLIPPY_FLAGS)
	$(RUFF) check mcp scripts

typecheck:
	cd frontend && pnpm run typecheck

test: prepare-sidecars
	cd frontend && pnpm run test
	cargo test --workspace
	$(PYTHON) -m unittest mcp/test_orxa_mcp.py

coverage:
	cd frontend && pnpm run coverage
	$(COVERAGE) run --rcfile=pyproject.toml -m unittest mcp/test_orxa_mcp.py
	$(COVERAGE) report --rcfile=pyproject.toml --fail-under=100

duplication:
	cd frontend && pnpm run duplication

maintainability:
	node scripts/check-maintainability.js

validate: format-check lint typecheck test coverage duplication maintainability

install-hooks:
	git config core.hooksPath .githooks

clean:
	rm -rf .venv frontend/coverage .jscpd-report
