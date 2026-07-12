// Feature detection: probe the running ST for every API surface the Workshop
// uses, so a version gap degrades into a visible compatibility note instead of
// silent breakage.

let capabilities = null;

const CORE_FEATURES = {
    functionTools: 'LLM function tools',
    injection: 'protocol/knowledge prompt injection',
    worldInfo: 'lorebook read/write',
    quickReplies: 'Quick Reply sets',
    slashCommands: 'slash commands',
    popups: 'approval popups',
};

/** True when some registered function tool looks like a web search. */
function hasWebSearchTool(ctx) {
    const tools = ctx.ToolManager?.tools ?? [];
    return tools.some(tool => {
        try {
            const name = tool.toFunctionOpenAI?.()?.function?.name ?? '';
            return /web.?search/i.test(name) || /web.?search/i.test(tool.displayName ?? '');
        } catch {
            return false;
        }
    });
}

export function detectCapabilities(ctx = SillyTavern.getContext()) {
    capabilities = {
        functionTools: typeof ctx.registerFunctionTool === 'function',
        injection: typeof ctx.setExtensionPrompt === 'function',
        worldInfo: typeof ctx.loadWorldInfo === 'function' && typeof ctx.saveWorldInfo === 'function',
        quickReplies: Boolean(globalThis.quickReplyApi),
        slashCommands: Boolean(ctx.SlashCommandParser && ctx.SlashCommand),
        popups: typeof ctx.callGenericPopup === 'function',
        webSearch: hasWebSearchTool(ctx), // optional — knowledge fallback only
    };
    return capabilities;
}

export function getCapabilities() {
    return capabilities ?? detectCapabilities();
}

/** One human-readable line for the settings panel. */
export function compatSummary(caps = getCapabilities()) {
    const missing = Object.keys(CORE_FEATURES).filter(key => !caps[key]).map(key => CORE_FEATURES[key]);
    const core = missing.length
        ? `Missing on this SillyTavern: ${missing.join(', ')}.`
        : 'All features available.';
    const web = caps.webSearch
        ? ''
        : ' WebSearch tool not detected — install the Web Search extension for the knowledge fallback.';
    return core + web;
}
