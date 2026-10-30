import * as vscode from "vscode";
import { GoSymbolRef, findInGoComments, findInMarkdown } from "./symbolLocator";
import { GoDocResult, resolveGoDoc, resolveGoWorkingDirectory } from "./goDoc";
import { log } from "./outputChannel";

const SELECTOR: vscode.DocumentSelector = [{ language: "markdown" }, { language: "go" }];

export function registerHover(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(SELECTOR, {
      async provideHover(document, position, token) {
        const ref = locate(document, position);
        if (!ref) {
          return undefined;
        }
        log(`[hover] ${document.languageId} 定位到 ${ref.raw} → ${ref.queries[0]}`);

        const doc = await resolveGoDoc(ref, resolveGoWorkingDirectory(document), token);
        if (!doc) {
          return undefined;
        }

        return new vscode.Hover(buildHoverContent(ref, doc), ref.range);
      },
    }),
  );
}

function locate(
  document: vscode.TextDocument,
  position: vscode.Position,
): GoSymbolRef | undefined {
  const config = vscode.workspace.getConfiguration("godocPeek");

  if (document.languageId === "go") {
    return config.get<boolean>("goComments.enabled", true)
      ? findInGoComments(document, position)
      : undefined;
  }

  return config.get<boolean>("markdown.enabled", true)
    ? findInMarkdown(document, position)
    : undefined;
}

function buildHoverContent(ref: GoSymbolRef, doc: GoDocResult): vscode.MarkdownString {
  const maxLines = vscode.workspace
    .getConfiguration("godocPeek")
    .get<number>("maxLines", 40);

  const markdown = new vscode.MarkdownString();
  markdown.appendCodeblock(truncate(doc.text, Math.max(5, maxLines)), "go");

  const footer = [`\`${doc.command}\``, doc.source];
  const link = pkgGoDevLink(ref);
  if (link) {
    footer.push(`[pkg.go.dev](${link})`);
  }
  markdown.appendMarkdown(`\n\n---\n\n${footer.join(" · ")}\n`);

  return markdown;
}

function pkgGoDevLink(ref: GoSymbolRef): string | undefined {
  if (!ref.importPath) {
    return undefined;
  }
  const anchor = ref.symbol ? `#${ref.symbol.split(".")[0]}` : "";
  return `https://pkg.go.dev/${ref.importPath}${anchor}`;
}

function truncate(text: string, maxLines: number): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) {
    return text;
  }
  return `${lines.slice(0, maxLines).join("\n")}\n…（已截断，共 ${lines.length} 行）`;
}
