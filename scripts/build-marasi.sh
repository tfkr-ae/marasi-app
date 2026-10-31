#!/bin/sh
# Builds the bundled Marasi into resources/bin from the commit that
# package.json's "marasi" pin names, the one place the bundled version is
# set. Needs Go and git.
#
#   MARASI_SRC  a local Marasi checkout that has the pinned commit; read
#               only (git archive). Without it, the pin's repository is
#               cloned into a temporary directory.
#   GOOS/GOARCH build for another platform, as `npm run dist:win` does.
#               A Windows build is resources/bin/marasi.exe. GOOS=darwin
#               GOARCH=universal builds both Mac architectures into one
#               binary (lipo), for the universal app `npm run dist:mac` makes.
set -eu

cd "$(dirname "$0")/.."
root=$(pwd)

pin() { node -p "require('./package.json').marasi.$1"; }
repository=$(pin repository)
commit=$(pin commit)
version=$(pin version)

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

src=${MARASI_SRC:-}
if [ -z "$src" ]; then
	src="$work/repo"
	git clone --quiet --filter=blob:none --no-checkout "$repository" "$src"
fi
mkdir "$work/tree"
git -C "$src" archive --format=tar "$commit" | tar -x -C "$work/tree"

name=marasi
[ "${GOOS:-$(go env GOOS)}" = windows ] && name=marasi.exe
rm -rf "$root/resources/bin"
mkdir -p "$root/resources/bin"
build() { (cd "$work/tree" && CGO_ENABLED=0 GOWORK=off go build -trimpath -ldflags "-X 'main.version=$version'" -o "$1" ./cmd/marasi); }
if [ "${GOARCH:-}" = universal ]; then
	GOARCH=amd64 build "$work/marasi-amd64"
	GOARCH=arm64 build "$work/marasi-arm64"
	lipo -create -output "$root/resources/bin/$name" "$work/marasi-amd64" "$work/marasi-arm64"
else
	build "$root/resources/bin/$name"
fi
echo "Built Marasi $version ($commit) at resources/bin/$name"
