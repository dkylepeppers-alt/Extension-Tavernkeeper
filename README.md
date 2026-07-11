# Tavernkeeper's Workshop

A SillyTavern UI extension that turns AI chat output into real objects. When a character
(designed companion: **Tavernkeeper**) emits a tagged fenced code block, the Workshop
detects it and offers a one-tap **Apply** — or applies it automatically in auto mode.

## Modes

- **Plan mode (default)** — every detected deliverable gets an inline action card under its
  code block: type, name, summary, **Apply** / **Dismiss**. Nothing changes without a tap.
- **Auto mode** — deliverables apply as messages arrive, with a toast per item.
  Toggle via the wand menu ("Workshop: auto-apply"), the settings panel, or `/workshop-mode auto`.

STscript deliverables **always** require a manual Apply, even in auto mode — they are
arbitrary code execution.

## Deliverable protocol (tagged fences)

One deliverable per fence. Bodies are strict JSON, except `st-script` (raw STscript).

| Tag | Body | Result |
|---|---|---|
| ` ```st-card ` | full `chara_card_v2`/`v3` JSON | character imported |
| ` ```st-lorebook ` | `{"name": "...", "entries": {"0": {...}}}` (native WI format; V2 arrays accepted) | world file created, or entries merge-appended into an existing book |
| ` ```st-wi-entry ` | `{"book": "Target", "entry": {"key": [...], "content": "...", ...}}` | entry appended (book created if missing) |
| ` ```st-qrset ` | `{"name": "...", "qrList": [{"label": "...", "message": "/..."}]}` | Quick Reply set created (replaces same-named set) |
| ` ```st-regex ` | one regex script object (`scriptName`, `findRegex`, `replaceString`, ...) | global regex script added/updated by name |
| ` ```st-script ` | raw STscript starting with `/` | executed once on Apply |

Untagged ` ```json ` blocks are also detected heuristically (card `spec`, QR `qrList`,
regex `findRegex`, `{book, entry}`, `{name, entries}`) — can be disabled in settings.

## Function tools

On Chat Completion APIs with function calling enabled, six tools are registered
(`workshop_create_character`, `workshop_upsert_lorebook`, `workshop_add_lorebook_entry`,
`workshop_create_qr_set`, `workshop_add_regex_script`, `workshop_run_stscript`). In plan
mode tool calls queue for approval (review popup via the toast or `/workshop-queue`);
in auto mode they execute directly. On text-completion APIs, the fence protocol is the
universal path.

## Slash commands

- `/workshop-mode [plan|auto|toggle]` — get/set mode
- `/workshop-apply [mesId]` — apply everything pending in a message (default: last AI message; includes STscript)
- `/workshop-queue` — open the pending tool-call popup

## Install

In SillyTavern, open **Extensions → Install extension**, paste this repository URL, and
select **Install**:

```text
https://github.com/dkylepeppers-alt/Extension-Tavernkeeper
```

For a manual installation, clone the repository into your SillyTavern extensions folder:

```bash
git clone https://github.com/dkylepeppers-alt/Extension-Tavernkeeper.git \
  data/<user-handle>/extensions/Extension-Tavernkeeper
```

Reload SillyTavern after installation.

## Notes

- Applied/dismissed state is stored per message in `message.extra.tk_workshop`, keyed by a
  content hash — swipes and edits re-offer only genuinely new content; nothing double-applies.
- No automatic undo: each success note names exactly what was created and where to manage it.
- Regex scripts take effect immediately; the Regex settings drawer list refreshes on reload.
