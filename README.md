# Flywheel for Visual Studio Code

Syntax highlighting, editing support, and language server features for Flywheel `.fw` and `.fly` files. Highlighting and snippets need nothing else installed; the language features start `flywheel lsp` from the Flywheel compiler.

## Language server

When a Flywheel file opens, the extension starts `flywheel lsp` and provides:

- diagnostics from the compiler's semantic check (the first error per check),
- hover with the declaration and its `#` documentation comment,
- go to definition and find references, across local modules,
- rename of variables, parameters, functions, classes, fields, and methods,
- completion of names in scope, module members after `module.`, and class members after `inst`,
- the document outline (symbols), and
- whole-document formatting (`flywheel fmt`).

| Setting | Default | Meaning |
|---|---|---|
| `flywheel.path` | `flywheel` | the compiler executable that serves `flywheel lsp` |
| `flywheel.languageServer.enabled` | `true` | set to `false` for highlighting and snippets only |

If the compiler cannot be started, the extension shows one warning and keeps highlighting. The client is a small JSON-RPC implementation in `extension.js`, so the packaged extension has no runtime dependencies.

## Install locally

From this directory, build the extension package:

```sh
npm ci
npm test
npm run package
code --install-extension ./flywheel-language.vsix
```

Alternatively, choose **Extensions → … → Install from VSIX…** in VS Code and select `fw-vscode/flywheel-language.vsix`. Reopen an existing Flywheel file if necessary, or use **Change Language Mode → Flywheel**.

Node.js 22 or later is needed only to run the development and packaging tools. The installed extension contains just the language configuration, TextMate grammar, and snippets; development dependencies are excluded.

## Highlighting

- Declarations, visibility modifiers, imports, control flow, built-in functions (including `input`), types, and typed errors.
- Strings with escapes, doubled literal braces, and nested expression interpolation.
- Numbers, inclusive/exclusive ranges, arithmetic, comparisons, and logical operators. `#` is a comment; `//` is integer division.
- Nested markup, fragments, self-closing tags, component/module tag names, attributes (double-, single-quoted, unquoted, `{expression}`, and valueless), entities, and embedded expressions. HTML comments (`<!-- -->`) are highlighted; `#` is never a comment inside markup, including its `{expression}`s. Attribute names such as `class` are not keywords.
- CSS inside `<style>` (selectors, rule blocks, properties, values, units, colors, functions, at-rules, comments) and JavaScript inside `<script>` (keywords, strings, template literals, numbers, comments, calls, properties, operators). Both stay markup text: as in the compiler, a `{` followed by whitespace, a `}` beside whitespace, and `{{`/`}}` are literal braces, while `{expression}` still interpolates. `#` is not a comment there. Comment toggling in these regions uses CSS/JavaScript comments.
- Nested generic types such as `map<string, tuple<element?>>`, without treating the type arguments as markup.

The language configuration supplies comment toggling, bracket/quote pairing, block indentation, and `# region` / `# endregion` folding markers. Angle brackets are intentionally not paired automatically because they also represent comparisons and generic arguments.

Snippets include `fn`, `fn0`, `if`, `ifelse`, `for`, `while`, `try`, `class`, `component`, and `fragment`. `fn0` uses Flywheel's parentheses-free zero-argument declaration syntax.

## Development

Open **this directory** as a VS Code workspace and press **F5** to launch an Extension Development Host. Open a `.fw` or `.fly` file there. Use **Developer: Inspect Editor Tokens and Scopes** to inspect highlighting. Colors come from the active editor theme.

```sh
npm test
npm run package
```

Tests check the language server message framing and run the actual TextMate grammar through VS Code's Oniguruma tokenizer, covering nested markup/interpolation, self-closing nodes, generic/comparison boundaries, ranges, comments, and editor configuration. The packaging command creates `flywheel-language.vsix` in this directory.

TextMate highlighting is lexical, not a semantic parser. Custom parentheses-free calls and nominal types cannot always be distinguished from variable references. For an opening tag whose attributes begin on the next line, the grammar recognizes expression-start positions, standalone markup, `return`, and `print`; ambiguous incomplete expressions may need the remainder of the tag before highlighting settles. Automatic closing-tag insertion is not supplied by this extension.
