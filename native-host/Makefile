BINARY_NAME := zoom-native-host
VERSION     := 2.0.0
BUILD_DIR   := build

PLATFORMS := darwin/arm64 darwin/amd64 windows/arm64 windows/amd64 linux/amd64 linux/arm64

.PHONY: all clean build release

all: build

clean:
	rm -rf $(BUILD_DIR)

build:
	@mkdir -p $(BUILD_DIR)
	@echo "Building $(BINARY_NAME) for current platform..."
	@go build -ldflags="-s -w" -o $(BUILD_DIR)/$(BINARY_NAME) .
	@ls -lh $(BUILD_DIR)/$(BINARY_NAME)

release: clean
	@mkdir -p $(BUILD_DIR)
	@echo "Cross-compiling for all platforms..."
	@for platform in $(PLATFORMS); do \
		OS=$${platform%%/*}; \
		ARCH=$${platform##*/}; \
		EXT=""; \
		if [ "$$OS" = "windows" ]; then EXT=".exe"; fi; \
		OUTPUT="$(BUILD_DIR)/$(BINARY_NAME)-$$OS-$$ARCH$$EXT"; \
		echo "  → $$OS/$$ARCH"; \
		GOOS=$$OS GOARCH=$$ARCH go build -ldflags="-s -w" -o $$OUTPUT . || exit 1; \
	done
	@echo ""
	@echo "=== Build Summary ==="
	@ls -lh $(BUILD_DIR)/
	@echo ""
	@echo "Upload binaries to GitHub Releases"
