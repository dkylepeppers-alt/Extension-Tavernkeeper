import { getSettings } from './settings.js';

// createNewWorldInfo / createWorldInfoEntry / updateWorldInfoList are not on
// getContext(); loaded via absolute dynamic import so a moved module degrades
// gracefully instead of killing the whole extension at import time.
let worldInfoModule = null;

export async function initAppliers() {
    try {
        worldInfoModule = await import('/scripts/world-info.js');
    } catch (error) {
        worldInfoModule = null;
        console.error("[Tavernkeeper's Workshop] Could not import /scripts/world-info.js — lorebook appliers disabled", error);
        toastr.warning('Lorebook creation unavailable (world-info module not found)', "Tavernkeeper's Workshop");
    }
}

// Native WI field names, plus accepted aliases from card-embedded (V2) books.
const ENTRY_FIELDS = [
    'key', 'keysecondary', 'content', 'comment', 'constant', 'selective', 'selectiveLogic',
    'order', 'position', 'depth', 'role', 'disable', 'probability', 'useProbability',
    'group', 'groupOverride', 'groupWeight', 'useGroupScoring', 'preventRecursion',
    'excludeRecursion', 'delayUntilRecursion', 'sticky', 'cooldown', 'delay',
    'scanDepth', 'caseSensitive', 'matchWholeWords', 'automationId', 'vectorized', 'ignoreBudget',
];
const ENTRY_ALIASES = {
    keys: 'key',
    secondary_keys: 'keysecondary',
    insertion_order: 'order',
    prevent_recursion: 'preventRecursion',
    exclude_recursion: 'excludeRecursion',
    delay_until_recursion: 'delayUntilRecursion',
    scan_depth: 'scanDepth',
    case_sensitive: 'caseSensitive',
    match_whole_words: 'matchWholeWords',
    automation_id: 'automationId',
    group_override: 'groupOverride',
    group_weight: 'groupWeight',
    use_group_scoring: 'useGroupScoring',
    ignore_budget: 'ignoreBudget',
};

function normalizeEntryFields(source) {
    // Flatten a V2 embedded-style entry (extensions sub-object) and alias names.
    const flat = { ...source };
    if (source.extensions && typeof source.extensions === 'object') {
        Object.assign(flat, source.extensions);
    }
    const out = {};
    for (const [key, value] of Object.entries(flat)) {
        const target = ENTRY_ALIASES[key] ?? key;
        if (ENTRY_FIELDS.includes(target) && value !== undefined) out[target] = value;
    }
    if (flat.enabled !== undefined && out.disable === undefined) out.disable = !flat.enabled;
    // Position may arrive as V2 'before_char'/'after_char' strings.
    if (out.position === 'before_char') out.position = 0;
    if (out.position === 'after_char') out.position = 1;
    return out;
}

async function loadBookOrNull(name) {
    const ctx = SillyTavern.getContext();
    try {
        const data = await ctx.loadWorldInfo(name);
        return data && data.entries ? data : null;
    } catch {
        return null;
    }
}

function appendEntry(bookData, entrySource) {
    const newEntry = worldInfoModule.createWorldInfoEntry(null, bookData);
    if (!newEntry) throw new Error('Could not allocate a new entry UID');
    Object.assign(newEntry, normalizeEntryFields(entrySource));
    return newEntry;
}

async function applyWiEntry(item) {
    if (!worldInfoModule) return { ok: false, message: 'World Info module unavailable' };
    const ctx = SillyTavern.getContext();
    const { book, entry } = item.data;

    let bookData = await loadBookOrNull(book);
    if (!bookData) {
        const created = await worldInfoModule.createNewWorldInfo(book, { interactive: false });
        if (!created) return { ok: false, message: `Could not create lorebook "${book}"` };
        bookData = await loadBookOrNull(book);
        if (!bookData) return { ok: false, message: `Created "${book}" but could not reload it` };
    }

    const clone = structuredClone(bookData); // WI cache holds data by reference — never mutate a loaded book
    const newEntry = appendEntry(clone, entry);
    await ctx.saveWorldInfo(book, clone, true);
    ctx.reloadWorldInfoEditor?.(book, false);
    return { ok: true, message: `Added entry "${newEntry.comment || newEntry.key?.[0] || newEntry.uid}" to lorebook "${book}" (World Info panel)` };
}

async function applyLorebook(item) {
    if (!worldInfoModule) return { ok: false, message: 'World Info module unavailable' };
    const ctx = SillyTavern.getContext();
    const name = item.data.name;
    const sourceEntries = Array.isArray(item.data.entries) ? item.data.entries : Object.values(item.data.entries);

    const existing = await loadBookOrNull(name);
    // loadWorldInfo can return an empty shell for a missing book — count entries instead.
    const isNew = !existing || Object.keys(existing.entries ?? {}).length === 0;
    const bookData = existing ? structuredClone(existing) : { entries: {} };
    for (const entrySource of sourceEntries) {
        appendEntry(bookData, entrySource);
    }
    await ctx.saveWorldInfo(name, bookData, true);
    if (isNew) await worldInfoModule.updateWorldInfoList();
    ctx.reloadWorldInfoEditor?.(name, false);
    const verb = isNew ? `Created` : `Merged ${sourceEntries.length} entries into existing`;
    return { ok: true, message: `${verb} lorebook "${name}" (${sourceEntries.length} entries) — manage under World Info` };
}

async function applyCard(item) {
    const ctx = SillyTavern.getContext();
    const name = item.data?.data?.name ?? item.data?.name ?? 'imported';
    const safeName = String(name).replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'imported';
    const file = new File([item.raw], `${safeName}.json`, { type: 'application/json' });
    const body = new FormData();
    body.append('avatar', file);
    body.append('file_type', 'json');

    const response = await fetch('/api/characters/import', {
        method: 'POST',
        headers: ctx.getRequestHeaders({ omitContentType: true }),
        cache: 'no-cache',
        body,
    });
    if (!response.ok) return { ok: false, message: `Character import failed (HTTP ${response.status})` };
    const result = await response.json();
    await ctx.getCharacters();
    return { ok: true, message: `Imported character "${result.file_name ?? name}" — see the character list` };
}

async function applyQrSet(item) {
    const api = globalThis.quickReplyApi;
    if (!api) return { ok: false, message: 'Quick Reply extension is not available' };
    const { name, qrList, disableSend, placeBeforeInput, injectInput } = item.data;

    await api.createSet(name, {
        disableSend: !!disableSend,
        placeBeforeInput: !!placeBeforeInput,
        injectInput: !!injectInput,
    });
    let count = 0;
    for (const qr of qrList) {
        if (!qr || typeof qr.message !== 'string') continue;
        api.createQuickReply(name, qr.label ?? `QR ${++count}`, {
            message: qr.message,
            title: qr.title ?? '',
            icon: qr.icon,
            showLabel: qr.showLabel,
            isHidden: !!qr.isHidden,
            executeOnStartup: !!qr.executeOnStartup,
            executeOnUser: !!qr.executeOnUser,
            executeOnAi: !!qr.executeOnAi,
            executeOnChatChange: !!qr.executeOnChatChange,
            executeOnNewChat: !!qr.executeOnNewChat,
            executeOnGroupMemberDraft: !!qr.executeOnGroupMemberDraft,
            automationId: qr.automationId ?? '',
        });
        count++;
    }
    if (getSettings().enableQrSetsOnApply) {
        api.toggleGlobalSet(name, true);
    }
    return { ok: true, message: `Quick Reply set "${name}" created with ${count} buttons (existing set of the same name is replaced)` };
}

async function applyRegex(item) {
    const ctx = SillyTavern.getContext();
    const data = item.data;

    // Validate the pattern before persisting anything.
    try {
        const match = String(data.findRegex).match(/^\/([\w\W]+?)\/([gimsuy]*)$/);
        if (match) new RegExp(match[1], match[2]);
        else new RegExp(String(data.findRegex));
    } catch (error) {
        return { ok: false, message: `findRegex does not compile: ${error.message}` };
    }

    if (!Array.isArray(ctx.extensionSettings.regex)) ctx.extensionSettings.regex = [];
    const scripts = ctx.extensionSettings.regex;
    const existing = scripts.find(s => s.scriptName === data.scriptName);
    const script = {
        id: existing?.id ?? crypto.randomUUID(),
        scriptName: data.scriptName,
        findRegex: data.findRegex,
        replaceString: data.replaceString ?? '',
        trimStrings: Array.isArray(data.trimStrings) ? data.trimStrings : [],
        placement: Array.isArray(data.placement) && data.placement.length ? data.placement : [2],
        disabled: !!data.disabled,
        markdownOnly: data.markdownOnly ?? true,
        promptOnly: data.promptOnly ?? false,
        runOnEdit: data.runOnEdit ?? false,
        substituteRegex: data.substituteRegex ?? 0,
        minDepth: data.minDepth ?? null,
        maxDepth: data.maxDepth ?? null,
    };
    if (existing) Object.assign(existing, script);
    else scripts.push(script);
    ctx.saveSettingsDebounced();
    const verb = existing ? 'updated' : 'added';
    return { ok: true, message: `Regex script "${script.scriptName}" ${verb} — active immediately; the Regex settings list refreshes on reload` };
}

async function applyScript(item) {
    const ctx = SillyTavern.getContext();
    const result = await ctx.executeSlashCommandsWithOptions(item.raw, {
        handleParserErrors: true,
        handleExecutionErrors: true,
        source: 'tavernkeeper-workshop',
    });
    if (result?.isError) return { ok: false, message: result.errorMessage ?? 'Script failed' };
    const pipe = result?.pipe;
    return { ok: true, message: `Script executed${pipe ? ` — result: ${String(pipe).slice(0, 120)}` : ''}` };
}

const APPLIERS = {
    'card': applyCard,
    'lorebook': applyLorebook,
    'wi-entry': applyWiEntry,
    'qrset': applyQrSet,
    'regex': applyRegex,
    'script': applyScript,
};

/**
 * Apply a deliverable item. Always resolves to { ok, message }; never throws.
 */
export async function apply(item) {
    if (item.invalid) return { ok: false, message: item.invalid };
    const applier = APPLIERS[item.type];
    if (!applier) return { ok: false, message: `No applier for type "${item.type}"` };
    try {
        return await applier(item);
    } catch (error) {
        console.error("[Tavernkeeper's Workshop] apply failed", item.type, error);
        return { ok: false, message: error.message ?? String(error) };
    }
}
