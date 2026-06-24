SHELL := /bin/bash

PYTHON := .venv/bin/python
PIP := .venv/bin/pip
RUFF := .venv/bin/ruff
COVERAGE := .venv/bin/coverage
CLIPPY_FLAGS := -D warnings -D clippy::cognitive_complexity -D clippy::too_many_lines

.PHONY: bootstrap format format-check lint typecheck test coverage duplication maintainability validate install-hooks clean

bootstrap:
	cd frontend && pnpm install --frozen-lockfile
	python3 -m venv .venv
	$(PIP) install --upgrade pip
	$(PIP) install -r requirements-dev.txt

format:
	cd frontend && pnpm run format
	cargo fmt --all
	$(RUFF) format mcp scripts

format-check:
	cd frontend && pnpm run format:check
	cargo fmt --all -- --check
	$(RUFF) format --check mcp scripts

lint:
	cd frontend && pnpm run lint
	cd frontend && pnpm run lint:md
	cargo clippy --workspace --all-targets -- $(CLIPPY_FLAGS)
	$(RUFF) check mcp scripts

typecheck:
	cd frontend && pnpm run typecheck

test:
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
