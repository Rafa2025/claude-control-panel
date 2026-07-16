# Claude Control Panel

A local web dashboard for managing [Claude Code](https://claude.com/claude-code) skills and
observing [claude-flow / ruflo](https://github.com/ruvnet/claude-flow) agents. It replaces
juggling raw CLI output and chat text with a visual control panel that runs entirely on
localhost for a single user.

> Built as a learning project. No auth, no cloud, no deployment config — it talks to your
> local `~/.claude/skills/` directory and the `ruflo` CLI, nothing else.

## Features

### Skills manager
- Lists every skill in `~/.claude/skills/` (following symlinks) plus references found in `~/CLAUDE.md`, showing name, description, source, and enabled state.
- **Real enable/disable toggle** — disabling physically moves a skill into `~/.claude/skills-disabled/` so Claude Code actually stops loading it (not just a cosmetic flag). Symlink-safe.
- **Edit** a skill's `SKILL.md` in-place, with a line-diff confirmation before anything is written to disk.
- **Create a skill** manually, or **generate one with AI** from a plain-English description — the draft always lands in the editor for review before it's saved.
- **Delete** a skill behind a type-the-name-to-confirm modal (removes a symlink's link, never its target).
- Search, per-skill usage badges, and a heuristic "possible conflicts" detector for skills with overlapping trigger descriptions.

### Marketplace
- Browse and install skills from the [`anthropics/skills`](https://github.com/anthropics/skills) repo, with a confirm-before-download step showing file count and target path.
- Parallel downloads (won't time out or truncate on large multi-file skills).
- **Update detection** — installed skills are diffed against the repo by git blob SHA and flagged when an update is available.
- **AI Scout** — describe a topic and a background `claude` call web-searches for relevant open-source skills; suggestions are individually dismissable.

### AI Advisor
- Describe what you want to do; a `claude` call (guided by prompt-engineering methodology) recommends relevant local skills and drafts a ready-to-paste Claude Code prompt.
- Asks clarifying questions when the request is vague, keeps a prompt history you can reload/re-run, and can export the prompt to a file with the shell command to run it.

### Agent workflow viewer
- Renders live `ruflo` agents plus local Claude/ruflo OS processes as an animated parent→child tree, auto-refreshing on a poll.
- Click a node for its logs (or live process detail for OS processes); status rings and edges animate for running agents.
- A timeline scrub bar replays the tree from recent history snapshots.

### Everywhere
- Model picker (Haiku / Sonnet / Opus) for every AI-backed action.
- Session token counter and a health strip (ruflo / credentials / client-port status) in the nav.
- Claude Desktop-inspired theme: warm ivory, terracotta accent, serif headings.

## Tech stack

- **Backend** — Node/Express (`server/`). Reads/writes the scoped filesystem and shells out to the read-only `ruflo` CLI. API on port **4310**.
- **Frontend** — React + Vite + Framer Motion (`client/`). Dev server on port **5173**, proxying `/api` to the backend.
- AI features shell out to your authenticated `claude` CLI in headless mode — no API key needed.

## Setup

Requires Node.js, the `claude` CLI (logged in), and optionally `ruflo` for the agent view.

```bash
# install root + client dependencies
npm install
npm install --prefix client

# run backend + frontend together
npm run dev
```

Then open **http://localhost:5173**.

If the agent view or AI features 401, run `claude login` in a terminal — headless calls use
your existing CLI credentials.

## Safety & scope

- All filesystem operations are locked to `~/.claude/skills/`, `~/.claude/skills-disabled/`, `~/CLAUDE.md`, and the project directory itself.
- No skill file is ever changed without an explicit in-UI confirmation (diff, install-confirm, or type-to-confirm).
- `ruflo` is only ever invoked with read-only commands (list / status / logs / health) — nothing that spawns, kills, or mutates agents. Those calls run from a neutral working directory so they don't auto-start the token-consuming ruflo daemon.

## Project layout

```
server/
  index.js        Express routes
  skills.js       scan / toggle / edit / create / delete skills
  marketplace.js  anthropics/skills catalog + install + update detection
  skillgen.js     AI skill generation
  advisor.js      AI Advisor (headless claude)
  suggester.js    AI Scout (headless claude + web search)
  agents.js       ruflo + process scan → agent tree, history snapshots
  health.js       ruflo / credentials / port health
  history.js      advisor prompt history
  usage.js        session token accounting
client/
  src/views/      SkillsManager, Marketplace, AdvisorView, AgentViewer
  src/components/  AgentTree, ModelSelect
  src/styles.css  Claude Desktop-inspired theme
```

## Notes

- Local runtime state (`data/*.json`) and installed skill directories are gitignored.
- This is a personal, single-user tool — it intentionally has no authentication and should only be run on localhost.
