# go-repo

A hand-designed Go repo for the Go adapter's conformance tests (lib/index/languages/go/, through
test/helpers/adapter-conformance.ts). Its ground truth is test/helpers/go-repo-truth.ts, derived by hand from these
files: change a file here and re-derive the truth by hand.

Two modules (`example.com/shop` at the root, `example.com/shop/tools` in tools/), a package split over two files
(internal/store), aliased, blank and dot imports, build-tag twins (internal/paths), internal and external test
packages, a package whose folder name isn't its name (pkg/go-colors), a /v2 folder (pkg/widgets/v2), a vendor/ folder
the root go.mod leaves out, and a broken file (internal/api/broken.go). None of it is meant to build.
