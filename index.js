import { getSettings, saveSettings } from './src/settings.js';
import { initAppliers } from './src/appliers.js';
import { initInlineUi, applyAllInMessage, decorateAllMessages } from './src/inline-ui.js';
import { registerWorkshopTools, initToolQueueClicks, showToolQueuePopup } from './src/tools.js';
import { syncKnowledgeBook, updateProtocolInjection } from './src/knowledge.js';

const EXTENSION_FOLDER = 'third-party/Extension-Tavernkeeper';
const LOG_PREFIX = "[Tavernkeeper's Workshop]";

function lastAiMessageId() {
    const ctx = SillyTavern.getContext();
    for (let i = (ctx.chat?.length ?? 0) - 1; i >= 0; i--) {
        if (!ctx.chat[i].is_user && !ctx.chat[i].is_system) return i;
    }
    return -1;
}

function setAutoMode(value) {
    const settings = getSettings();
    settings.autoMode = !!value;
    saveSettings();
    updateProtocolInjection();
    $('#tkw_auto').prop('checked', settings.autoMode);
    $('#tkw_menu_auto i').attr('class', `fa-solid ${settings.autoMode ? 'fa-toggle-on' : 'fa-toggle-off'}`);
    toastr.info(`Workshop mode: ${settings.autoMode ? 'AUTO — deliverables apply as they arrive' : 'PLAN — deliverables wait for your Apply'}`, "Tavernkeeper's Workshop");
    return settings.autoMode ? 'auto' : 'plan';
}

async function loadSettingsHtml() {
    const ctx = SillyTavern.getContext();
    try {
        if (typeof ctx.renderExtensionTemplateAsync === 'function') {
            return await ctx.renderExtensionTemplateAsync(EXTENSION_FOLDER, 'settings');
        }
    } catch (error) {
        console.warn(`${LOG_PREFIX} renderExtensionTemplateAsync failed, falling back to fetch`, error);
    }
    const response = await fetch(`/scripts/extensions/${EXTENSION_FOLDER}/settings.html`);
    return response.ok ? await response.text() : '';
}

async function mountSettingsPanel() {
    const html = await loadSettingsHtml();
    if (!html) {
        console.error(`${LOG_PREFIX} could not load settings.html`);
        return;
    }
    $('#extensions_settings2').append(html);
    const settings = getSettings();

    const bindCheckbox = (selector, key, onChange) => {
        $(selector).prop('checked', settings[key]).on('change', function () {
            settings[key] = this.checked;
            saveSettings();
            onChange?.(this.checked);
        });
    };
    bindCheckbox('#tkw_enabled', 'enabled', () => { decorateAllMessages(); updateProtocolInjection(); });
    bindCheckbox('#tkw_auto', 'autoMode', (checked) => setAutoMode(checked));
    bindCheckbox('#tkw_tools', 'enableTools');
    bindCheckbox('#tkw_heuristics', 'heuristics', () => decorateAllMessages());
    bindCheckbox('#tkw_qr_enable', 'enableQrSetsOnApply');
    bindCheckbox('#tkw_inject', 'injectProtocol', () => updateProtocolInjection());
    $('#tkw_max_kb').val(settings.maxBlockKb).on('input', function () {
        const value = Number(this.value);
        if (Number.isFinite(value) && value >= 1) {
            settings.maxBlockKb = value;
            saveSettings();
        }
    });
}

function mountWandMenu() {
    const settings = getSettings();
    const html = `
        <div id="tkw_menu_auto" class="list-group-item flex-container flexGap5 interactable" title="Toggle Workshop plan/auto mode">
            <i class="fa-solid ${settings.autoMode ? 'fa-toggle-on' : 'fa-toggle-off'}"></i>
            <span>Workshop: auto-apply</span>
        </div>
        <div id="tkw_menu_apply" class="list-group-item flex-container flexGap5 interactable" title="Apply all pending deliverables in the last AI message">
            <i class="fa-solid fa-hammer"></i>
            <span>Workshop: apply last message</span>
        </div>`;
    $('#extensionsMenu').append(DOMPurify.sanitize(html));
    $('#tkw_menu_auto').on('click', () => setAutoMode(!getSettings().autoMode));
    $('#tkw_menu_apply').on('click', async () => {
        const mesId = lastAiMessageId();
        if (mesId < 0) return toastr.warning('No AI message in this chat', "Tavernkeeper's Workshop");
        const results = await applyAllInMessage(mesId, { includeScripts: true });
        toastr.info(`Applied ${results.applied}, failed ${results.failed}, skipped ${results.skipped}`, "Tavernkeeper's Workshop");
    });
}

function registerSlashCommands() {
    const ctx = SillyTavern.getContext();
    const { SlashCommandParser, SlashCommand, SlashCommandArgument, ARGUMENT_TYPE } = ctx;
    if (!SlashCommandParser || !SlashCommand) {
        console.warn(`${LOG_PREFIX} slash command API unavailable; skipping command registration`);
        return;
    }

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'workshop-mode',
        returns: 'the active mode (plan or auto)',
        callback: (_named, mode) => {
            const settings = getSettings();
            const value = String(mode ?? '').trim().toLowerCase();
            if (value === 'auto') return setAutoMode(true);
            if (value === 'plan') return setAutoMode(false);
            if (value === 'toggle') return setAutoMode(!settings.autoMode);
            return settings.autoMode ? 'auto' : 'plan';
        },
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'plan | auto | toggle (empty = report current mode)',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: false,
                enumList: ['plan', 'auto', 'toggle'],
            }),
        ],
        helpString: '<div>Get or set the Tavernkeeper\'s Workshop mode. <code>/workshop-mode auto</code>, <code>/workshop-mode plan</code>, <code>/workshop-mode toggle</code>, or bare to read.</div>',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'workshop-apply',
        returns: 'summary of applied deliverables',
        callback: async (_named, mesIdArg) => {
            const raw = String(mesIdArg ?? '').trim();
            const mesId = raw === '' ? lastAiMessageId() : Number(raw);
            const ctx2 = SillyTavern.getContext();
            if (!Number.isInteger(mesId) || mesId < 0 || !ctx2.chat?.[mesId]) return 'No such message';
            const results = await applyAllInMessage(mesId, { includeScripts: true });
            return `applied ${results.applied}, failed ${results.failed}, skipped ${results.skipped}`;
        },
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'message id (empty = last AI message)',
                typeList: [ARGUMENT_TYPE.NUMBER],
                isRequired: false,
            }),
        ],
        helpString: '<div>Apply every pending Workshop deliverable in a message (including STscript blocks). <code>/workshop-apply</code> targets the last AI message.</div>',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'workshop-queue',
        returns: 'nothing',
        callback: async () => {
            await showToolQueuePopup();
            return '';
        },
        helpString: '<div>Open the pending function-tool deliverables popup.</div>',
    }));
}

async function init() {
    await initAppliers();
    await mountSettingsPanel();
    mountWandMenu();
    registerSlashCommands();
    initInlineUi();
    initToolQueueClicks();
    registerWorkshopTools();
    updateProtocolInjection();
    await syncKnowledgeBook();
    console.log(`${LOG_PREFIX} ready`);
}

const ctx = SillyTavern.getContext();
ctx.eventSource.on(ctx.eventTypes.APP_READY, init);
