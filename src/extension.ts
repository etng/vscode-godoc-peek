import * as vscode from "vscode";
import { clearGoDocCache, configureGoDoc } from "./goDoc";
import { registerHover } from "./hoverProvider";
import { showLog } from "./outputChannel";

export function activate(context: vscode.ExtensionContext): void {
  configureGoDoc(context);
  registerHover(context);

  context.subscriptions.push(
    vscode.commands.registerCommand("godocPeek.clearCache", () => {
      clearGoDocCache();
      vscode.window.showInformationMessage("GoDoc Peek: 文档缓存已清空");
    }),
    vscode.commands.registerCommand("godocPeek.showLog", showLog),
  );
}

export function deactivate(): void {
  // nothing to do
}
