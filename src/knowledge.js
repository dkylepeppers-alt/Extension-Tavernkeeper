import { getSettings, saveSettings } from './settings.js';

const LOG_PREFIX = "[Tavernkeeper's Workshop]";
const BOOK_NAME = 'Tavernkeeper Knowledge';
const KNOWLEDGE_URL = '/scripts/extensions/third-party/Extension-Tavernkeeper/knowledge/tavernkeeper-knowledge.json';
const INJECT_KEY = 'TAVERNKEEPER_WORKSHOP';

// Mirror of ST's newWorldInfoEntryTemplate (world-info.js) so the bundled
// knowledge file only needs to carry meaningful fields.
const ENTRY_DEFAULTS = Object.freeze({
    key: [],
    keysecondary: [],
    comment: '',
    content: '',
    constant: false,
    vectorized: false,
    selective: true,
    selectiveLogic: 0,
    addMemo: true,
    order: 100,
    position: 0,
    disable: false,
    ignoreBudget: false,
    excludeRecursion: false,
    preventRecursion: true,
    matchPersonaDescription: false,
    matchCharacterDescription: false,
    matchCharacterPersonality: false,
    matchCharacterDepthPrompt: false,
    matchScenario: false,
    matchCreatorNotes: false,
    delayUntilRecursion: 0,
    probability: 100,
    useProbability: true,
    depth: 4,
    outletName: '',
    group: '',
    groupOverride: false,
    groupWeight: 100,
    scanDepth: null,
    caseSensitive: null,
    matchWholeWords: null,
    useGroupScoring: null,
    automationId: '',
    role: 0,
    sticky: null,
    cooldown: null,
    delay: null,
    triggers: [],
});

/**
 * Create or update the extension-owned knowledge world file. The extension is
 * the source of truth: on a version bump the whole book is overwritten, so
 * user edits to this specific book do not survive updates (documented in the
 * README). Never throws.
 */
export async function syncKnowledgeBook() {
    const ctx = SillyTavern.getContext();
    const settings = getSettings();
    try {
        const response = await fetch(KNOWLEDGE_URL, { cache: 'no-cache' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bundled = await response.json();
        if (!Number.isInteger(bundled.version) || !bundled.entries) throw new Error('malformed knowledge file');

        const bookExists = ctx.getWorldInfoNames?.().includes(BOOK_NAME)
            ?? Boolean(await ctx.loadWorldInfo(BOOK_NAME));
        if (bookExists && settings.knowledgeVersion === bundled.version) return;

        const entries = {};
        for (const [uid, entry] of Object.entries(bundled.entries)) {
            entries[uid] = { ...structuredClone(ENTRY_DEFAULTS), ...entry, uid: Number(uid), displayIndex: Number(uid) };
        }
        await ctx.saveWorldInfo(BOOK_NAME, { entries }, true);
        await ctx.updateWorldInfoList?.();
        settings.knowledgeVersion = bundled.version;
        saveSettings();
        console.log(`${LOG_PREFIX} knowledge book "${BOOK_NAME}" synced to version ${bundled.version}`);
        if (!bookExists) {
            toastr.info(`Knowledge book "${BOOK_NAME}" installed — link it to characters or activate it under World Info`, "Tavernkeeper's Workshop");
        }
    } catch (error) {
        console.error(`${LOG_PREFIX} knowledge book sync failed`, error);
        toastr.warning(`Knowledge book sync failed: ${error.message}`, "Tavernkeeper's Workshop");
    }
}

function protocolText(settings) {
    const mode = settings.autoMode
        ? 'AUTO mode: tagged deliverables are applied the moment your message arrives, so only tag a fence when the artifact is complete and correct (STscript still waits for manual approval).'
        : 'PLAN mode: the user gets an Apply button under each tagged block; nothing changes without their tap.';
    return `[Tavernkeeper's Workshop is active. To deliver a finished, importable SillyTavern artifact, emit it as one fenced code block tagged with exactly one of: st-card (complete chara_card_v2/v3 JSON), st-lorebook ({"name", "entries"}), st-wi-entry ({"book", "entry"}), st-qrset ({"name", "qrList": [{"label", "message"}]}), st-regex (one regex script object with scriptName/findRegex/replaceString), st-script (raw STscript starting with /). Bodies are strict JSON — no comments or trailing commas — except st-script (raw script text). One deliverable per fence; no prose inside the fence. ${mode} Drafts, examples, or anything that must NOT be applied: use jsonc or text fences, never st-* tags or bare json fences.]`;
}

/**
 * Install, refresh, or clear the always-on protocol injection. Call at init
 * and whenever enabled/autoMode/injectProtocol change.
 */
export function updateProtocolInjection() {
    const ctx = SillyTavern.getContext();
    const settings = getSettings();
    const active = settings.enabled && settings.injectProtocol;
    // position 1 = IN_CHAT, role 0 = SYSTEM (extension_prompt_types/_roles in script.js)
    ctx.setExtensionPrompt(INJECT_KEY, active ? protocolText(settings) : '', 1, 6, false, 0);
}
