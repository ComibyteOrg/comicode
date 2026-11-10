# Installing ComiCode

ComiCode is a command-line program. Install it once globally and npm will place a
small `comicode` launcher in its global binary directory. That directory is
normally on your `PATH`, so `comicode` works from any project folder and any
terminal session.

ComiCode is not published on npm yet. Use one of the methods below.

## Requirements

- **Node.js 22.13 or newer** (Node 24 LTS recommended). Check with `node --version`.
- **npm 10 or newer**. Check with `npm --version`.
- **git** for installing directly from GitHub.
- Windows, macOS, or Linux.
- At least one provider key, or a local no-auth endpoint such as Ollama.

> Node 22.5–22.12 can load `node:sqlite` only with `--experimental-sqlite`.
> ComiCode does not add that flag, so 22.13 is the real minimum.

## Option 1 — Install from GitHub

The repository must be public (or reachable with your git credentials).

```bash
npm install -g github:YOUR_USERNAME/comicode
comicode --version
```

Replace `YOUR_USERNAME` with the repository owner. To pin a release tag or
commit:

```bash
npm install -g github:YOUR_USERNAME/comicode#v0.1.0
npm install -g github:YOUR_USERNAME/comicode#<commit-sha>
```

### Why this works without a committed `dist/`

`dist/` is intentionally gitignored. For git installs npm installs the
package's dependencies and devDependencies, then runs the `prepare` script,
which runs `npm run build` and produces `dist/cli.js`. The `bin` entry then
points at that file.

Do not install with `--ignore-scripts`; that skips the build and leaves the
`comicode` launcher pointing at a missing file.

## Option 2 — Install from a tarball

This is the easiest way to share a build with someone who does not have
repository access, or to install offline.

On the machine that has the source checkout:

```bash
npm pack
# produces comicode-0.1.0.tgz
```

Copy the `.tgz` to the other machine, then:

```bash
npm install -g ./comicode-0.1.0.tgz
comicode --version
```

`npm pack` runs the build first, so the tarball contains `dist/cli.js` and does
not need devDependencies on the target machine.

## Option 3 — Install from a local clone

```bash
git clone https://github.com/YOUR_USERNAME/comicode.git
cd comicode
npm install
npm install -g .
comicode --version
```

`npm install -g .` uses the same `prepare` build as a GitHub install. For active
development, use `npm link` instead so rebuilding the checkout updates the
global command:

```bash
npm link
npm run build
comicode --version
```

## Option 4 — Publish to npm (for maintainers)

If the package is published later, installation becomes:

```bash
npm install -g comicode
```

Before publishing, replace `YOUR_USERNAME` in `src/version.ts`, the OpenRouter
attribution header, and the GitHub links in `.github/`, `README.md`, and
`CONTRIBUTING.md`. Then run `npm publish`.

## Verify the command is available everywhere

Open a **new** terminal, change to an unrelated directory, and run:

```bash
comicode --version
comicode doctor
```

Find the launcher:

```bash
# Windows (PowerShell or cmd)
where comicode

# macOS / Linux
which comicode
```

Show npm's global prefix and binary directory:

```bash
npm config get prefix
```

Typical locations:

| Platform          | Global launcher                                 |
| ----------------- | ----------------------------------------------- |
| Windows           | `%APPDATA%\npm\comicode.cmd`                    |
| macOS / Linux     | `<npm prefix>/bin/comicode`                     |
| nvm / fnm / Volta | Inside that version manager's Node installation |

## If `comicode` is not recognized

1. **Open a new terminal.** Installers modify `PATH`, and existing shells keep
   their old environment.
2. **Check the launcher exists.** Run `where comicode` (Windows) or
   `which comicode` (macOS/Linux), and compare with `npm config get prefix`.
3. **Add npm's global bin directory to `PATH`.**
   - Windows: add `%APPDATA%\npm` to your user `Path` environment variable.
   - macOS/Linux (bash): add this to `~/.bashrc` or `~/.zshrc`:
     ```bash
     export PATH="$(npm config get prefix)/bin:$PATH"
     ```
   - Then restart the terminal or run `source ~/.zshrc`.
4. **Version-manager shells.** If you use nvm, fnm, Volta, or asdf, the global
   `comicode` may live inside the currently selected Node version. Reinstall
   after switching Node versions, or run `npm install -g ...` again.
5. **Permission errors on macOS/Linux.** Avoid `sudo npm install -g`. Either use
   a version manager, or configure a user-level prefix:
   ```bash
   npm config set prefix "$HOME/.npm-global"
   export PATH="$HOME/.npm-global/bin:$PATH"
   npm install -g github:YOUR_USERNAME/comicode
   ```
6. **PowerShell blocks the launcher.** If PowerShell reports an execution-policy
   error, run `comicode.cmd` instead, or allow locally created scripts:
   ```powershell
   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
   ```
7. **`dist/cli.js` is missing.** You installed with `--ignore-scripts` or used a
   source archive without running the build. Reinstall normally, or run
   `npm install && npm run build` in the checkout.
8. **Wrong Node version.** `node:sqlite` requires Node 22.13+. Upgrade Node and
   reinstall the global package.

## Updating

```bash
# GitHub install: run the install command again
npm install -g github:YOUR_USERNAME/comicode

# Tarball install: install the newer tarball
npm install -g ./comicode-0.1.1.tgz

# npm (after publishing)
npm update -g comicode

comicode --version
```

## Uninstalling

```bash
npm uninstall -g comicode
```

This removes the command but leaves your local data in the ComiCode home
directory (`%APPDATA%\comicode`, `~/Library/Application Support/comicode`, or
`~/.config/comicode`). Remove it with `comicode data delete-all` before
uninstalling if you want a clean slate.

## First run

```bash
comicode doctor
comicode providers add --provider gemini --name "Gemini personal" --api-key-env GEMINI_API_KEY
comicode models refresh
comicode run "Summarize this project"
```

Run `comicode` with no arguments in an interactive terminal to open the TUI.
See the [README](../README.md) and
[provider adapter guide](provider-adapters.md) for configuration details.
