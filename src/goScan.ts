import * as vscode from "vscode";

/**
 * Minimal Go lexer, good enough to answer one question: is `position` inside a
 * comment or a string literal? That is exactly where gopls does not provide a
 * hover, so it is where this extension steps in.
 */
enum ScanState {
  Normal,
  LineComment,
  BlockComment,
  String,
  RawString,
  Rune,
}

/**
 * Returns true when the cursor sits inside a `//` comment, a block comment or
 * a string literal — i.e. anywhere gopls will not show documentation.
 */
export function isInNonCodeContext(
  document: vscode.TextDocument,
  position: vscode.Position,
): boolean {
  let state = ScanState.Normal;

  for (let line = 0; line < position.line; line++) {
    state = scanLine(document.lineAt(line).text, state);
  }

  const prefix = document.lineAt(position.line).text.slice(0, position.character);
  return scanLine(prefix, state) !== ScanState.Normal;
}

function scanLine(text: string, state: ScanState): ScanState {
  // A `//` comment, a rune and a normal string cannot span lines. An unterminated
  // one is treated as closed so the lexer never gets stuck.
  if (
    state === ScanState.LineComment ||
    state === ScanState.String ||
    state === ScanState.Rune
  ) {
    state = ScanState.Normal;
  }

  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];

    switch (state) {
      case ScanState.Normal:
        if (c === "/" && next === "/") {
          state = ScanState.LineComment;
          i += 2;
        } else if (c === "/" && next === "*") {
          state = ScanState.BlockComment;
          i += 2;
        } else if (c === '"') {
          state = ScanState.String;
          i++;
        } else if (c === "`") {
          state = ScanState.RawString;
          i++;
        } else if (c === "'") {
          state = ScanState.Rune;
          i++;
        } else {
          i++;
        }
        break;

      case ScanState.LineComment:
        i = text.length;
        break;

      case ScanState.BlockComment:
        if (c === "*" && next === "/") {
          state = ScanState.Normal;
          i += 2;
        } else {
          i++;
        }
        break;

      case ScanState.String:
        if (c === "\\") {
          i += 2;
        } else if (c === '"') {
          state = ScanState.Normal;
          i++;
        } else {
          i++;
        }
        break;

      case ScanState.RawString:
        if (c === "`") {
          state = ScanState.Normal;
          i++;
        } else {
          i++;
        }
        break;

      case ScanState.Rune:
        if (c === "\\") {
          i += 2;
        } else if (c === "'") {
          state = ScanState.Normal;
          i++;
        } else {
          i++;
        }
        break;
    }
  }

  return state;
}
