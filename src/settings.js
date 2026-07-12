export const MODULE = 'tavernkeeper_workshop';
const SETTINGS_VERSION = 1;

const defaults = Object.freeze({
    enabled: true,
    autoMode: false,
    enableTools: true,
    enableQrSetsOnApply: true,
    maxBlockKb: 256,
    injectProtocol: true,
    lastKnowledgeVersion: 0,
    settingsVersion: SETTINGS_VERSION,
});

// MIGRATIONS[n] upgrades a settings object from schema version n to n + 1.
const MIGRATIONS = [
    (settings) => {
        // 0 → 1 (Workshop 3.0): heuristics removed; the synced knowledge
        // lorebook retired — a previous sync earns a one-time notice.
        delete settings.heuristics;
        if (settings.knowledgeVersion > 0) settings.legacyBookNotice = true;
        delete settings.knowledgeVersion;
    },
];

export function getSettings() {
    const ctx = SillyTavern.getContext();
    const { extensionSettings } = ctx;
    if (!extensionSettings[MODULE]) {
        extensionSettings[MODULE] = structuredClone(defaults);
    }
    const settings = extensionSettings[MODULE];
    let version = settings.settingsVersion ?? 0;
    if (version < SETTINGS_VERSION) {
        while (version < SETTINGS_VERSION) MIGRATIONS[version++]?.(settings);
        settings.settingsVersion = SETTINGS_VERSION;
        ctx.saveSettingsDebounced();
    }
    for (const key of Object.keys(defaults)) {
        if (settings[key] === undefined) {
            settings[key] = structuredClone(defaults[key]);
        }
    }
    return settings;
}

export function saveSettings() {
    SillyTavern.getContext().saveSettingsDebounced();
}
