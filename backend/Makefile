# Cross-compiles the daemon and mockbot for the Linux AppImage build.
# No cgo — every dependency is pure Go, which is what makes this trivial.
export CGO_ENABLED=0
export GOOS=linux
export GOARCH=amd64

DIST=dist

.PHONY: linux clean

linux:
	mkdir -p $(DIST)
	go build -o $(DIST)/corelyn-studiod ./cmd/corelyn-studiod
	go build -o $(DIST)/corelyn-mockbot ./cmd/corelyn-mockbot

clean:
	rm -rf $(DIST)
