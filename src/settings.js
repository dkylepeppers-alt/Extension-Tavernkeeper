export const MODULE = 'tavernkeeper_workshop';

const defaults = Object.freeze({
    enabled: true,
    autoMode: false,
    enableTools: true,
    heuristics: true,
    enableQrSetsOnApply: true,
    maxBlockKb: 256,
});

export function getSettings() {
    const { extensionSettings } = SillyTavern.getContext();
    if (!extensionSettings[MODULE]) {
        extensionSettings[MODULE] = structuredClone(defaults);
    }
    for (const key of Object.keys(defaults)) {
        if (extensionSettings[MODULE][key] === undefined) {
            extensionSettings[MODULE][key] = structuredClone(defaults[key]);
        }
    }
    return extensionSettings[MODULE];
}

export function saveSettings() {
    SillyTavern.getContext().saveSettingsDebounced();
}
