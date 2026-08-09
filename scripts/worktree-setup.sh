#!/usr/bin/env bash
#
# Prepares a fresh checkout — normally a `git worktree` — for development.
#
# A linked worktree starts with no node_modules, no composer vendor directory
# and, in repositories that have them, no submodule contents. This installs all
# of it and brings up an isolated WordPress environment on ports that do not
# clash with any other checkout.
#
# Run it from the checkout you want to prepare:
#
#     npx nk-worktree-setup [--no-env]

set -euo pipefail

# Unlike a repo-local script, this one ships in a package, so the checkout is
# wherever it was invoked from — not where the file lives.
if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
	echo "Not inside a git checkout." >&2
	exit 1
fi

cd "$(git rev-parse --show-toplevel)"

START_ENV=1
for arg in "$@"; do
	case "$arg" in
		--no-env) START_ENV=0 ;;
		*)
			echo "Unknown option: $arg" >&2
			echo "Usage: nk-worktree-setup [--no-env]" >&2
			exit 1
			;;
	esac
done

step() {
	printf '\n\033[1m==> %s\033[0m\n' "$1"
}

if [ -f .gitmodules ]; then
	step 'Initialising submodules'
	git submodule update --init --recursive
fi

step 'Installing npm dependencies'
if [ -f package-lock.json ]; then
	npm ci
else
	npm install
fi

# `postinstall` already runs composer in most of the repos, but not every
# checkout gets there cleanly.
if [ ! -d vendor ] && [ -f composer.json ]; then
	step 'Installing composer dependencies'
	composer install --no-interaction
fi

if [ "$START_ENV" -eq 1 ]; then
	step 'Starting WordPress'
	npm run env:start

	step 'Ready'
	npm run env:ports
else
	step 'Ready (environment not started)'
	echo 'Run "npm run env:start" when you need WordPress.'
fi
