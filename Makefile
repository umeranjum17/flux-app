.PHONY: dev build package clean lint test test-watch

dev:
	npm run dev

build:
	npm run package

package:
	npm run make

clean:
	rm -rf out/ dist/ .vite/

lint:
	npm run lint

install:
	npm install

test:
	npm run test

test-watch:
	npm run test:watch
