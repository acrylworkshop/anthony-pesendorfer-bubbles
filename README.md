# Bubbles

A local canvas where every bubble is a note or a shell command, and pressing Run walks them in the order you drew.

## What this is

Bubbles is a small, single-user web app for thinking and then doing:

- A **bubble** holds one document, or one shell command when you tick "runs as code".
- Bubbles **nest**. Double-click one to go inside it and keep its own bubbles, its own order and its own lines.
- **Lines** (Connect) join two bubbles at the same level and set the order a run walks them in. Bubbles with no line fall back to the order you made them.
- **Run** executes the command of every bubble in that order, a bubble's own code before the bubbles inside it. Run here in the editor runs just one bubble and its contents.
- **Delete** is a mode: press it, then click bubbles to remove them at once. **Undo** (or Ctrl/Cmd+Z) puts the last removals back exactly, ids, places, code and lines included.
- Everything is kept in one JSON file on your machine. There is no account, no server to sign in to and no sync.

What a run is, and is not: each bubble is one command, started in a fresh shell in the app's folder. There is no prompt, no stdin and no state carried between bubbles, so a `cd` in one bubble does nothing to the next. Output is captured (up to 4,000 characters per command), a command stops after 12 seconds and a whole run after 60 seconds. Commands run only for a request from this machine (loopback), and only when a bubble has "runs as code" ticked.

The page is one HTML document, at `/` and at `/bubbles`. Its JSON API lives under `/bubbles` (state, items, links, run, undo).

## Built with

A [Cordis](https://cordis.js.org) app on the ACRYL framework. TypeScript runs directly on Node 22.19 or newer, with no build step. The framework and its dev tools are vendored in `plugins/`, so the repo is self-contained. The app itself is three files in `plugins/bubbles/`: `index.ts` (routes and page), `client.js` (the page half) and `store.ts` (the data).

## Run it locally

Requirements: Node 22.19 or newer, and macOS, Linux or Windows.

```sh
npm install
npm start
```

Open the address it prints (for example `http://127.0.0.1:3238`). The port comes from the app's id and is stable for the folder; `PORT=4000 npm start` picks another.

Your mind is kept outside the repo, at `~/.acryl/apps/<app-id>/data/bubbles.json`, where `<app-id>` is in `.acryl/app.json`. On a fresh clone the app starts with no bubbles. `ACRYLBLENDS_HOME=/some/folder` points the data somewhere else.

## Use it

1. Press **+ Bubble**, type a name, press Enter.
2. Drag a bubble to throw it; it slows down and settles.
3. Double-click a bubble, or press its arrow, to go inside it. Press **Back** or circle the pointer clockwise for a moment to come back out.
4. Inside a bubble the editor sits at the bottom: type a note, or a command like `ls -la`. Tick **runs as code**, press **Save**, then **Run here**.
5. **Connect** then two bubbles draws a line, which is the order they run in.
6. **Run** in the dock runs the whole mind in that order; the Run order panel lists each command and what it printed.
7. **Delete** turns removal mode on; click bubbles to remove them. **Undo** puts the last removal back.
8. Keys: Enter renames the selected bubble, Delete twice removes it, Ctrl/Cmd+Z undoes, Escape cancels a mode.

## Put it on GitHub, step by step

You are publishing the app, not your mind: the data file and the dev state are git-ignored, so they never leave your machine.

1. Check the repo is healthy (a small step now saves a broken public repo later):

   ```sh
   npm test
   npm run check
   ```

2. Create an empty repository on GitHub. Either in the browser at <https://github.com/new>, or with the CLI:

   ```sh
   gh auth login
   gh repo create bubbles --private   # or --public
   ```

   Do not add a README, a .gitignore or a license on the GitHub side: this repo already has them, and an initial commit there makes the first push clash.

3. In this folder, point your checkout at the new repo and push. This checkout is on `master`; GitHub's own default is `main`, so rename it once to match the convention (keeping `master` also works, you would just set it as the default branch on GitHub):

   ```sh
   git add -A                        # include the README you just got, and any other unsaved file
   git commit -m "Add a README"      # skip this if `git status` is clean
   git remote add origin git@github.com:<your-account>/bubbles.git
   git branch -M main
   git push -u origin main
   ```

   With HTTPS instead of SSH the remote is `https://github.com/<your-account>/bubbles.git`, and GitHub asks for a personal access token as the password (Settings > Developer settings > Personal access tokens). `gh auth login` handles this for you.

4. Check what was actually published, on GitHub: `blend.yaml`, `src/`, `test/`, `plugins/`, `docs/`, `package.json`, `AGENTS.md`, the README, the template's agent skills in `.agents/` and `.claude/`, and the frame host's files (`app/`, `frame/`, `cordis.yml`, `cordis.patch.yml`, `pnpm-workspace.yaml`). Remove anything you do not want to publish before you push. What is left out, by `.gitignore`:

   - `node_modules/` (the install)
   - `data/` and `*.sqlite` (an old database file, nothing reads it)
   - `.acryl/`, `.acrylblends/` (the app's local state, including its id and the door's secret)
   - `.env` and `.env.*` (nothing needs secrets today)
   - `package-lock.json`

5. Run it from a fresh clone, the way anyone else will:

   ```sh
   git clone git@github.com:<your-account>/bubbles.git
   cd bubbles
   npm install
   npm start
   ```

   The clone gets its own app id, its own port and an empty mind. Nothing of yours is carried over.

### Without a terminal

The most reliable no-terminal way is **GitHub Desktop**: install it, choose File > Add local repository and pick this folder, then
Publish repository. It uploads the whole tree (every folder, every dotfile) and keeps this app's existing commit history.

Uploading by hand in the browser also works, but this app is about 300 files in nested folders, so it takes a few rounds:

1. Create an empty repository on GitHub and open it.
2. Add file > Upload files, and at the repository root upload `package.json`, `tsconfig.json`, `blend.yaml`,
   `blend.lock.json`, `README.md`, and the folders `src`, `scripts` and `plugins`. Commit.
3. If GitHub refuses a batch that big, split it: make a folder on your disk called `plugins`, copy one plugin folder into it, and
   drag that `plugins` folder. The path has to arrive as `plugins/<name>`, which is why the folder is dragged, not its contents.
4. `.gitignore` is a dotfile, which drag and drop usually skips. Create it with Add file > Create new file and paste:

   ```
   node_modules/
   .acrylblends/
   .acryl/
   data/
   *.sqlite
   *.sqlite-*
   package-lock.json
   .env
   .env.*
   ```

5. Leave out `node_modules/`, `data/`, `.acryl/`, `.acrylblends/`, `docs/`, `test/`, `.agents/`, `.claude/`, `AGENTS.md`,
   `CLAUDE.md`, `app/`, `frame/`, `cordis.yml`, `cordis.patch.yml` and `pnpm-workspace.yaml`: none of them is needed by
   `npm start`. Your bubbles live in `~/.acryl/apps/<app-id>/data/`, never in this folder, so they are never uploaded.

What is needed to run: `package.json`, `tsconfig.json`, `blend.yaml`, `src/`, `scripts/check-node.cjs`, and the plugins `bubbles`,
`orbital-background`, `router`, `node-server`, `door`, `extensions`, `manifest` and `plugin-share`, plus `plugins/library.json` and
`plugins/library.lock.json`. The rest of `plugins/` is only used by `npm run dev` and `npm run save`.

GitHub Pages will not run this. It is a Node server, so people clone the repo and run `npm install && npm start`.

### Optional, but worth knowing

- **Reproducible installs.** This template ignores `package-lock.json`. If you want exact versions for everyone, delete the `package-lock.json` line from `.gitignore`, commit the lock file, and people can use `npm ci` instead of `npm install`.
- **A license.** A public repo without one is "all rights reserved" by default. Add `LICENSE` (MIT is a common choice) if others may reuse the code.
- **Later changes.** After your first push, publishing a change is `git add -A && git commit -m "..." && git push`. Or run `npm run save -- "message"`: it commits, refuses files that look like a secret, and pushes to the remote once one exists. It also honours the visibility declared in `blend.yaml`, which is `private` today; plain `git push` is not affected by that line.
- **Dev mode.** `npm run dev` starts the same app inside the ACRYL frame (the builder panels beside the page). It needs the dev dependencies, so run `npm install` without `--omit=dev`. Plain `npm start` is all the app needs.

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm start` | Runs the app on your machine |
| `npm run dev` | Runs the app inside the ACRYL frame (builder panels, live reload) |
| `npm test` | Boots the whole app in a throwaway home and checks every route and the page |
| `npm run check` | Type-checks and enforces the dependency rule |
| `npm run lock` | Rewrites `blend.lock.json` after changing `blend.yaml` |
| `npm run save -- "message"` | ACRYL's own save: a secret-scanned commit, pushed when a remote exists |

## Security notes

- Bubbles runs shell commands you wrote, in the app's folder. It refuses a run that does not come from this machine, but there is no login. Keep the app on `127.0.0.1` (the default) and do not expose it to the internet.
- Anyone who can edit the data file can add commands. Treat `bubbles.json` like a shell script.
- Nothing is sent anywhere: no telemetry, no external service, no database.

## Limits

- One person, one machine, one JSON file. No accounts and no sync.
- Undo memory lives in the running process, up to 25 removals; restarting the app starts it empty.
- A command cannot ask for input. Use a one-shot command, or `node -e "..."` for a script.
- The page draws and animates every bubble at the current level. Very large minds have not been tested.

## Layout

```
blend.yaml            the app as data: which plugins run, in what order
src/app.ts            the composition root (mounts the rows from blend.yaml)
src/main.ts           the entry `npm start` runs
plugins/bubbles/      this app: index.ts (routes, page), client.js (page), store.ts (data)
plugins/orbital-background/   the sky behind the page
plugins/              the vendored framework and dev tools (router, node-server, door, ...)
docs/                 the framework's own documentation
test/                 node:test suites, one per feature
```
