import * as vscode from "vscode";
import { isInNonCodeContext } from "./goScan";
import {
  ParsedSymbol,
  inlineCodeSpans,
  isFenceLine,
  parseGoSymbol,
  symbolTokenAt,
} from "./symbolParser";

export interface GoSymbolRef extends ParsedSymbol {
  /** Text as written at the hover position. */
  readonly raw: string;
  /** Range to highlight for the hover. */
  readonly range: vscode.Range;
}

/** How many lines above/below the cursor to scan for a multi-line span. */
const SCAN_RADIUS = 5;

/** Markdown: the inline code span under the cursor. */
export function findInMarkdown(
  document: vscode.TextDocument,
  position: vscode.Position,
): GoSymbolRef | undefined {
  const span = findInlineCodeSpan(document, position);
  if (!span) {
    return undefined;
  }

  const parsed = parseGoSymbol(span.text);
  return parsed ? { ...parsed, raw: span.text, range: span.range } : undefined;
}

/** Go: the symbol token under the cursor, but only inside comments/strings. */
export function findInGoComments(
  document: vscode.TextDocument,
  position: vscode.Position,
): GoSymbolRef | undefined {
  if (!isInNonCodeContext(document, position)) {
    return undefined;
  }

  const token = symbolTokenAt(document.lineAt(position.line).text, position.character);
  if (!token) {
    return undefined;
  }

  const parsed = parseGoSymbol(token.text);
  if (!parsed) {
    return undefined;
  }

  return {
    ...parsed,
    raw: token.text,
    range: new vscode.Range(position.line, token.start, position.line, token.end),
  };
}

/**
 * Finds the inline code span containing `position`. Fenced code blocks are
 * skipped so ```go ... ``` blocks never trigger the hover.
 */
function findInlineCodeSpan(
  document: vscode.TextDocument,
  position: vscode.Position,
): { text: string; range: vscode.Range } | undefined {
  const first = Math.max(0, position.line - SCAN_RADIUS);
  const last = Math.min(document.lineCount - 1, position.line + SCAN_RADIUS);

  let inFence = false;
  for (let line = 0; line <= last; line++) {
    const text = document.lineAt(line).text;

    if (isFenceLine(text)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || line < first) {
      continue;
    }

    for (const span of inlineCodeSpans(text)) {
      const range = new vscode.Range(line, span.start, line, span.end);
      if (range.contains(position)) {
        return { text: span.text, range };
      }
    }
  }

  return undefined;
}
