# Cross-compiles the daemon and mockbot for the Linux AppImage build.
# No cgo — every dependency is pure Go, which is what makes this trivial.
export CGO_ENABLED=0
export GOOS=linux
export GOARCH=amd64

DIST=dist

.PHONY: dev linux clean

# Host-native binaries, where electron/sidecar.cjs and the Playwright E2E
# look for them. GOOS/GOARCH are cleared so this builds for the machine you
# are on rather than the AppImage target above.
dev:
	GOOS= GOARCH= go build -o corelyn-studiod ./cmd/corelyn-studiod
	GOOS= GOARCH= go build -o corelyn-mockbot ./cmd/corelyn-mockbot

linux:
	mkdir -p $(DIST)
	go build -o $(DIST)/corelyn-studiod ./cmd/corelyn-studiod
	go build -o $(DIST)/corelyn-mockbot ./cmd/corelyn-mockbot

clean:
	rm -rf $(DIST)
