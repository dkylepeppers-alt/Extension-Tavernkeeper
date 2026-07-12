import { getSettings } from './settings.js';

export const TYPE_INFO = {
    'card': { icon: 'fa-id-card', label: 'Character Card' },
    'lorebook': { icon: 'fa-book-atlas', label: 'Lorebook' },
    'wi-entry': { icon: 'fa-book-bookmark', label: 'Lorebook Entry' },
    'qrset': { icon: 'fa-bolt', label: 'Quick Reply Set' },
    'regex': { icon: 'fa-shuffle', label: 'Regex Script' },
    'script': { icon: 'fa-terminal', label: 'STscript' },
    'extension-create': { icon: 'fa-folder-plus', label: 'Managed Extension' },
    'extension-adopt': { icon: 'fa-folder-tree', label: 'Adopt Extension' },
    'extension-patch': { icon: 'fa-code-branch', label: 'Extension Update' },
    'extension-rollback': { icon: 'fa-clock-rotate-left', label: 'Extension Rollback' },
};

const TAG_TYPES = {
    'st-card': 'card',
    'st-lorebook': 'lorebook',
    'st-wi-entry': 'wi-entry',
    'st-qrset': 'qrset',
    'st-regex': 'regex',
    'st-script': 'script',
    'st-extension-create': 'extension-create',
    'st-extension-adopt': 'extension-adopt',
    'st-extension-patch': 'extension-patch',
    'st-extension-rollback': 'extension-rollback',
};

// Matches every fenced code block; blockIndex counts ALL fences so it maps 1:1
// onto the message's `.mes_text pre > code` DOM order. CommonMark-style: the
// closing fence must be at least as long as the opener, so a 4-backtick fence
// can carry a body that itself contains ``` lines (e.g. a card's mes_example).
const FENCE_RE = /^[ \t]*(`{3,})([\w-]*)[^\n]*\n([\s\S]*?)\n[ \t]*\1`*[ \t]*$/gm;

function fnv1a(str) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

function truncate(text, max = 60) {
    text = String(text ?? '').replace(/\s+/g, ' ').trim();
    return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

/**
 * Normalize a (type, data, raw) triple into a deliverable item with hash,
 * display name, summary, and validation. Shared by fence parsing and tools.
 * occurrence salts the hash for repeated identical blocks in one message;
 * 0 keeps the pre-3.0 hash so stored chat state still matches.
 */
export function makeItem(type, data, raw, blockIndex = -1, occurrence = 0) {
    const item = {
        type,
        data,
        raw,
        blockIndex,
        hash: fnv1a(type + '\0' + raw + (occurrence ? '\0' + occurrence : '')),
        name: '',
        summary: '',
        invalid: null,
    };

    switch (type) {
        case 'card': {
            const name = data?.data?.name ?? data?.name;
            if (!String(data?.spec ?? '').startsWith('chara_card') || !name) {
                item.invalid = 'Not a chara_card_v2/v3 object (needs "spec" and a character name)';
                break;
            }
            item.name = name;
            const bookEntries = data?.data?.character_book?.entries;
            const bookCount = Array.isArray(bookEntries) ? bookEntries.length : 0;
            item.summary = `${data.spec_version ? 'v' + data.spec_version : data.spec}${bookCount ? ` · ${bookCount} book entries` : ''}`;
            break;
        }
        case 'lorebook': {
            const entries = data?.entries;
            const count = Array.isArray(entries) ? entries.length : (entries && typeof entries === 'object' ? Object.keys(entries).length : -1);
            if (!data?.name || count < 0) {
                item.invalid = 'Lorebook needs "name" and an "entries" object or array';
                break;
            }
            item.name = data.name;
            item.summary = `${count} ${count === 1 ? 'entry' : 'entries'}`;
            break;
        }
        case 'wi-entry': {
            if (!data?.book || !data?.entry || typeof data.entry !== 'object' || !data.entry.content) {
                item.invalid = 'st-wi-entry needs {"book": "...", "entry": {"content": "...", ...}}';
                break;
            }
            const keys = data.entry.key ?? data.entry.keys ?? [];
            item.name = data.entry.comment || keys[0] || '(untitled)';
            item.summary = `→ ${data.book}`;
            break;
        }
        case 'qrset': {
            if (!data?.name || !Array.isArray(data?.qrList)) {
                item.invalid = 'Quick Reply set needs "name" and a "qrList" array';
                break;
            }
            item.name = data.name;
            item.summary = `${data.qrList.length} ${data.qrList.length === 1 ? 'button' : 'buttons'}`;
            break;
        }
        case 'regex': {
            if (!data?.scriptName || typeof data?.findRegex !== 'string') {
                item.invalid = 'Regex script needs "scriptName" and "findRegex"';
                break;
            }
            item.name = data.scriptName;
            item.summary = truncate(data.findRegex, 40);
            break;
        }
        case 'script': {
            const firstLine = String(raw ?? '').split('\n')[0];
            if (!String(raw ?? '').trim().startsWith('/')) {
                item.invalid = 'STscript must start with a slash command';
                break;
            }
            item.name = truncate(firstLine, 48);
            const lines = String(raw).split('\n').length;
            item.summary = lines > 1 ? `${lines} lines` : 'one-liner';
            break;
        }
        case 'extension-create': {
            const files = data?.files;
            if (!data?.slug || !data?.displayName || !files || typeof files !== 'object' || Array.isArray(files)) {
                item.invalid = 'Extension creation needs "slug", "displayName", and a "files" object';
                break;
            }
            const count = Object.keys(files).length;
            if (!count) {
                item.invalid = 'Extension creation needs at least one file';
                break;
            }
            item.name = data.displayName;
            item.summary = `${count} ${count === 1 ? 'file' : 'files'} · new managed extension`;
            break;
        }
        case 'extension-adopt': {
            if (!data?.slug) {
                item.invalid = 'Extension adoption needs "slug"';
                break;
            }
            item.name = data.slug;
            item.summary = 'claim existing extension for managed updates';
            break;
        }
        case 'extension-patch': {
            if (!data?.projectId || !data?.slug || !Number.isInteger(data?.expectedRevision) || !Array.isArray(data?.operations) || !data.operations.length) {
                item.invalid = 'Extension patch needs "projectId", "slug", integer "expectedRevision", and non-empty "operations"';
                break;
            }
            item.name = data.slug;
            item.summary = `${data.operations.length} ${data.operations.length === 1 ? 'change' : 'changes'} · revision ${data.expectedRevision}`;
            break;
        }
        case 'extension-rollback': {
            if (!data?.projectId || !data?.slug || !Number.isInteger(data?.expectedRevision) || !Number.isInteger(data?.targetRevision)) {
                item.invalid = 'Extension rollback needs "projectId", "slug", integer "expectedRevision", and integer "targetRevision"';
                break;
            }
            item.name = data.slug;
            item.summary = `revision ${data.expectedRevision} → ${data.targetRevision}`;
            break;
        }
        default:
            item.invalid = `Unknown deliverable type "${type}"`;
    }

    return item;
}

// Auto-execute QR flags: a set carrying any of these runs STscript without a tap.
const QR_EXEC_FLAGS = [
    'executeOnStartup', 'executeOnUser', 'executeOnAi',
    'executeOnChatChange', 'executeOnNewChat', 'executeOnGroupMemberDraft',
];

function entryHasAutomation(entry) {
    return Boolean(entry && typeof entry === 'object' && (entry.automationId || entry.automation_id));
}

/**
 * True for any deliverable that can execute STscript — directly (script) or
 * indirectly (QR auto-execute flags, WI automationId firing a Quick Reply).
 * These always require a manual Apply, even in auto mode.
 */
export function isExecutable(item) {
    switch (item?.type) {
        case 'script':
            return true;
        case 'qrset':
            return (item.data?.qrList ?? []).some(qr => qr && QR_EXEC_FLAGS.some(flag => qr[flag]));
        case 'lorebook': {
            const entries = item.data?.entries;
            const values = Array.isArray(entries) ? entries : Object.values(entries ?? {});
            return values.some(entryHasAutomation);
        }
        case 'wi-entry':
            return entryHasAutomation(item.data?.entry);
        case 'extension-create':
        case 'extension-adopt':
        case 'extension-patch':
        case 'extension-rollback':
            return true;
        default:
            return false;
    }
}

/**
 * Extract deliverable items from a message's raw text. Only tagged st-* fences
 * count — untagged JSON is never guessed at. Returns [] on anything
 * unparseable; never throws.
 */
export function extractDeliverables(mesText, settings = getSettings()) {
    const items = [];
    if (typeof mesText !== 'string' || !mesText.includes('```')) return items;

    let match;
    let blockIndex = -1;
    const occurrences = new Map();
    FENCE_RE.lastIndex = 0;
    while ((match = FENCE_RE.exec(mesText)) !== null) {
        blockIndex++;
        const lang = (match[2] || '').toLowerCase();
        const body = match[3].trim();
        if (!body || body.length > settings.maxBlockKb * 1024) continue;

        const taggedType = TAG_TYPES[lang];
        if (!taggedType) continue;
        const occKey = taggedType + '\0' + body;
        const occurrence = occurrences.get(occKey) ?? 0;
        occurrences.set(occKey, occurrence + 1);

        if (taggedType === 'script') {
            items.push(makeItem('script', null, body, blockIndex, occurrence));
            continue;
        }
        try {
            items.push(makeItem(taggedType, JSON.parse(body), body, blockIndex, occurrence));
        } catch (error) {
            const item = makeItem(taggedType, null, body, blockIndex, occurrence);
            item.invalid = `Invalid JSON: ${error.message}`;
            items.push(item);
        }
    }
    return items;
}
