# Tavernkeeper's Workshop

A SillyTavern UI extension that turns AI chat output into real objects — characters,
lorebooks, Quick Reply sets, regex scripts, and STscript. The model works through
function tools (primary path) or tagged fenced code blocks; you approve deliverables
with one tap, or let finished artifacts apply automatically in auto mode.

Designed for Chat Completion APIs with function calling. The included **Tavernkeeper**
character is the purpose-built companion persona.

## Function tools

With **LLM function tools** enabled (Chat Completion + function calling), the extension
registers:

**Write tools** — queued for your approval in plan mode, applied directly in auto mode:
`workshop_create_character`, `workshop_upsert_lorebook`, `workshop_add_lorebook_entry`,
`workshop_create_qr_set`, `workshop_add_regex_script`, `workshop_run_stscript`.

With the optional **Tavernkeeper Writer** server companion, the Workshop can also run
`workshop_create_extension`, `workshop_adopt_extension`,
`workshop_patch_extension`, and `workshop_rollback_extension`. Extension source is
executable, so these tools always require a validated diff review and manual approval.

**Read tools** — run immediately in both modes, so the model can check reality before
creating or merging:

| Tool | Returns |
|---|---|
| `workshop_search_knowledge` | Tavernkeeper knowledge entries, by id or free-text query |
| `workshop_list_characters` / `workshop_get_character` | installed cards; one card's digest |
| `workshop_list_lorebooks` / `workshop_get_lorebook` | world file names; one book's entry digest |
| `workshop_list_qr_sets` / `workshop_get_qr_set` | Quick Reply sets; one set's buttons and flags |
| `workshop_list_regex_scripts` | global regex scripts digest |
| `workshop_list_extension_projects` | managed extension IDs, folders, revisions, and status |
| `workshop_get_extension_project` / `workshop_get_extension_revision` | current or retained extension source |

Pending tool calls survive reloads (stored per chat) — review them any time with
`/workshop-queue` or the toast that appears after generation.

## Knowledge base

Tavernkeeper's SillyTavern-internals knowledge ships inside the extension
([knowledge/tavernkeeper-knowledge.json](knowledge/tavernkeeper-knowledge.json)) and is
served on demand through `workshop_search_knowledge`. A compact primer — the
architecture summary, a table of contents of every knowledge entry, and the standing
instruction to *fetch before answering* — is injected into every prompt alongside the
deliverable protocol.

When the official **Web Search** extension is installed, the primer also tells the model
to fall back to the `WebSearch` tool for anything the knowledge base doesn't cover.

There is no synced lorebook anymore (pre-3.0 installs get a one-time notice that the old
"Tavernkeeper Knowledge" world file can be deleted). Knowledge updates ship with
extension updates and announce themselves with a changelog toast.

## Modes

- **Plan mode (default)** — every deliverable gets an inline action card under its code
  block (type, name, summary, **Apply** / **Dismiss**), and tool calls queue for review.
  Nothing changes without a tap.
- **Auto mode** — deliverables apply as they arrive, with a toast per item. Toggle via
  the wand menu ("Workshop: auto-apply"), the settings panel, or `/workshop-mode auto`.

**Executable deliverables always require a manual Apply, even in auto mode**: raw
STscript, Quick Reply sets carrying auto-execute flags (`executeOnAi`,
`executeOnStartup`, …), and lorebook entries with an `automationId` — all of these can
execute commands, so none of them auto-apply. Managed-extension creation, adoption,
updates, and rollbacks are also always manual because their JavaScript runs after reload.

## Deliverable protocol (tagged fences)

In plain replies, deliverables are fenced code blocks tagged `st-*`. One deliverable per
fence; bodies are strict JSON, except `st-script` (raw STscript). Untagged `json` blocks
are never applied — drafts belong in `jsonc` or `text` fences. A body that itself
contains ``` lines goes in a longer (four-backtick) fence.

| Tag | Body | Result |
|---|---|---|
| ` ```st-card ` | full `chara_card_v2`/`v3` JSON | character imported |
| ` ```st-lorebook ` | `{"name": "...", "entries": {"0": {...}}}` (native WI format; V2 arrays accepted) | world file created, or entries merge-appended into an existing book |
| ` ```st-wi-entry ` | `{"book": "Target", "entry": {"key": [...], "content": "...", ...}}` | entry appended (book created if missing) |
| ` ```st-qrset ` | `{"name": "...", "qrList": [{"label": "...", "message": "/..."}]}` | Quick Reply set created (replaces same-named set) |
| ` ```st-regex ` | one regex script object (`scriptName`, `findRegex`, `replaceString`, ...) | global regex script added/updated by name |
| ` ```st-script ` | raw STscript starting with `/` | executed once on Apply |
| ` ```st-extension-create ` | `{"slug":"...","displayName":"...","files":{"manifest.json":"...","index.js":"..."}}` | reviewed managed extension creation |
| ` ```st-extension-adopt ` | `{"slug":"existing-folder"}` | reviewed ownership of an existing extension |
| ` ```st-extension-patch ` | project identity, expected revision, and add/replace/rename/delete operations | reviewed atomic update |
| ` ```st-extension-rollback ` | project identity, expected revision, and retained target revision | reviewed rollback |

## Managed extension writer

The writer is a separate SillyTavern server plugin because browser extensions cannot
write folders. Server plugins are not sandboxed; inspect the bundled code and enable it
only on a SillyTavern installation you control.

Install or update both the UI extension and companion with the idempotent setup script:

```bash
bash scripts/setup-writer.sh --sillytavern-root /path/to/SillyTavern --dry-run
bash scripts/setup-writer.sh --sillytavern-root /path/to/SillyTavern
```

Then set `enableServerPlugins: true` in SillyTavern's `config.yaml` and restart the
server. The setup script intentionally does not edit the config. It targets
`default-user`; pass `--user HANDLE` for another user. Existing companion code is moved
to a timestamped backup before updates.

The companion writes only beneath the authenticated user's `extensions/` directory. A
folder is writable only when its server-created marker agrees with the per-user registry.
It rejects path traversal, absolute paths, symlinks, hidden control files, binary data,
invalid manifests, stale revisions, tampered tokens, and changes made after review.
Transactions are staged and atomically swapped. The newest 10 pre-change snapshots are
retained per project; rollback is reviewed and creates a new revision. Reload
SillyTavern after a successful change to activate the new code.

## Slash commands

- `/workshop-mode [plan|auto|toggle]` — get/set mode
- `/workshop-apply [mesId]` — apply everything pending in a message (default: last AI message; includes script-capable deliverables)
- `/workshop-queue` — open the pending tool-call popup

## Version awareness

- The settings panel shows the extension, knowledge, and imported-card versions, and
  warns when the imported Tavernkeeper card is older than the extension expects.
- A compatibility line reports any missing SillyTavern APIs instead of failing silently,
  and notes when no WebSearch tool is detected.
- Settings migrate automatically across extension versions; knowledge updates toast a
  short changelog.

## Companion card

The extension works with any character that uses the tools or emits tagged fences. The
included **Tavernkeeper** persona is built for it — its internals expertise comes from
the extension's knowledge tools, so without the extension the card is personality only.

- [Import Tavernkeeper.png](cards/Tavernkeeper.png) for the complete character card with its
  portrait.
- [Import the Character Card V2 JSON](cards/Tavernkeeper.chara_card_v2.json) when you prefer
  an inspectable text source or want to provide your own avatar.
- [View the avatar generation prompt](cards/AVATAR_PROMPT.md) to reproduce or adapt the
  bundled portrait.

Import only one card format; the PNG and JSON contain the same Tavernkeeper version 3.0
data. Install this extension separately using the instructions below, then reload
SillyTavern.

### Chronicler — the creative-writing companion

**Chronicler** is a second card that works like a sub-agent to Tavernkeeper: a
prose-only creative writer for character descriptions, personalities, greetings,
lorebook entry text, scenarios, and world lore. It delivers finished passages in plain
`text` fences — inert by design, so the Workshop never applies them — and never emits
`st-*` fences or JSON. Pair both cards in a group chat: Chronicler writes the words,
the keeper structures and applies them. With the extension installed, Chronicler uses
only the read tools (`workshop_search_knowledge`, `workshop_get_character`,
`workshop_get_lorebook`) to keep new writing consistent with existing material.

- [Import Chronicler.png](cards/Chronicler.png) for the complete card. Its portrait is a
  generated placeholder gradient (`node tools/make-placeholder-avatar.mjs`).
- [Import the Character Card V2 JSON](cards/Chronicler.chara_card_v2.json) to provide
  your own avatar.
- [View the avatar generation prompt](cards/CHRONICLER_AVATAR_PROMPT.md) to produce real
  art, then run `node tools/build-card.mjs Chronicler` to re-embed the card data.

## Install

In SillyTavern, open **Extensions → Install extension**, paste this repository URL, and
select **Install**:

```text
https://github.com/dkylepeppers-alt/Extension-Tavernkeeper
```

For a manual installation, clone the repository into your SillyTavern extensions folder
(any folder name works):

```bash
git clone https://github.com/dkylepeppers-alt/Extension-Tavernkeeper.git \
  data/<user-handle>/extensions/Extension-Tavernkeeper
```

Reload SillyTavern after installation. Recommended companions: the official
**Web Search** extension (knowledge fallback) and a Chat Completion API with function
calling enabled.

## Development

Run the test suite after making changes (also runs in CI):

```bash
node tests/validate-protocol.mjs   # fence parsing, hashing, executable detection
node tests/validate-knowledge.mjs  # knowledge schema, search, primer
node tests/validate-settings.mjs   # settings migrations, capability detection
node tests/validate-writer.mjs     # filesystem security, transactions, snapshots
node tests/validate-writer-routes.mjs # server route contract
node tests/validate-writer-client.mjs # browser API client
node tests/validate-writer-review.mjs # escaped diff review rendering
node tests/validate-extension-tools.mjs # managed function tools
node tests/validate-setup.mjs      # setup dry-run/install/update
node tools/build-card.mjs          # rebuild the card PNGs after editing card JSON
node tests/validate-card.mjs       # Tavernkeeper card JSON + PNG chunks + README links
node tests/validate-chronicler-card.mjs # Chronicler card JSON + PNG chunks + README links
```

## Notes

- Applied/dismissed state is stored per message in `message.extra.tk_workshop`, keyed by a
  content hash — swipes and edits re-offer only genuinely new content; nothing double-applies.
- Ordinary Workshop artifacts have no automatic undo. Managed extensions retain 10 reviewed rollback snapshots.
- Regex scripts take effect immediately; the Regex settings drawer list refreshes on reload.
