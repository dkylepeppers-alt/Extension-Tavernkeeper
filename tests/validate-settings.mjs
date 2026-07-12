import assert from 'node:assert/strict';

// Stub the ST global before importing modules that touch it.
let context;
globalThis.SillyTavern = { getContext: () => context };
const makeContext = (extensionSettings = {}) => ({
    extensionSettings,
    savedCount: 0,
    saveSettingsDebounced() { this.savedCount++; },
});

const { getSettings, MODULE } = await import('../src/settings.js');
const { detectCapabilities, compatSummary, setWriterCapability } = await import('../src/compat.js');

// --- Fresh install: defaults seeded at the current schema version ---
{
    context = makeContext();
    const s = getSettings();
    assert.equal(s.settingsVersion, 1);
    assert.equal(s.enabled, true);
    assert.equal(s.autoMode, false);
    assert.equal(s.enableTools, true);
    assert.equal(s.maxBlockKb, 256);
    assert.equal(s.lastKnowledgeVersion, 0);
    assert.ok(!('heuristics' in s), 'fresh installs never see the removed heuristics key');
    assert.ok(!('legacyBookNotice' in s), 'fresh installs get no migration notice');
}

// --- 2.x upgrade: heuristics dropped, synced-book flag becomes a one-time notice ---
{
    context = makeContext({
        [MODULE]: {
            enabled: true, autoMode: true, enableTools: true, heuristics: true,
            enableQrSetsOnApply: false, maxBlockKb: 128, injectProtocol: true, knowledgeVersion: 2,
        },
    });
    const s = getSettings();
    assert.equal(s.settingsVersion, 1);
    assert.ok(!('heuristics' in s), 'migration removes heuristics');
    assert.ok(!('knowledgeVersion' in s), 'migration removes knowledgeVersion');
    assert.equal(s.legacyBookNotice, true, 'a previously synced book earns the retirement notice');
    assert.equal(s.autoMode, true, 'user choices survive migration');
    assert.equal(s.maxBlockKb, 128, 'user choices survive migration');
    assert.equal(s.lastKnowledgeVersion, 0, 'new keys are forward-filled');
    assert.ok(context.savedCount >= 1, 'migration persists itself');

    // Idempotent: a second read must not resurrect anything.
    delete s.legacyBookNotice;
    const again = getSettings();
    assert.equal(again, s);
    assert.ok(!('legacyBookNotice' in again), 'migration does not re-run');
}

// --- 2.x install that never synced a book: no notice ---
{
    context = makeContext({ [MODULE]: { enabled: true, heuristics: false, knowledgeVersion: 0 } });
    const s = getSettings();
    assert.ok(!('legacyBookNotice' in s));
}

// --- Capability detection ---
{
    const fullContext = {
        registerFunctionTool() {}, setExtensionPrompt() {},
        loadWorldInfo() {}, saveWorldInfo() {},
        SlashCommandParser: {}, SlashCommand: {}, callGenericPopup() {},
        ToolManager: { tools: [{ toFunctionOpenAI: () => ({ function: { name: 'WebSearch' } }), displayName: 'Web Search' }] },
    };
    globalThis.quickReplyApi = {};
    const caps = detectCapabilities(fullContext);
    assert.equal(caps.functionTools, true);
    assert.equal(caps.injection, true);
    assert.equal(caps.worldInfo, true);
    assert.equal(caps.quickReplies, true);
    assert.equal(caps.slashCommands, true);
    assert.equal(caps.popups, true);
    assert.equal(caps.webSearch, true);
    assert.equal(caps.extensionWriter, false);
    setWriterCapability(true);
    const withWriter = detectCapabilities(fullContext);
    assert.equal(withWriter.extensionWriter, true);
    assert.match(compatSummary(withWriter), /All features available/);

    delete globalThis.quickReplyApi;
    const bare = detectCapabilities({});
    assert.equal(bare.functionTools, false);
    assert.equal(bare.webSearch, false);
    const summary = compatSummary(bare);
    assert.match(summary, /[Mm]issing/, 'summary names missing features');
    assert.match(summary, /function tools/i);
    assert.ok(!/WebSearch/.test(summary.split('.')[0]), 'optional WebSearch is not listed as missing core');
}

console.log('Settings + compat validation passed');
