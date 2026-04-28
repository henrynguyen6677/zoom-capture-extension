NODE := $(shell which node)
NPX  := $(shell which npx)

VERSION := $(shell $(NODE) -p "require('./manifest.json').version")
DIST    := dist
ZIP     := zoom-capture-extension-v$(VERSION).zip

SRC_JS  := popup.js service_worker.js
SRC_CSS := popup.css
STATIC  := popup.html manifest.json icons/

.PHONY: all clean build zip

all: zip

clean:
	rm -rf $(DIST) $(ZIP)

build: clean
	@mkdir -p $(DIST)
	@echo "Minifying JS..."
	@for f in $(SRC_JS); do \
		npx --yes terser $$f -c -m -o $(DIST)/$$f; \
	done
	@echo "Minifying CSS..."
	@for f in $(SRC_CSS); do \
		npx --yes clean-css-cli -o $(DIST)/$$f $$f; \
	done
	@echo "Copying static files..."
	@cp popup.html $(DIST)/
	@cp manifest.json $(DIST)/
	@cp -r icons/ $(DIST)/icons/
	@echo "Build complete -> $(DIST)/"

zip: build
	@echo "Creating $(ZIP)..."
	@cd $(DIST) && zip -r ../$(ZIP) . -x "*.DS_Store"
	@echo ""
	@echo "=== Build Summary ==="
	@echo "Version: $(VERSION)"
	@echo "Package: $(ZIP)"
	@echo ""
	@echo "Original sizes:"
	@wc -c $(SRC_JS) $(SRC_CSS) | tail -1
	@echo "Minified sizes:"
	@wc -c $(addprefix $(DIST)/,$(SRC_JS) $(SRC_CSS)) | tail -1
	@echo ""
	@ls -lh $(ZIP)
	@echo ""
	@echo "Upload to: https://chrome.google.com/webstore/devconsole"
