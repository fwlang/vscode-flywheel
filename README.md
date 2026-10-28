# Flywheel for Visual Studio Code

Syntax highlighting and editing support for Flywheel `.fw` and `.fly` files. This is a declarative extension: no compiler installation, language server, activation script, or runtime dependency is needed for highlighting.

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
- Nested markup, fragments, self-closing tags, component/module tag names, attributes, entities, and embedded expressions. A `#` inside markup text is ordinary text.
- Nested generic types such as `map<string, tuple<element?>>`, without treating the type arguments as markup.

The language configuration supplies comment toggling, bracket/quote pairing, block indentation, and `# region` / `# endregion` folding markers. Angle brackets are intentionally not paired automatically because they also represent comparisons and generic arguments.

Snippets include `fn`, `fn0`, `if`, `ifelse`, `for`, `while`, `try`, `class`, `component`, and `fragment`. `fn0` uses Flywheel's parentheses-free zero-argument declaration syntax.

## Development

Open **this directory** as a VS Code workspace and press **F5** to launch an Extension Development Host. Open a `.fw` or `.fly` file there. Use **Developer: Inspect Editor Tokens and Scopes** to inspect highlighting. Colors come from the active editor theme.

```sh
npm test
npm run package
```

Tests run the actual TextMate grammar through VS Code's Oniguruma tokenizer, covering nested markup/interpolation, self-closing nodes, generic/comparison boundaries, ranges, comments, and editor configuration. The packaging command creates `flywheel-language.vsix` in this directory.

TextMate highlighting is lexical, not a semantic parser. Custom parentheses-free calls and nominal types cannot always be distinguished from variable references. For an opening tag whose attributes begin on the next line, the grammar recognizes expression-start positions, standalone markup, `return`, and `print`; ambiguous incomplete expressions may need the remainder of the tag before highlighting settles. Compiler diagnostics, completion, navigation, formatting, and automatic closing-tag insertion are not supplied by this extension.
