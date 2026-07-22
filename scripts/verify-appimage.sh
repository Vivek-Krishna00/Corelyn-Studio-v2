#!/usr/bin/env bash
# Verifies the packaged Linux AppImage on a real Ubuntu machine — the one
# thing the macOS dev box cannot check (see the DoD 4 note in
# docs/superpowers/plans/2026-07-22-corelyn-studio-v2-go.md).
#
#   ./scripts/verify-appimage.sh [path/to/Corelyn Studio-0.1.0.AppImage]
#
# Checks, in order: architecture, the shared libraries the bundle needs,
# whether it launches, and that the database lands under $HOME/.config rather
# than beside the read-only mount.
set -uo pipefail

APPIMAGE="${1:-}"
if [ -z "$APPIMAGE" ]; then
  APPIMAGE=$(ls release/*.AppImage 2>/dev/null | head -1)
fi
if [ ! -f "$APPIMAGE" ]; then
  echo "no AppImage found — pass one as an argument, or build with:"
  echo "  make -C backend linux && npm run electron:build:linux"
  exit 1
fi

fail=0
note() { printf '\n== %s\n' "$1"; }
bad()  { printf '   FAIL  %s\n' "$1"; fail=1; }
good() { printf '   ok    %s\n' "$1"; }

note "architecture"
host_arch=$(uname -m)
# ELF e_machine, low byte at offset 18: 3e = x86-64, b7 = aarch64. Read it
# directly rather than depending on file(1), which a minimal install lacks.
case "$(od -An -t x1 -j 18 -N 1 "$APPIMAGE" | tr -d ' ')" in
  3e) img_arch=x86_64 ;;
  b7) img_arch=aarch64 ;;
  *)  img_arch=unknown ;;
esac
echo "   host=$host_arch  image=$img_arch"
if [ "$host_arch" = "$img_arch" ]; then
  good "architectures match"
else
  bad "architecture mismatch — rebuild for $host_arch:"
  echo "         make -C backend linux && npm run electron:build:linux"
fi

note "shared libraries"
# Extract rather than mount: --appimage-extract needs no FUSE, and Ubuntu
# 22.04 ships without libfuse2, which is the usual first stumble here.
workdir=$(mktemp -d)
image_abs=$(readlink -f "$APPIMAGE")
( cd "$workdir" && "$image_abs" --appimage-extract >/dev/null 2>&1 )
root="$workdir/squashfs-root"

if [ -d "$root" ]; then
  missing=$(ldd "$root"/corelyn-studio 2>/dev/null | grep 'not found' | awk '{print $1}' | sort)
  if [ -z "$missing" ]; then
    good "every library the Electron binary needs is present"
  else
    bad "missing $(echo "$missing" | wc -l) libraries:"
    echo "$missing" | sed 's/^/         /'
    echo "         install with:"
    echo "         sudo apt install -y libgtk-3-0 libnss3 libasound2 libgbm1 \\"
    echo "                             libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \\"
    echo "                             libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libpango-1.0-0"
  fi

  # The sidecar is built CGO_ENABLED=0 and should need nothing at all.
  if "$root"/resources/bin/corelyn-studiod --help >/dev/null 2>&1; then
    good "Go sidecar runs with no system dependencies"
  else
    bad "Go sidecar will not start — it is meant to be fully static"
  fi
else
  bad "could not extract the AppImage"
  echo "         if this host is not $img_arch, that is expected — the runtime"
  echo "         sets ELF ABI version 65 and most emulators refuse to exec it"
fi

note "FUSE (needed to run the AppImage without extracting)"
if ldconfig -p 2>/dev/null | grep -q libfuse.so.2; then
  good "libfuse2 present"
else
  echo "   libfuse2 missing — Ubuntu 22.04 does not ship it. Either"
  echo "     sudo apt install -y libfuse2"
  echo "   or run the image as: '$APPIMAGE' --appimage-extract-and-run"
fi

note "launch"
# Never delete this file: on a machine that has actually run the app it holds
# the operator's programs, version history, and audit trail. Watch for a
# change instead.
db="$HOME/.config/Corelyn Studio/corelyn.db"
db_before=$(stat -c %Y "$db" 2>/dev/null || echo none)
if [ "$db_before" != none ]; then
  echo "   note: a database already exists here and will be left alone"
fi
if [ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
  echo "   no display — skipping. Run this from a desktop session, or:"
  echo "     xvfb-run -a ./scripts/verify-appimage.sh"
else
  "$APPIMAGE" --appimage-extract-and-run >/tmp/corelyn-appimage.log 2>&1 &
  app_pid=$!
  for _ in $(seq 1 30); do
    [ "$(stat -c %Y "$db" 2>/dev/null || echo none)" != "$db_before" ] && break
    sleep 1
  done
  if pgrep -f corelyn-studiod >/dev/null; then
    good "daemon sidecar started"
  else
    bad "daemon sidecar did not start (see /tmp/corelyn-appimage.log)"
  fi
  if [ "$(stat -c %Y "$db" 2>/dev/null || echo none)" != "$db_before" ]; then
    good "database written under \$HOME/.config, not beside the read-only mount"
  else
    bad "nothing written to \$HOME/.config after 30s"
  fi
  kill "$app_pid" 2>/dev/null
  sleep 2
  if pgrep -f corelyn-studiod >/dev/null; then
    bad "daemon outlived the app — the sidecar is orphaned"
    pkill -f corelyn-studiod
  else
    good "daemon exited with the app"
  fi
fi

rm -rf "$workdir"
note "result"
if [ "$fail" -eq 0 ]; then echo "   all checks passed"; else echo "   some checks failed (see FAIL above)"; fi
exit "$fail"
