import * as vscode from "vscode";

const outputChannel = vscode.window.createOutputChannel("GoDoc Peek");

/** Appends a log line without stealing focus. */
export function log(message: string): void {
  outputChannel.appendLine(message);
}

export function showLog(): void {
  outputChannel.show();
}
