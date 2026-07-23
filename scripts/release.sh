#!/usr/bin/env bash
# Local release rehearsal only. Publishing is exclusively tag-triggered CI.
set -euo pipefail

version="$(bun -e 'console.log((await Bun.file("package.json").json()).version)')"
output="release-dist"

if [ -e "$output" ]; then
  echo "Refusing to overwrite $output; move or remove it explicitly." >&2
  exit 1
fi

mkdir -p "$output"
for platform in darwin-arm64 darwin-x64 linux-arm64 linux-x64; do
  target="bun-${platform}"
  case "$platform" in *-x64) target="${target}-baseline";; esac
  bun build --compile --minify --target="$target" --outfile="${output}/grain-${platform}" src/cli.ts
done

if command -v shasum >/dev/null 2>&1; then
  (cd "$output" && shasum -a 256 grain-* > SHA256SUMS)
else
  (cd "$output" && sha256sum grain-* > SHA256SUMS)
fi

printf 'Built Grain v%s release rehearsal in %s.\n' "$version" "$output"
printf 'No files were committed, tagged, pushed, or published.\n'
