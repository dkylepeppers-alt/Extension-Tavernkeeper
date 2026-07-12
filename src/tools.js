import { getSettings } from './settings.js';
import { makeItem, isExecutable, TYPE_INFO } from './protocol.js';
import { apply } from './appliers.js';
import { searchKnowledge } from './knowledge.js';
import { escapeHtml, truncateText } from './util.js';

// Tool calls waiting for user approval (plan mode, or executable deliverables
// in any mode). Mirrored into chat_metadata so a reload doesn't drop them.
const pendingToolCalls = [];
const QUEUE_KEY = 'tk_workshop_queue';

function persistQueue() {
    const ctx = SillyTavern.getContext();
    if (!ctx.chatMetadata) return;
    ctx.chatMetadata[QUEUE_KEY] = pendingToolCalls.map(({ type, data, raw }) => ({ type, data, raw }));
    ctx.saveMetadataDebounced();
}

function restoreQueue() {
    const ctx = SillyTavern.getContext();
    pendingToolCalls.length = 0;
    for (const stored of ctx.chatMetadata?.[QUEUE_KEY] ?? []) {
        // Rebuild through makeItem so name/summary/validation are re-derived.
        pendingToolCalls.push(makeItem(stored.type, stored.data, stored.raw));
    }
}

function queueItem(item) {
    pendingToolCalls.push(item);
    persistQueue();
}

function unqueueItem(index) {
    pendingToolCalls.splice(index, 1);
    persistQueue();
}

// Result strings stay inside the model's context even for big installs.
const RESULT_CHAR_CAP = 16000;

function capList(digestAtDetail) {
    // digestAtDetail(level) with level 0 = fullest; higher levels shed detail.
    for (let level = 0; level < 3; level++) {
        const result = JSON.stringify(digestAtDetail(level));
        if (result.length <= RESULT_CHAR_CAP) return result;
    }
    const entries = digestAtDetail(2);
    return JSON.stringify({ note: `too large, first 100 of ${entries.length} shown`, items: entries.slice(0, 100) });
}

const TOOL_DEFS = [
    {
        name: 'workshop_create_character',
        displayName: 'Workshop: Create Character',
        description: 'Import a complete SillyTavern character card. Pass a full chara_card_v2 or v3 JSON object. Check workshop_list_characters first to avoid name collisions.',
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
        description: 'Create a SillyTavern lorebook (World Info file), or append entries to an existing one. Entries use native WI fields (key, content, comment, constant, order, position, ...). Check workshop_list_lorebooks first so target names match reality.',
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
        description: 'Append one entry to a SillyTavern lorebook (created if missing). Entry uses native WI fields. Check workshop_get_lorebook first when merging into an existing book.',
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
        description: 'Create a SillyTavern Quick Reply set (replaces a same-named set — check workshop_list_qr_sets first). Each item has label and an STscript message. Sets carrying auto-execute flags always require user approval.',
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
        description: 'Add or update a global SillyTavern regex find/replace script (check workshop_list_regex_scripts for existing names). placement: 1=user input, 2=AI output, 3=slash commands, 5=World Info, 6=reasoning blocks. markdownOnly alters display only; promptOnly alters what the model sees only.',
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
    // --- Read-only tools: run immediately in both modes ---
    {
        name: 'workshop_search_knowledge',
        displayName: 'Workshop: Search Knowledge',
        description: 'Fetch SillyTavern internals knowledge from the Tavernkeeper knowledge base. Pass an entry id from the injected knowledge index, or a free-text query. Read-only, runs immediately. Use it BEFORE answering nontrivial SillyTavern internals questions.',
        schema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Entry id (e.g. "5") or free-text query' },
            },
            required: ['query'],
        },
        readOnly: true,
        run: async (params) => {
            const hits = searchKnowledge(String(params.query ?? ''));
            if (!hits.length) {
                return 'No knowledge entry matches. Use the WebSearch tool if available, or tell the user what you are unsure about instead of guessing.';
            }
            return JSON.stringify(hits);
        },
    },
    {
        name: 'workshop_list_characters',
        displayName: 'Workshop: List Characters',
        description: 'List installed SillyTavern characters (name, version, creator). Read-only, runs immediately. Use BEFORE creating a character to avoid name collisions.',
        schema: { type: 'object', properties: {} },
        readOnly: true,
        run: async () => {
            const characters = SillyTavern.getContext().characters ?? [];
            return capList(level => characters.map(c => level > 0 ? c.name : ({
                name: c.name,
                version: c.data?.character_version || undefined,
                creator: c.data?.creator || undefined,
            })));
        },
    },
    {
        name: 'workshop_get_character',
        displayName: 'Workshop: Read Character',
        description: 'Read a digest of one installed character card by exact name: core fields (truncated), greeting count, linked lorebook, embedded book presence. Read-only, runs immediately.',
        schema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Exact character name (see workshop_list_characters)' },
            },
            required: ['name'],
        },
        readOnly: true,
        run: async (params) => {
            const wanted = String(params.name ?? '');
            const characters = SillyTavern.getContext().characters ?? [];
            const character = characters.find(c => c.name === wanted)
                ?? characters.find(c => c.name?.toLowerCase() === wanted.toLowerCase());
            if (!character) return `No character named "${wanted}". workshop_list_characters returns the valid names.`;
            const data = character.data ?? character;
            return JSON.stringify({
                name: character.name,
                version: data.character_version || undefined,
                creator: data.creator || undefined,
                tags: data.tags?.length ? data.tags : undefined,
                description: truncateText(data.description, 600),
                personality: truncateText(data.personality, 300),
                scenario: truncateText(data.scenario, 300),
                first_mes: truncateText(data.first_mes, 400),
                alternate_greetings: data.alternate_greetings?.length ?? 0,
                mes_example_chars: String(data.mes_example ?? '').length,
                system_prompt: data.system_prompt ? truncateText(data.system_prompt, 200) : undefined,
                linked_world: data.extensions?.world || undefined,
                has_embedded_book: Boolean(data.character_book),
                depth_prompt: data.extensions?.depth_prompt?.prompt ? truncateText(data.extensions.depth_prompt.prompt, 200) : undefined,
                regex_scripts: data.extensions?.regex_scripts?.length || undefined,
            });
        },
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
            const contentBudget = [400, 120, 0];
            return capList(level => Object.values(data.entries).map(e => ({
                uid: e.uid,
                comment: e.comment || undefined,
                key: e.key?.length ? e.key : undefined,
                keysecondary: e.keysecondary?.length ? e.keysecondary : undefined,
                constant: e.constant || undefined,
                disabled: e.disable || undefined,
                position: e.position,
                depth: e.position === 4 ? e.depth : undefined,
                order: e.order,
                content: truncateText(e.content, contentBudget[level] || 1),
            })));
        },
    },
    {
        name: 'workshop_list_qr_sets',
        displayName: 'Workshop: List Quick Reply Sets',
        description: 'List every Quick Reply set, and which are enabled globally or for this chat. Read-only, runs immediately. Use BEFORE creating a set (same-named sets are replaced).',
        schema: { type: 'object', properties: {} },
        readOnly: true,
        run: async () => {
            const api = globalThis.quickReplyApi;
            if (!api) return 'Quick Reply extension is not available.';
            return JSON.stringify({
                sets: api.listSets(),
                enabledGlobally: api.listGlobalSets(),
                enabledInChat: api.listChatSets(),
            });
        },
    },
    {
        name: 'workshop_get_qr_set',
        displayName: 'Workshop: Read Quick Reply Set',
        description: 'Read one Quick Reply set: each button\'s label, (truncated) STscript, and auto-execute flags. Read-only, runs immediately.',
        schema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Exact set name (see workshop_list_qr_sets)' },
            },
            required: ['name'],
        },
        readOnly: true,
        run: async (params) => {
            const api = globalThis.quickReplyApi;
            if (!api) return 'Quick Reply extension is not available.';
            const set = api.getSetByName(String(params.name ?? ''));
            if (!set) return `No Quick Reply set named "${params.name}". workshop_list_qr_sets returns the valid names.`;
            const execFlags = ['executeOnStartup', 'executeOnUser', 'executeOnAi', 'executeOnChatChange', 'executeOnNewChat', 'executeOnGroupMemberDraft'];
            return capList(level => (set.qrList ?? []).map(qr => ({
                label: qr.label,
                title: qr.title || undefined,
                message: truncateText(qr.message, level === 0 ? 300 : 80),
                isHidden: qr.isHidden || undefined,
                automationId: qr.automationId || undefined,
                autoExecute: execFlags.filter(flag => qr[flag]),
            })));
        },
    },
    {
        name: 'workshop_list_regex_scripts',
        displayName: 'Workshop: List Regex Scripts',
        description: 'List every global regex script: name, (truncated) pattern and replacement, placement, flags. Read-only, runs immediately. Use BEFORE adding a script (same-named scripts are updated).',
        schema: { type: 'object', properties: {} },
        readOnly: true,
        run: async () => {
            const scripts = SillyTavern.getContext().extensionSettings.regex ?? [];
            return capList(level => scripts.map(s => ({
                scriptName: s.scriptName,
                findRegex: truncateText(s.findRegex, level === 0 ? 120 : 40),
                replaceString: truncateText(s.replaceString, level === 0 ? 120 : 40),
                placement: s.placement,
                disabled: s.disabled || undefined,
                markdownOnly: s.markdownOnly || undefined,
                promptOnly: s.promptOnly || undefined,
            })));
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
            formatMessage: () => `Workshop: ${def.readOnly ? 'reading' : 'preparing'} ${def.displayName.replace('Workshop: ', '').toLowerCase()}…`,
            action: async (params) => {
                const settings = getSettings();
                if (def.readOnly) return await def.run(params ?? {});
                const item = def.toItem(params ?? {});
                if (item.invalid) return `Invalid parameters: ${item.invalid}`;
                if (!settings.autoMode || isExecutable(item)) {
                    queueItem(item);
                    return `Queued "${item.name}" (${item.type}) for user approval. It is NOT applied yet — the user reviews it via the approval popup or /workshop-queue. Do not assume it exists.`;
                }
                return await runToolItem(item);
            },
        });
    }

    // Per-chat queue: reload/restore whenever the chat changes.
    ctx.eventSource.on(ctx.eventTypes.CHAT_CHANGED, restoreQueue);
    restoreQueue();

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
        unqueueItem(index);
        // Reindex remaining rows instead of rebuilding the popup.
        row.remove();
        document.querySelectorAll('.tkw-queue-row').forEach((el, i) => { el.dataset.index = String(i); });
    });
}
