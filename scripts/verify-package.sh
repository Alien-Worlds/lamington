#!/usr/bin/env bash
#
# Verifies the packaged module works from a consumer's point of view.
#
# Lamington's own test suite runs inside this repo, where devDependencies are
# installed, so a runtime dependency declared in the wrong section is invisible
# to it. This packs the module, installs the tarball into an empty project and
# loads it there, which is the only place that mistake shows up.
#
# Note: a `file:` install does NOT test this. npm symlinks local paths and skips
# installing their dependencies, so the consumer keeps seeing this repo's
# node_modules and everything appears to resolve.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# `timeout` is coreutils and is absent from a bare macOS; the guard is a nicety,
# not a requirement, so run without it when it is missing.
if command -v timeout >/dev/null 2>&1; then TIMEOUT="timeout 60"; else TIMEOUT=""; fi
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "=== building"
cd "$REPO_ROOT"
npm run build >/dev/null

echo "=== packing"
TARBALL="$(cd "$WORK_DIR" && npm pack "$REPO_ROOT" --silent --pack-destination "$WORK_DIR" | tail -1)"
echo "    $TARBALL"

echo "=== installing into an empty project"
cd "$WORK_DIR"
npm init -y >/dev/null 2>&1
# Install scripts stay enabled on purpose. Some dependencies are git installs
# (docker-cli-js) whose prepare step builds their dist/, so --ignore-scripts
# would fail them for reasons a real consumer never hits. npm does not run a
# tarball's own prepare, so this still does not rely on this repo's build.
npm install "$WORK_DIR/$TARBALL" --no-audit --no-fund >/dev/null 2>&1

echo "=== loading every entry point a consumer touches"
FAILED=0
for MODULE in \
	"lamington" \
	"lamington/lib/configManager" \
	"lamington/lib/cli/cli-utils/runTests" \
	"lamington/lib/cli/cli-utils/blockchainManagement" \
	"lamington/lib/cli/cli-utils/blockchainSnapshotManagement"
do
	if OUTPUT="$(node -e "require('$MODULE')" 2>&1)"; then
		echo "    ok      $MODULE"
	else
		echo "    FAILED  $MODULE"
		echo "$OUTPUT" | grep -E "Cannot find module|Error:" | head -2 | sed 's/^/              /'
		FAILED=1
	fi
done

echo "=== running the CLI"
# `lamington --help` alone is not enough: index.js pulls none of the runtime
# deps, so it passes even when the package is broken. `test --help` loads the
# test runner and configManager, which is where the runtime requires live.
for ARGS in "--help" "test --help"; do
	# shellcheck disable=SC2086
	if OUTPUT="$($TIMEOUT ./node_modules/.bin/lamington $ARGS 2>&1)"; then
		echo "    ok      lamington $ARGS"
	else
		echo "    FAILED  lamington $ARGS"
		echo "$OUTPUT" | grep -E "Cannot find module|Error:" | head -2 | sed 's/^/              /'
		FAILED=1
	fi
done

if [ "$FAILED" -ne 0 ]; then
	echo ""
	echo "FAIL: the packaged module is broken for consumers."
	echo "A module that fails to load here is almost always required at runtime but"
	echo "declared in devDependencies. Move it to dependencies in package.json."
	exit 1
fi

echo ""
echo "PASS: packaged module loads and runs in a clean consumer project."
