# GoDoc Peek

Peek Go documentation for `pkg.Symbol` written **in text** — Markdown prose,
Go comments and string literals — anywhere gopls shows nothing.

The Go extension already gives you a full hover on real Go code. This extension
covers the gap left over: the places where you *mention* a Go symbol but are not
writing Go code.

## Where it triggers

### Markdown — inline code

Hover inside an inline code span that looks like a Go symbol:

| You write | Hover shows |
| --- | --- |
| `` `fmt.Println` `` | `go doc fmt.Println` |
| `` `fmt.Println(a, b)` `` | argument lists are stripped |
| `` `(*http.Client).Do` `` | method syntax is normalized to `http.Client.Do` |
| `` `net/http.Client.Do` `` | full import paths work |
| `` `github.com/gin-gonic/gin.Context` `` | third-party packages work |
| `` `net/http` `` | package-level documentation |

Fenced code blocks are ignored, and plain words like `` `foo.bar` `` or
`` `src/main.go` `` never trigger anything — the symbol must look like an
exported Go identifier or a bare import path.

### Go — comments and string literals

gopls does not document a symbol that is only *mentioned* in a comment or a
string. GoDoc Peek does:

```go
// Uses fmt.Println internally, see net/http.Client.Do.
func Log(msg string) {
	// "errors.New 也可以 hover"
}
```

Real Go code is never touched: the extension only fires when the cursor is
inside a `//` comment, a block comment, or a string literal. It runs alongside
gopls instead of competing with it — turn it off with
`godocPeek.goComments.enabled` if you find it noisy.

## Where the documentation comes from

1. **Local `go doc`** (default). Run in the nearest directory containing a
   `go.mod`, walking up from the current file, so stdlib and the workspace's own
   dependencies resolve. Standard library symbols work even outside a module.
2. **Network fallback.** If `go doc` reports that the package is not in the
   module graph, the extension runs `go get` for it inside a scratch module
   under the extension's global storage, then retries `go doc`. The first fetch
   can take a while; the result is cached afterwards.

Results are cached for 5 minutes (misses for 2 minutes). Use **GoDoc Peek:
Clear Documentation Cache** to drop them. Log output goes to the **GoDoc Peek**
Output channel — it never steals focus.

The Go binary is taken from `go.alternateTools` when configured, otherwise `go`
from `PATH`. The Go extension for VS Code is **not** required.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `godocPeek.markdown.enabled` | `true` | Hover in Markdown inline code spans. |
| `godocPeek.goComments.enabled` | `true` | Hover in Go comments and string literals. |
| `godocPeek.networkFallback` | `true` | `go get` a missing package into a scratch module and retry. |
| `godocPeek.maxLines` | `40` | Truncate the hover after this many lines. |
| `godocPeek.goDoc.workingDirectory` | `""` | Directory to run `go doc` in; empty means "find the nearest `go.mod`". |

## Commands

* GoDoc Peek: Clear Documentation Cache
* GoDoc Peek: Show Log

## Development

```bash
npm install
npm run validate   # tsc + eslint
code . && F5       # launch an Extension Host
```

`symbolParser.ts` has no `vscode` import, so the parsing rules can be exercised
directly with node against `out/symbolParser.js`.
