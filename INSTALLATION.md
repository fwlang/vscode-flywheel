# Installing the Flywheel VS Code extension

The extension adds syntax highlighting and snippets for `.fw` and `.fly` files. When the Flywheel compiler is available, it also starts `flywheel lsp` for diagnostics, hover, navigation, rename, completion, and formatting.

You install it from a `.vsix` package built from this directory.

## Requirements

| | Needed for |
|---|---|
| VS Code 1.85 or later | Using the extension |
| [Flywheel](../INSTALLATION.md) | Language features; highlighting works without it |
| Node.js 22 or later, with npm | Building the `.vsix` only |

The finished extension has no runtime dependencies. Once a `.vsix` is built, you can copy it to other machines and install it there without Node.js.

## Linux

### 1. Install Node.js

| Distribution | Command |
|---|---|
| Arch | `sudo pacman -S nodejs npm` |
| Debian / Ubuntu | Install Node.js 22 from <https://nodejs.org> or NodeSource; the distribution's package is often older |
| Fedora | `sudo dnf install nodejs npm` |

Check that `node --version` reports v22 or later.

### 2. Build the package

From this directory:

```sh
npm ci
npm test
npm run package
```

This creates `flywheel-language.vsix` in this directory.

### 3. Install it into VS Code

```sh
code --install-extension ./flywheel-language.vsix
```

If the `code` command isn't available, open VS Code instead. Go to **Extensions**, choose **… → Install from VSIX…**, and select the file.

## Windows

### 1. Install Node.js

Install the Node.js 22 LTS (or later) from <https://nodejs.org>, or run:

```powershell
winget install OpenJS.NodeJS.LTS
```

Open a new terminal, then check `node --version`.

### 2. Build the package

From this directory, in PowerShell:

```powershell
npm ci
npm test
npm run package
```

### 3. Install it into VS Code

```powershell
code --install-extension .\flywheel-language.vsix
```

The VS Code installer puts `code` on `PATH` by default. If that's not the case, use **Extensions → … → Install from VSIX…**.

## Connecting the language server

By default, the extension runs `flywheel` from `PATH`. If VS Code can't find it, the extension shows a single warning ("Flywheel language server unavailable") and keeps highlighting.

To point it at the compiler, open **Settings** and search for **Flywheel**, or edit `settings.json`:

```jsonc
// Linux
"flywheel.path": "/home/you/.local/flywheel/bin/flywheel"

// Windows
"flywheel.path": "C:\\Users\\you\\AppData\\Local\\Programs\\Flywheel\\bin\\flywheel.exe"
```

To use highlighting and snippets only, set `"flywheel.languageServer.enabled": false`.

After changing a setting, reload the window (**Developer: Reload Window**).

## Check it works

Open a `.fw` file. The status bar should show **Flywheel** as the language, and keywords should be coloured. Introduce an error, such as an undefined name. A diagnostic should appear within a moment if the language server is running.

If an already-open file isn't highlighted, reopen it, or use **Change Language Mode → Flywheel**.

## Updating and uninstalling

To update, pull the new sources, rebuild the `.vsix`, and install it again. The new version replaces the old one.

To uninstall:

```sh
code --uninstall-extension fwlang.flywheel-language
```

Or use **Extensions → Flywheel → Uninstall**.

## Troubleshooting

| Problem | Fix |
|---|---|
| `npm ci` fails | Check `node --version` (22+ is required); delete `node_modules` and retry |
| "Flywheel language server unavailable" | Set `flywheel.path` to the compiler, and check that `flywheel lsp` starts in a terminal |
| No diagnostics, but highlighting works | Make sure `flywheel.languageServer.enabled` is `true`, then reload the window |
| `code: command not found` | In VS Code, run **Shell Command: Install 'code' command in PATH** (Linux), or install from VSIX through the UI |
