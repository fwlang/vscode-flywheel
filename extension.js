// Starts `flywheel lsp` for Flywheel files and connects it to VS Code's language features:
// diagnostics, hover, go to definition, references, rename, completion, document symbols,
// and formatting. A small JSON-RPC client keeps the extension free of runtime dependencies.
'use strict';
const { spawn } = require('node:child_process');

// Splits a byte stream into LSP messages: `Content-Length: n\r\n\r\n` + n bytes of JSON.
// Returns the parsed messages and the unconsumed remainder.
function parseMessages(buffer) {
  const messages = [];
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) break;
    const header = buffer.subarray(0, headerEnd).toString('ascii');
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.subarray(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    if (buffer.length < headerEnd + 4 + length) break;
    messages.push(JSON.parse(buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString('utf8')));
    buffer = buffer.subarray(headerEnd + 4 + length);
  }
  return { messages, rest: buffer };
}

function frame(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]);
}

class Client {
  constructor(command, onNotification, onExit) {
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
    this.process = spawn(command, ['lsp'], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.process.stdout.on('data', chunk => {
      const { messages, rest } = parseMessages(Buffer.concat([this.buffer, chunk]));
      this.buffer = rest;
      for (const message of messages) {
        if (message.id !== undefined && this.pending.has(message.id)) {
          const { resolve, reject } = this.pending.get(message.id);
          this.pending.delete(message.id);
          if (message.error) reject(new Error(message.error.message));
          else resolve(message.result);
        } else if (message.method) onNotification(message.method, message.params);
      }
    });
    this.process.on('error', error => onExit(error));
    this.process.on('exit', code => {
      for (const { reject } of this.pending.values()) reject(new Error('language server exited'));
      this.pending.clear();
      onExit(code === 0 || code === null ? null : new Error(`flywheel lsp exited with code ${code}`));
    });
  }
  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.process.stdin.write(frame({ jsonrpc: '2.0', id, method, params }));
    });
  }
  notify(method, params) {
    this.process.stdin.write(frame({ jsonrpc: '2.0', method, params }));
  }
}

function activate(context) {
  const vscode = require('vscode');
  const config = vscode.workspace.getConfiguration('flywheel');
  if (!config.get('languageServer.enabled', true)) return;
  const selector = [{ language: 'flywheel' }];
  const diagnostics = vscode.languages.createDiagnosticCollection('flywheel');
  context.subscriptions.push(diagnostics);
  let alive = true;
  const client = new Client(
    config.get('path', 'flywheel'),
    (method, params) => {
      if (method !== 'textDocument/publishDiagnostics') return;
      diagnostics.set(
        vscode.Uri.parse(params.uri),
        params.diagnostics.map(d => {
          const item = new vscode.Diagnostic(range(d.range), d.message, vscode.DiagnosticSeverity.Error);
          item.source = 'flywheel';
          return item;
        }),
      );
    },
    error => {
      alive = false;
      if (error)
        vscode.window.showWarningMessage(
          `Flywheel language server unavailable (${error.message}). Set "flywheel.path" to the flywheel compiler.`,
        );
    },
  );
  const position = p => new vscode.Position(p.line, p.character);
  const range = r => new vscode.Range(position(r.start), position(r.end));
  const location = l => new vscode.Location(vscode.Uri.parse(l.uri), range(l.range));
  const at = (document, p) => ({ textDocument: { uri: document.uri.toString() }, position: { line: p.line, character: p.character } });
  const ask = (method, params) => (alive ? client.request(method, params).catch(() => null) : Promise.resolve(null));
  const flywheel = document => document.languageId === 'flywheel';

  const ready = client.request('initialize', { processId: process.pid, rootUri: null, capabilities: {} }).then(() => {
    client.notify('initialized', {});
    for (const document of vscode.workspace.textDocuments) open(document);
  }).catch(() => {});
  function open(document) {
    if (!flywheel(document) || !alive) return;
    client.notify('textDocument/didOpen', {
      textDocument: { uri: document.uri.toString(), languageId: 'flywheel', version: document.version, text: document.getText() },
    });
  }
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(document => ready.then(() => open(document))),
    vscode.workspace.onDidChangeTextDocument(event => {
      if (!flywheel(event.document) || !alive) return;
      ready.then(() =>
        client.notify('textDocument/didChange', {
          textDocument: { uri: event.document.uri.toString(), version: event.document.version },
          contentChanges: [{ text: event.document.getText() }],
        }),
      );
    }),
    vscode.workspace.onDidCloseTextDocument(document => {
      if (!flywheel(document) || !alive) return;
      diagnostics.delete(document.uri);
      client.notify('textDocument/didClose', { textDocument: { uri: document.uri.toString() } });
    }),
    vscode.languages.registerHoverProvider(selector, {
      provideHover: async (document, p) => {
        const result = await ask('textDocument/hover', at(document, p));
        return result ? new vscode.Hover(new vscode.MarkdownString(result.contents.value)) : null;
      },
    }),
    vscode.languages.registerDefinitionProvider(selector, {
      provideDefinition: async (document, p) => {
        const result = await ask('textDocument/definition', at(document, p));
        return result ? location(result) : null;
      },
    }),
    vscode.languages.registerReferenceProvider(selector, {
      provideReferences: async (document, p) => ((await ask('textDocument/references', at(document, p))) || []).map(location),
    }),
    vscode.languages.registerRenameProvider(selector, {
      provideRenameEdits: async (document, p, newName) => {
        const result = await client.request('textDocument/rename', { ...at(document, p), newName });
        const edit = new vscode.WorkspaceEdit();
        for (const [uri, edits] of Object.entries(result.changes || {}))
          for (const e of edits) edit.replace(vscode.Uri.parse(uri), range(e.range), e.newText);
        return edit;
      },
    }),
    vscode.languages.registerCompletionItemProvider(
      selector,
      {
        provideCompletionItems: async (document, p) => {
          const result = await ask('textDocument/completion', at(document, p));
          return (result ? result.items : []).map(item => {
            const completion = new vscode.CompletionItem(item.label, item.kind - 1);
            completion.detail = item.detail;
            return completion;
          });
        },
      },
      '.',
    ),
    vscode.languages.registerDocumentSymbolProvider(selector, {
      provideDocumentSymbols: async document => {
        const result = await ask('textDocument/documentSymbol', { textDocument: { uri: document.uri.toString() } });
        return (result || []).map(
          s => new vscode.SymbolInformation(s.name, s.kind - 1, s.containerName || '', location(s.location)),
        );
      },
    }),
    vscode.languages.registerDocumentFormattingEditProvider(selector, {
      provideDocumentFormattingEdits: async document => {
        const result = await ask('textDocument/formatting', {
          textDocument: { uri: document.uri.toString() },
          options: { tabSize: 4, insertSpaces: true },
        });
        return (result || []).map(e => vscode.TextEdit.replace(range(e.range), e.newText));
      },
    }),
    {
      dispose: () => {
        if (!alive) return;
        client.request('shutdown', null).finally(() => client.notify('exit', null));
      },
    },
  );
}

function deactivate() {}

module.exports = { activate, deactivate, parseMessages, frame };
