SHELL := /bin/bash
.SHELLFLAGS := -o pipefail -c

# A pre-push hook runs with GIT_DIR naming this repository; nothing here runs
# git on the host, and this keeps it that way should something start to.
unexport GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR \
         GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_PREFIX

.PHONY: help ci-local ci-local-deep ci-remote image bench-image build tokens check-tokens lint test bench fit shots serve install-hooks

DOCKER   := DOCKER_BUILDKIT=1 docker
CHECK    := meridian-ui-check
BENCH    := meridian-ui-bench
DESIGN   ?= ../meridian-design
TOKENS   := $(abspath $(DESIGN))/brand/tokens.json
VERSION  := $(shell sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' package.json | head -1)
PORT     ?= 8765

# The design repository's tokens, mounted where they exist. meridian-design is
# private, so CI (and anyone without it) builds from the committed generated/.
HAVE_TOKENS := $(wildcard $(TOKENS))
MOUNT    := $(if $(HAVE_TOKENS),-v $(TOKENS):/tokens.json:ro,)
TOKARG   := $(if $(HAVE_TOKENS),--tokens /tokens.json,)

help:
	@echo "  make ci-local       every gate: tokens fresh, build, lint, tests, bench, fit (the pre-push gate)"
	@echo "  make ci-remote      what CI runs: build, lint, tests, bench, fit"
	@echo "  make build          generated/ from the tokens (when beside), then dist/$(VERSION)/"
	@echo "  make check-tokens   fail when generated/ differs from meridian-design's tokens"
	@echo "  make lint           scripts parse; no raw colour; nothing served reaches elsewhere"
	@echo "  make test           the tests, in a container (happy-dom)"
	@echo "  make bench          the high-rate grid's frame budget, in headless Chromium (Playwright)"
	@echo "  make fit            every gallery page fits one screen at 1440x900 and 390x844 (Playwright)"
	@echo "  make shots          make fit, writing a screenshot of each page to SHOTS=<dir>"
	@echo "  make serve          serve dist/ at http://127.0.0.1:$(PORT)/.meridian/ui/$(VERSION)/gallery.html"
	@echo "  make install-hooks  point git at hooks/ so push fires ci-local"

# Local green is the completion signal; CI is confirmation. Every CI job is a
# target reachable from here.
ci-local: check-tokens ci-remote
	@echo
	@echo "ci-local: GREEN"

ci-local-deep: ci-local

ci-remote: build lint test bench fit
	@echo
	@echo "ci-remote: GREEN"

image:
	@$(DOCKER) build -f Dockerfile.check --target base -t $(CHECK) . >/dev/null 2>&1 \
		|| { echo "image FAILED; see it with:" >&2; \
		     echo "  DOCKER_BUILDKIT=1 docker build -f Dockerfile.check --target base --progress=plain ." >&2; exit 1; }

# The build runs in the container and streams dist/ and generated/ back as a
# tar: nothing is written through a bind mount.
build: image
	@rm -rf dist
	@docker run --rm $(MOUNT) $(CHECK) sh -c 'node tools/build.mjs $(TOKARG) >&2 && tar -cf - dist generated' | tar -xf -

tokens:
	@[ -n "$(HAVE_TOKENS)" ] || { echo "tokens: no tokens at $(TOKENS); set DESIGN=<path to meridian-design>" >&2; exit 1; }
	@$(MAKE) --no-print-directory build

check-tokens: image
	@docker run --rm $(MOUNT) $(CHECK) node tools/build.mjs --check $(TOKARG)

lint: image
	@docker run --rm $(CHECK) sh -c 'node tools/build.mjs >/dev/null && node tools/lint.mjs'

test: image
	@docker run --rm $(MOUNT) $(if $(HAVE_TOKENS),-e MERIDIAN_BRAND_TOKENS=/tokens.json,) $(CHECK) \
		sh -c 'node tools/build.mjs $(TOKARG) >/dev/null && node --test --test-reporter=spec "tests/*.test.mjs"' >.test.log 2>&1 \
		|| { echo "test FAILED. The last 60 lines, and the whole of it in .test.log:" >&2; tail -60 .test.log >&2; exit 1; }
	@echo "test OK: $$(grep -E '^ℹ (tests|pass|fail|skipped) ' .test.log | tr '\n' ' ' | sed 's/ℹ //g')"

# The high-rate grid's budget, in a real browser: 10,000 rows taking 1,000
# updates a second for 5 seconds, frame time p95 under 16.7 ms (tools/bench.mjs).
# Chromium wants more shared memory than a container's default 64 MB.
bench-image:
	@$(DOCKER) build -f Dockerfile.check --target bench -t $(BENCH) . >/dev/null 2>&1 \
		|| { echo "bench-image FAILED; see it with:" >&2; \
		     echo "  DOCKER_BUILDKIT=1 docker build -f Dockerfile.check --target bench --progress=plain ." >&2; exit 1; }

# Where the bench runs, for its budgets: GitHub's hosted runners hold three
# frames the browser's own work makes slow there to budgets measured there
# (tools/bench.mjs, RUNNER_MEASURED); everywhere else every budget is 16.7 ms.
BENCH_ENV := $(if $(GITHUB_ACTIONS),github-runner,local)

bench: bench-image
	@docker run --rm --init --shm-size=1g -e MERIDIAN_BENCH_ENV=$(BENCH_ENV) $(BENCH) \
		sh -c 'node tools/build.mjs >/dev/null && node tools/bench.mjs' >.bench.log 2>&1 \
		|| { echo "bench FAILED. What it measured, and the whole of it in .bench.log:" >&2; cat .bench.log >&2; exit 1; }
	@grep -E '^bench OK' .bench.log

# Every page fits one screen (meridian-design tasks/design/every-page-fits-one-screen):
# each gallery page, and each of its tabs, at 1440x900 and 390x844, its
# document no taller and no wider than the viewport and every one-line row on
# one line (tools/fit.mjs, lib/fit.js), in the bench's browser.
fit: bench-image
	@docker run --rm --init --shm-size=1g $(BENCH) \
		sh -c 'node tools/build.mjs >/dev/null && node tools/fit.mjs' >.fit.log 2>&1 \
		|| { echo "fit FAILED. What it measured, and the whole of it in .fit.log:" >&2; cat .fit.log >&2; exit 1; }
	@grep -E '^fit OK' .fit.log

# make fit, with a screenshot of each page, size and tab, streamed out as a tar.
SHOTS ?= .shots
shots: bench-image
	@mkdir -p $(SHOTS)
	@docker run --rm --init --shm-size=1g $(BENCH) \
		sh -c 'node tools/build.mjs >/dev/null && node tools/fit.mjs --shots /tmp/shots >&2; tar -C /tmp/shots -cf - .' | tar -C $(SHOTS) -xf -
	@echo "shots: $(SHOTS)"

# The kit under the base path the dashboard serves it at, so the gallery
# proves every reference is relative. Python's server, as the host has it.
serve: build
	@mkdir -p .serve/.meridian && ln -sfn ../../dist .serve/.meridian/ui
	@echo "gallery: http://127.0.0.1:$(PORT)/.meridian/ui/$(VERSION)/gallery.html"
	@python3 -m http.server -b 127.0.0.1 -d .serve $(PORT)

install-hooks:
	@git config core.hooksPath hooks
	@echo "hooks installed: git push now runs 'make ci-local' first"
