import { getSettings, saveSettings } from './settings.js';
import { detectCapabilities } from './compat.js';

const LOG_PREFIX = "[Tavernkeeper's Workshop]";
// Resolved relative to this module so the install folder name never matters.
const KNOWLEDGE_URL = new URL('../knowledge/tavernkeeper-knowledge.json', import.meta.url).href;
const INJECT_KEY = 'TAVERNKEEPER_WORKSHOP';
const LEGACY_BOOK_NAME = 'Tavernkeeper Knowledge';

// The knowledge base is a bundled JSON served on demand (TOC + fetch-by-id,
// lexical search as fallback). Embeddings were deliberately rejected: at this
// corpus size (~26 entries) the recall gain is negligible and every embedding
// path needs a configured backend or a large in-browser model. If the corpus
// grows to hundreds of entries, revisit ST's Vector Storage (/api/vector/*).
let knowledge = null;

export function getKnowledge() {
    return knowledge;
}

/**
 * Load the bundled knowledge JSON once. Never throws; returns null on failure.
 */
export async function loadKnowledge() {
    try {
        const response = await fetch(KNOWLEDGE_URL, { cache: 'no-cache' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bundle = await response.json();
        if (!Number.isInteger(bundle.version) || !bundle.entries) throw new Error('malformed knowledge file');
        knowledge = bundle;
    } catch (error) {
        knowledge = null;
        console.error(`${LOG_PREFIX} could not load the knowledge base`, error);
        toastr.warning(`Knowledge base failed to load: ${error.message}`, "Tavernkeeper's Workshop");
    }
    return knowledge;
}

// --- Retrieval (pure — exercised by tests/validate-knowledge.mjs) ---

/** Compact one-line index of every entry: "0: Title; 1: Title; ...". */
export function buildToc(k) {
    return Object.values(k?.entries ?? {})
        .sort((a, b) => a.uid - b.uid)
        .map(e => `${e.uid}: ${e.comment}`)
        .join('; ');
}

function tokenize(text) {
    return (String(text ?? '').toLowerCase().match(/[a-z0-9_]{2,}/g) ?? []);
}

function pickEntry(e) {
    return { uid: e.uid, comment: e.comment, key: e.key, content: e.content };
}

const MAX_RESULTS = 3;
const MAX_RESULT_CHARS = 16384;

/**
 * Fetch by exact entry id, or score entries against a free-text query.
 * Scoring favors query⊇key-phrase hits (the entry's own vocabulary appearing
 * in the question), then per-term key/comment/content matches.
 */
export function searchKnowledge(idOrQuery, k = knowledge) {
    if (!k?.entries) return [];
    const query = String(idOrQuery ?? '').trim();
    if (!query) return [];
    if (/^\d+$/.test(query) && k.entries[query]) return [pickEntry(k.entries[query])];

    const qLower = query.toLowerCase();
    const terms = [...new Set(tokenize(query))];
    if (!terms.length) return [];

    const scored = [];
    for (const entry of Object.values(k.entries)) {
        const keyText = (entry.key ?? []).join(' ').toLowerCase();
        const commentText = String(entry.comment ?? '').toLowerCase();
        const contentText = String(entry.content ?? '').toLowerCase();
        let score = 0;
        for (const keyPhrase of entry.key ?? []) {
            const phrase = String(keyPhrase).toLowerCase();
            if (phrase.length >= 4 && qLower.includes(phrase)) score += 15;
        }
        for (const term of terms) {
            if (keyText.includes(term)) score += 8;
            if (commentText.includes(term)) score += 4;
            let occurrences = 0;
            for (let at = contentText.indexOf(term); at !== -1 && occurrences < 5; at = contentText.indexOf(term, at + term.length)) {
                occurrences++;
            }
            score += occurrences;
        }
        if (terms.length > 1 && contentText.includes(qLower)) score += 6;
        if (score > 0) scored.push({ score, entry });
    }
    scored.sort((a, b) => b.score - a.score);
    const results = scored.slice(0, MAX_RESULTS).map(s => pickEntry(s.entry));
    while (results.length > 1 && JSON.stringify(results).length > MAX_RESULT_CHARS) results.pop();
    return results;
}

/**
 * Always-on knowledge primer: the constant architecture entry, the TOC, and
 * the standing instruction to fetch before answering (plus WebSearch on miss
 * when that tool exists).
 */
export function buildPrimer(k, { webSearchAvailable = false } = {}) {
    const constant = Object.values(k?.entries ?? {}).find(e => e.constant);
    const missBehavior = webSearchAvailable
        ? 'If no entry matches, use the WebSearch tool before answering from memory.'
        : 'If no entry matches, say what you are unsure about instead of guessing.';
    return `${constant?.content ?? ''}\n`
        + `Knowledge index (fetch full entries with the workshop_search_knowledge tool, by id or free-text query): ${buildToc(k)}.\n`
        + `For any nontrivial SillyTavern internals question, fetch the relevant entry BEFORE answering. ${missBehavior}`;
}

// --- Browser runtime ---

function protocolText(settings) {
    const mode = settings.autoMode
        ? 'AUTO mode: tagged deliverables are applied the moment your message arrives, so only tag a fence when the artifact is complete and correct (STscript, script-capable artifacts, and all managed-extension changes still wait for manual approval).'
        : 'PLAN mode: the user gets an Apply button under each tagged block; nothing changes without their tap.';
    return `[Tavernkeeper's Workshop is active. Prefer the workshop_* function tools when they are available. Managed extension workflow: call workshop_list_extension_projects and workshop_get_extension_project before updates; create/adopt/update/rollback tools always require a server-validated manual diff review and never auto-apply. In plain replies, deliver a finished, importable SillyTavern artifact as one fenced code block tagged with exactly one of: st-card (complete chara_card_v2/v3 JSON), st-lorebook ({"name", "entries"}), st-wi-entry ({"book", "entry"}), st-qrset ({"name", "qrList": [{"label", "message"}]}), st-regex (one regex script object with scriptName/findRegex/replaceString), st-script (raw STscript starting with /), st-extension-create ({"slug","displayName","files"}), st-extension-adopt ({"slug"}), st-extension-patch ({"projectId","slug","expectedRevision","operations"}), st-extension-rollback ({"projectId","slug","expectedRevision","targetRevision"}). Bodies are strict JSON — no comments or trailing commas — except st-script (raw script text). One deliverable per fence; no prose inside the fence. If the body itself contains \`\`\` lines, use a longer fence (\`\`\`\`) so the block survives parsing. ${mode} Drafts, examples, or anything that must NOT be applied: use jsonc or text fences, never st-* tags.]`;
}

/**
 * Install, refresh, or clear the always-on injection (protocol + knowledge
 * primer). Call at init and whenever enabled/autoMode/injectProtocol change.
 */
export function updateProtocolInjection() {
    const ctx = SillyTavern.getContext();
    if (typeof ctx.setExtensionPrompt !== 'function') return;
    const settings = getSettings();
    const active = settings.enabled && settings.injectProtocol;
    let text = '';
    if (active) {
        text = protocolText(settings);
        if (knowledge) {
            // Live re-probe: the WebSearch extension may register after init.
            text += '\n' + buildPrimer(knowledge, { webSearchAvailable: detectCapabilities().webSearch });
        }
    }
    // position 1 = IN_CHAT, role 0 = SYSTEM (extension_prompt_types/_roles in script.js)
    ctx.setExtensionPrompt(INJECT_KEY, text, 1, 6, false, 0);
}

/**
 * One-time notices after load: the 2.x → 3.0 lorebook retirement, and a
 * changelog toast when the bundled knowledge version advanced.
 */
export function notifyKnowledgeState() {
    if (!knowledge) return;
    const settings = getSettings();
    if (settings.legacyBookNotice) {
        delete settings.legacyBookNotice;
        saveSettings();
        toastr.info(
            `The "${LEGACY_BOOK_NAME}" lorebook is no longer used — knowledge is now served by the workshop_search_knowledge tool. You can delete that world file under World Info.`,
            "Tavernkeeper's Workshop",
            { timeOut: 15000 },
        );
    }
    if (settings.lastKnowledgeVersion !== knowledge.version) {
        const news = (knowledge.changelog ?? [])
            .filter(c => c.version > (settings.lastKnowledgeVersion ?? 0) && c.version <= knowledge.version)
            .map(c => c.summary);
        if (settings.lastKnowledgeVersion > 0 && news.length) {
            toastr.info(`Knowledge updated: ${news.join(' ')}`, "Tavernkeeper's Workshop", { timeOut: 10000 });
        }
        settings.lastKnowledgeVersion = knowledge.version;
        saveSettings();
    }
}
