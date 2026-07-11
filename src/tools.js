import { getSettings } from './settings.js';
import { makeItem, TYPE_INFO } from './protocol.js';
import { apply } from './appliers.js';

// Tool calls queued while in plan mode (or for STscript, always).
const pendingToolCalls = [];

function escapeHtml(text) {
    return String(text ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

const TOOL_DEFS = [
    {
        name: 'workshop_create_character',
        displayName: 'Workshop: Create Character',
        description: 'Import a complete SillyTavern character card. Pass a full chara_card_v2 or v3 JSON object.',
        schema: {
            type: 'object',
            properties: {
                card: { type: 'object', description: 'Complete chara_card_v2/v3 object with spec, spec_version, and data fields' },
            },
            required: ['card'],
        },
        toItem: (params) => makeItem('card', params.card, JSON.stringify(params.card, null, 2)),
    },
    {
        name: 'workshop_upsert_lorebook',
        displayName: 'Workshop: Create/Extend Lorebook',
        description: 'Create a SillyTavern lorebook (World Info file), or append entries to an existing one. Entries use native WI fields (key, content, comment, constant, order, position, ...).',
        schema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Lorebook name' },
                entries: {
                    type: 'array',
                    description: 'World Info entries',
                    items: {
                        type: 'object',
                        properties: {
                            key: { type: 'array', items: { type: 'string' }, description: 'Trigger keywords; /regex/flags strings allowed' },
                            content: { type: 'string' },
                            comment: { type: 'string', description: 'Entry title' },
                            constant: { type: 'boolean' },
                        },
                        required: ['content'],
                    },
                },
            },
            required: ['name', 'entries'],
        },
        toItem: (params) => makeItem('lorebook', { name: params.name, entries: params.entries }, JSON.stringify(params, null, 2)),
    },
    {
        name: 'workshop_add_lorebook_entry',
        displayName: 'Workshop: Add Lorebook Entry',
        description: 'Append one entry to a SillyTavern lorebook (created if missing). Entry uses native WI fields.',
        schema: {
            type: 'object',
            properties: {
                book: { type: 'string', description: 'Target lorebook name' },
                entry: {
                    type: 'object',
                    properties: {
                        key: { type: 'array', items: { type: 'string' } },
                        content: { type: 'string' },
                        comment: { type: 'string' },
                        constant: { type: 'boolean' },
                    },
                    required: ['content'],
                },
            },
            required: ['book', 'entry'],
        },
        toItem: (params) => makeItem('wi-entry', params, JSON.stringify(params, null, 2)),
    },
    {
        name: 'workshop_create_qr_set',
        displayName: 'Workshop: Create Quick Reply Set',
        description: 'Create a SillyTavern Quick Reply set (replaces a same-named set). Each item has label and an STscript message; auto-execute flags optional.',
        schema: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                qrList: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            label: { type: 'string' },
                            message: { type: 'string', description: 'STscript to run (or text to type)' },
                            title: { type: 'string' },
                            isHidden: { type: 'boolean' },
                            executeOnAi: { type: 'boolean' },
                            executeOnUser: { type: 'boolean' },
                            executeOnStartup: { type: 'boolean' },
                            executeOnChatChange: { type: 'boolean' },
                            automationId: { type: 'string' },
                        },
                        required: ['label', 'message'],
                    },
                },
            },
            required: ['name', 'qrList'],
        },
        toItem: (params) => makeItem('qrset', { version: 2, ...params }, JSON.stringify(params, null, 2)),
    },
    {
        name: 'workshop_add_regex_script',
        displayName: 'Workshop: Add Regex Script',
        description: 'Add or update a global SillyTavern regex find/replace script. placement: 1=user input, 2=AI output, 3=slash commands, 5=World Info, 6=reasoning blocks. markdownOnly alters display only; promptOnly alters what the model sees only.',
        schema: {
            type: 'object',
            properties: {
                scriptName: { type: 'string' },
                findRegex: { type: 'string', description: 'Pattern, plain or /pattern/flags' },
                replaceString: { type: 'string', description: 'Replacement; $1 groups and {{match}} supported' },
                placement: { type: 'array', items: { type: 'number' } },
                markdownOnly: { type: 'boolean' },
                promptOnly: { type: 'boolean' },
                disabled: { type: 'boolean' },
            },
            required: ['scriptName', 'findRegex', 'replaceString'],
        },
        toItem: (params) => makeItem('regex', params, JSON.stringify(params, null, 2)),
    },
    {
        name: 'workshop_run_stscript',
        displayName: 'Workshop: Run STscript',
        description: 'Run an STscript (piped slash commands). ALWAYS requires user approval before execution — the result reports that it was queued.',
        schema: {
            type: 'object',
            properties: {
                script: { type: 'string', description: 'The STscript, starting with a slash command' },
            },
            required: ['script'],
        },
        toItem: (params) => makeItem('script', null, String(params.script ?? '')),
    },
    {
        name: 'workshop_list_lorebooks',
        displayName: 'Workshop: List Lorebooks',
        description: 'List the names of every existing SillyTavern lorebook (World Info file). Read-only, runs immediately. Use it BEFORE creating a lorebook or adding entries so target names match reality.',
        schema: { type: 'object', properties: {} },
        readOnly: true,
        run: async () => {
            const names = SillyTavern.getContext().getWorldInfoNames?.() ?? [];
            return JSON.stringify(names);
        },
    },
    {
        name: 'workshop_get_lorebook',
        displayName: 'Workshop: Read Lorebook',
        description: 'Read a digest of one lorebook: for each entry its uid, comment, keys, flags, placement, and (truncated) content. Read-only, runs immediately. Use it before merging entries into an existing book.',
        schema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Exact lorebook name (see workshop_list_lorebooks)' },
            },
            required: ['name'],
        },
        readOnly: true,
        run: async (params) => {
            const ctx = SillyTavern.getContext();
            const name = String(params.name ?? '');
            // loadWorldInfo returns an empty shell for missing books — check the name list instead.
            if (!ctx.getWorldInfoNames?.().includes(name)) {
                return `No lorebook named "${name}" exists. workshop_list_lorebooks returns the valid names.`;
            }
            const data = await ctx.loadWorldInfo(name).catch(() => null);
            if (!data?.entries) return `No lorebook named "${name}" exists. workshop_list_lorebooks returns the valid names.`;
            const digest = (contentChars) => Object.values(data.entries).map(e => ({
                uid: e.uid,
                comment: e.comment || undefined,
                key: e.key?.length ? e.key : undefined,
                keysecondary: e.keysecondary?.length ? e.keysecondary : undefined,
                constant: e.constant || undefined,
                disabled: e.disable || undefined,
                position: e.position,
                depth: e.position === 4 ? e.depth : undefined,
                order: e.order,
                content: String(e.content ?? '').length > contentChars
                    ? String(e.content).slice(0, contentChars) + '…'
                    : String(e.content ?? ''),
            }));
            // Keep the result comfortably inside the model's context.
            for (const chars of [400, 120, 0]) {
                const result = JSON.stringify(digest(chars));
                if (result.length <= 16000) return result;
            }
            const entries = digest(0);
            return JSON.stringify({ note: `book too large, first 50 of ${entries.length} entries shown`, entries: entries.slice(0, 50) });
        },
    },
];

async function runToolItem(item) {
    const result = await apply(item);
    return result.ok ? `Done: ${result.message}` : `Failed: ${result.message}`;
}

export function registerWorkshopTools() {
    const ctx = SillyTavern.getContext();
    if (typeof ctx.registerFunctionTool !== 'function') return;

    for (const def of TOOL_DEFS) {
        ctx.registerFunctionTool({
            name: def.name,
            displayName: def.displayName,
            description: def.description,
            parameters: def.schema,
            stealth: false,
            shouldRegister: () => {
                const settings = getSettings();
                return settings.enabled && settings.enableTools;
            },
            formatMessage: (params) => `Workshop: preparing ${def.displayName.replace('Workshop: ', '').toLowerCase()}…`,
            action: async (params) => {
                const settings = getSettings();
                if (def.readOnly) return await def.run(params ?? {});
                const item = def.toItem(params ?? {});
                if (item.invalid) return `Invalid parameters: ${item.invalid}`;
                if (!settings.autoMode || item.type === 'script') {
                    pendingToolCalls.push(item);
                    return `Queued "${item.name}" (${item.type}) for user approval. It is NOT applied yet — the user reviews it via the approval popup or /workshop-queue. Do not assume it exists.`;
                }
                return await runToolItem(item);
            },
        });
    }

    // Nudge the user when a generation left tool calls waiting for approval.
    ctx.eventSource.on(ctx.eventTypes.GENERATION_ENDED, () => {
        if (!pendingToolCalls.length) return;
        toastr.info(
            `${pendingToolCalls.length} deliverable(s) awaiting approval — tap to review`,
            "Tavernkeeper's Workshop",
            { timeOut: 10000, onclick: showToolQueuePopup },
        );
    });
}

export async function showToolQueuePopup() {
    const ctx = SillyTavern.getContext();
    if (!pendingToolCalls.length) {
        toastr.info('No deliverables waiting for approval', "Tavernkeeper's Workshop");
        return;
    }
    const rows = pendingToolCalls.map((item, index) => {
        const info = TYPE_INFO[item.type] ?? { icon: 'fa-cube', label: item.type };
        return `
            <div class="tkw-queue-row" data-index="${index}">
                <i class="fa-solid ${info.icon}"></i>
                <div class="tkw-info"><b>${escapeHtml(info.label)}</b><span class="tkw-name">${escapeHtml(item.name)}</span><small class="tkw-summary">${escapeHtml(item.summary)}</small></div>
                <div class="tkw-buttons">
                    <div class="menu_button tkw-q-apply interactable">Apply</div>
                    <div class="menu_button tkw-q-dismiss interactable">Dismiss</div>
                </div>
            </div>`;
    }).join('');
    const html = DOMPurify.sanitize(`<div class="tkw-queue"><h3>Workshop — pending deliverables</h3>${rows}</div>`);
    await ctx.callGenericPopup(html, ctx.POPUP_TYPE?.TEXT ?? 1, '', { wide: true, allowVerticalScrolling: true });
}

export function initToolQueueClicks() {
    $(document).on('click', '.tkw-q-apply, .tkw-q-dismiss', async function () {
        const row = this.closest('.tkw-queue-row');
        const index = Number(row.dataset.index);
        const item = pendingToolCalls[index];
        if (!item) return;
        if (this.classList.contains('tkw-q-apply')) {
            this.classList.add('disabled');
            const result = await apply(item);
            result.ok
                ? toastr.success(result.message, "Tavernkeeper's Workshop")
                : toastr.error(result.message, "Tavernkeeper's Workshop");
        }
        pendingToolCalls.splice(index, 1);
        // Reindex remaining rows instead of rebuilding the popup.
        row.remove();
        document.querySelectorAll('.tkw-queue-row').forEach((el, i) => { el.dataset.index = String(i); });
    });
}

export function getPendingToolCallCount() {
    return pendingToolCalls.length;
}
