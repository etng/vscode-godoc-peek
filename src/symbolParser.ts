/**
 * Pure helpers for turning a piece of text into a Go symbol reference.
 * Intentionally free of any `vscode` import so the parsing rules can be
 * exercised without the editor runtime.
 */

export interface ParsedSymbol {
  /** Normalized symbol, e.g. `Client.Do`. Empty when only a package is given. */
  readonly symbol: string;
  /** Package name, e.g. `http`. */
  readonly pkgName: string;
  /** Best guess at the import path, e.g. `net/http`. */
  readonly importPath: string;
  /** `go doc` argument candidates, most specific first. */
  readonly queries: readonly string[];
}

const FENCE_LINE = /^\s{0,3}(?:`{3,}|~{3,})/;
const INLINE_CODE = /`([^`\n]+)`/g;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PATH_SEGMENT = /^[a-z0-9][A-Za-z0-9_.-]*$/;
const MAX_SYMBOL_LENGTH = 160;

/**
 * Cleans up the many ways people write a Go symbol in prose:
 * `fmt.Println(a, b)`, `(*http.Client).Do`, `sync.Map{}`, `pkg.Func[T]`.
 */
function normalize(raw: string): string {
  return raw
    .trim()
    .replace(/^(?:go\s+doc|godoc)\s+/i, "")
    .replace(/\(.*\)$/, "") // drop a call argument list
    .replace(/\(\*/g, "") // (*T).Method
    .replace(/\)/g, "")
    .replace(/\[[^\]]*\]/g, "") // generics
    .replace(/^[*&]+/, "")
    .replace(/[,;{}]+$/g, "")
    .trim();
}

/** Exported symbol chain: `Println`, `Client.Do`, `Header.Get`. */
function isSymbolChain(value: string): boolean {
  if (!value) {
    return false;
  }
  return value.split(".").every((part) => /^[A-Z][A-Za-z0-9_]*$/.test(part));
}

/**
 * `net/http`, `encoding/json` (stdlib shape) or `github.com/foo/bar`
 * (domain shape). Rejects things like `src/main.go`.
 */
function looksLikeImportPath(value: string): boolean {
  const parts = value.split("/");
  if (!parts.every((part) => PATH_SEGMENT.test(part))) {
    return false;
  }
  return parts[0].includes(".") || (parts.length === 2 && !parts[1].includes("."));
}

function buildRef(
  pkgName: string,
  importPath: string,
  symbol: string,
): ParsedSymbol {
  const queries = symbol
    ? [`${importPath}.${symbol}`, `${importPath} ${symbol}`, `${pkgName}.${symbol}`]
    : [importPath];

  return { symbol, pkgName, importPath, queries: [...new Set(queries)] };
}

export function parseGoSymbol(raw: string): ParsedSymbol | undefined {
  const text = normalize(raw);
  if (!text || text.length > MAX_SYMBOL_LENGTH) {
    return undefined;
  }

  const slashIdx = text.lastIndexOf("/");
  const head = slashIdx >= 0 ? text.slice(slashIdx + 1) : text;
  const dotIdx = head.indexOf(".");

  if (dotIdx < 0) {
    // No dot: only interesting when it is a bare import path (net/http).
    if (slashIdx < 0 || !looksLikeImportPath(text)) {
      return undefined;
    }
    return buildRef(head, text, "");
  }

  // `gopkg.in/yaml.v3`: the dot belongs to the import path, not a symbol.
  if (slashIdx >= 0 && looksLikeImportPath(text)) {
    if (!isSymbolChain(head.slice(dotIdx + 1))) {
      return buildRef(head, text, "");
    }
  }

  const pkgName = head.slice(0, dotIdx);
  const symbol = head.slice(dotIdx + 1);
  const importPath = slashIdx >= 0 ? text.slice(0, slashIdx + 1) + pkgName : pkgName;

  if (!IDENTIFIER.test(pkgName) || !isSymbolChain(symbol)) {
    return undefined;
  }
  if (slashIdx >= 0 && !looksLikeImportPath(importPath)) {
    return undefined;
  }

  return buildRef(pkgName, importPath, symbol);
}

export function isFenceLine(line: string): boolean {
  return FENCE_LINE.test(line);
}

/** Yields every inline code span of a single line, with its inner text. */
export function* inlineCodeSpans(
  line: string,
): Generator<{ text: string; start: number; end: number }> {
  INLINE_CODE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_CODE.exec(line)) !== null) {
    const start = match.index + 1;
    yield { text: match[1], start, end: start + match[1].length };
  }
}

const TOKEN_CHAR = /[A-Za-z0-9_.\-/]/;
const TOKEN_EDGE = /[.\-/]/;

/**
 * Extracts the symbol token surrounding `character` on a line. Used inside Go
 * comments and strings, where there is no syntax tree to lean on.
 */
export function symbolTokenAt(
  line: string,
  character: number,
): { text: string; start: number; end: number } | undefined {
  if (character >= line.length || !TOKEN_CHAR.test(line[character])) {
    return undefined;
  }

  let start = character;
  let end = character;
  while (start > 0 && TOKEN_CHAR.test(line[start - 1])) {
    start--;
  }
  while (end < line.length && TOKEN_CHAR.test(line[end])) {
    end++;
  }
  while (start < end && TOKEN_EDGE.test(line[start])) {
    start++;
  }
  while (end > start && TOKEN_EDGE.test(line[end - 1])) {
    end--;
  }

  if (start >= end) {
    return undefined;
  }
  return { text: line.slice(start, end), start, end };
}
