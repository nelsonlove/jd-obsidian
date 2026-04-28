# Johnny Decimal Dashboard — Obsidian Plugin

Live JD system awareness inside the Obsidian vault. Inbox dashboard, drift detection, vault auditing, frontmatter normalization, and quick ID navigation.

Part of the [jd-tools](https://github.com/nelsonlove/jd-tools) monorepo. Reads the same `jd-index.yaml` and `jd.yaml` that jd-cli uses — no runtime dependency on the Python tool.

## Features

### Inbox Dashboard
Sidebar panel showing all `.01 Unsorted/Inbox` directories with item counts, grouped by area, busiest-first. Click a row to reveal the folder in the file explorer. Live-updates on vault changes.

### Drift Panel
Sidebar panel showing notes with frontmatter/location issues, grouped by type:

- **Missing frontmatter** — JD ID in filename but no `jd-id` field. One-click fix button.
- **ID mismatch** — filename and frontmatter disagree on the ID.
- **Wrong folder** — note is in the wrong category directory.
- **Missing stubs** — JDex entries without a corresponding note. One-click create button.

Status bar shows "JD: N drifted" — click to open the panel.

### Vault Audit
Comprehensive health check with 11 validation rules across 3 severity levels:

| Severity | Checks |
|----------|--------|
| Error | Missing required fields, invalid date formats, invalid categories, duplicate IDs |
| Warning | Orphaned files, missing +README aliases, title mismatches, missing stubs |
| Info | Broken wikilinks, empty notes, stale surveyed dates |

Generates a markdown report at `00.00+REPORT JD vault audit.md`. Optional auto-run on startup.

### Frontmatter Normalizer
Silently corrects frontmatter on every save:

- Sorts keys into canonical order: `jd-title` → `jd-id` → `jd-type` → `jd-location` → `created` → `modified` → `surveyed` → `aliases` → `tags`
- Quotes `jd-id` values (YAML treats `06.12` as a float)
- Infers `jd-type` from ID pattern if missing
- Strips JD ID prefix from H1 headings

### Quick ID Navigation
Command palette: **JD: Go to ID** — fuzzy search by JD ID number or title.

### Drift Report
Generates `00.00+REPORT JD drift report.md` with drift details, inbox summary, and missing stubs.

## Commands

| Command | Description |
|---------|-------------|
| JD: Open inbox dashboard | Open the inbox sidebar panel |
| JD: Open drift panel | Open the drift detection sidebar |
| JD: Go to ID | Fuzzy search by ID or title |
| JD: Run vault audit | Generate comprehensive health report |
| JD: Generate drift report | Write drift/inbox markdown report |
| JD: Check for drift | Quick drift count (status bar + console) |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| JD root | `~/Documents` | Filesystem root of the JD tree |
| JDex path | `~/.local/share/jd/jd-index.yaml` | Path to the JDex index file |
| Show empty inboxes | off | Show inbox folders with 0 items |
| Stale surveyed threshold | 90 days | Days before surveyed date is flagged |
| Audit on startup | off | Run vault audit when Obsidian opens |

## Frontmatter Schema

The plugin expects JD notes to follow this canonical frontmatter schema:

```yaml
---
jd-title: Restraining order
jd-id: '26.11'
jd-type: id
jd-location: filesystem
created: 2026-03-31
modified: 2026-04-23
surveyed: 2026-03-31
---
```

For `+README` files inside standard-zero directories:

```yaml
---
jd-title: Knowledge base for the system
jd-id: '00.06+README'
jd-type: knowledge-base
jd-location:
aliases:
    - 00.06 Knowledge base for the system
---
```

### jd-type values

| Type | Standard zero | Description |
|------|--------------|-------------|
| `id` | — | Regular JD ID note |
| `index` | `.00` | JDex/meta note |
| `inbox` | `.01` | Inbox/unsorted |
| `tasks` | `.02` | Task & project management |
| `templates` | `.03` | Templates |
| `links` | `.04` | Link collections |
| `knowledge-base` | `.06` | Knowledge base |
| `someday` | `.08` | Someday/maybe |
| `archive` | `.09` | Archive |
| `report` | — | Generated reports (+REPORT) |
| `audit` | — | Audit documents (+AUDIT) |
| `meta` | — | Other sub-IDs (+CLAUDE, +INDEX, etc.) |

## Development

```sh
cd packages/jd-obsidian
npm install
npm run dev     # watch mode — rebuilds on change
npm run build   # production build
```

The plugin is symlinked into the vault at `.obsidian/plugins/jd-dashboard/` for development. After building, reload Obsidian (Cmd+R) to pick up changes.

## Architecture

```
src/
├── main.ts                  # Plugin entry point — lifecycle, commands, events
├── settings.ts              # Settings tab and defaults
├── jdex.ts                  # JDex YAML parser and lookup helpers
├── scanner.ts               # Inbox counter, drift detector, stub finder
├── normalizer.ts            # Frontmatter auto-correction on save
├── validator.ts             # 11 validation checks, report engine
├── commands/
│   ├── go-to-id.ts          # SuggestModal for fuzzy ID search
│   ├── drift-report.ts      # Markdown drift report generator
│   └── audit-report.ts      # Markdown audit report generator
└── views/
    ├── inbox-dashboard.ts   # Sidebar: inbox counts by area
    └── drift-panel.ts       # Sidebar: drifted notes with fix buttons
```
