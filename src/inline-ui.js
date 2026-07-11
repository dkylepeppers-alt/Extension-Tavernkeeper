import { getSettings } from './settings.js';
import { extractDeliverables, TYPE_INFO } from './protocol.js';
import { apply } from './appliers.js';

const STATE_KEY = 'tk_workshop';

function escapeHtml(text) {
    return String(text ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

function getState(message) {
    return message?.extra?.[STATE_KEY] ?? {};
}

async function setState(message, hash, state) {
    const ctx = SillyTavern.getContext();
    if (!message.extra) message.extra = {};
    if (!message.extra[STATE_KEY]) message.extra[STATE_KEY] = {};
    if (state === null) delete message.extra[STATE_KEY][hash];
    else message.extra[STATE_KEY][hash] = state;
    await ctx.saveChat();
}

function renderActionCard(mesId, item, state) {
    const info = TYPE_INFO[item.type] ?? { icon: 'fa-cube', label: item.type };
    const head = `<b>${escapeHtml(info.label)}</b><span class="tkw-name">${escapeHtml(item.name)}</span><small class="tkw-summary">${escapeHtml(item.summary)}</small>`;
    let statusClass = 'tkw-pending';
    let icon = info.icon;
    let body = '';
    let buttons = '';

    if (item.invalid) {
        statusClass = 'tkw-invalid';
        icon = 'fa-triangle-exclamation';
        body = `<div class="tkw-note">${escapeHtml(item.invalid)}</div>`;
    } else if (!state) {
        buttons = `
            <div class="menu_button tkw-apply interactable" title="Apply this deliverable">
                <i class="fa-solid fa-check"></i><span>Apply</span>
            </div>
            <div class="menu_button tkw-dismiss interactable" title="Dismiss without applying">
                <i class="fa-solid fa-xmark"></i><span>Dismiss</span>
            </div>`;
    } else if (state.status === 'applied') {
        statusClass = 'tkw-applied';
        icon = 'fa-circle-check';
        body = `<div class="tkw-note">${escapeHtml(state.note ?? 'Applied')}</div>`;
    } else if (state.status === 'failed') {
        statusClass = 'tkw-failed';
        icon = 'fa-triangle-exclamation';
        body = `<div class="tkw-note">${escapeHtml(state.note ?? 'Failed')}</div>`;
        buttons = `
            <div class="menu_button tkw-apply interactable" title="Retry">
                <i class="fa-solid fa-rotate-right"></i><span>Retry</span>
            </div>
            <div class="menu_button tkw-dismiss interactable" title="Dismiss">
                <i class="fa-solid fa-xmark"></i><span>Dismiss</span>
            </div>`;
    } else if (state.status === 'dismissed') {
        statusClass = 'tkw-dismissed';
        body = `<div class="tkw-note">Dismissed · <a class="tkw-reoffer">offer again</a></div>`;
    }

    return `
        <div class="tkw-action ${statusClass}" data-hash="${item.hash}" data-mesid="${mesId}" data-type="${escapeHtml(item.type)}">
            <i class="fa-solid ${icon} tkw-icon"></i>
            <div class="tkw-info">${head}${body}</div>
            <div class="tkw-buttons">${buttons}</div>
        </div>`;
}

export function decorateMessage(mesId) {
    const ctx = SillyTavern.getContext();
    const settings = getSettings();
    const message = ctx.chat?.[mesId];
    if (!settings.enabled || !message || message.is_user || message.is_system || !message.mes) return;

    const $mes = $(`#chat .mes[mesid="${mesId}"]`);
    if (!$mes.length) return;
    const codeBlocks = $mes.find('.mes_text pre > code');
    if (!codeBlocks.length) return;

    const state = getState(message);
    for (const item of extractDeliverables(message.mes)) {
        const codeEl = codeBlocks.get(item.blockIndex);
        if (!codeEl) continue;
        const pre = codeEl.closest('pre');
        const existing = pre.parentElement.querySelector(`.tkw-action[data-hash="${item.hash}"]`);
        // All interpolations are escaped in renderActionCard; DOMPurify pass is defense-in-depth.
        const html = DOMPurify.sanitize(renderActionCard(mesId, item, state[item.hash]));
        if (existing) existing.outerHTML = html;
        else pre.insertAdjacentHTML('afterend', html);
    }
    // Remove cards whose block no longer exists in the text (message edited).
    const validHashes = new Set(extractDeliverables(message.mes).map(i => i.hash));
    $mes.find('.tkw-action').each(function () {
        if (!validHashes.has(this.dataset.hash)) this.remove();
    });
}

export function decorateAllMessages() {
    const ctx = SillyTavern.getContext();
    (ctx.chat ?? []).forEach((_, index) => decorateMessage(index));
}

function findItem(mesId, hash) {
    const ctx = SillyTavern.getContext();
    const message = ctx.chat?.[mesId];
    if (!message) return { message: null, item: null };
    const item = extractDeliverables(message.mes).find(i => i.hash === hash) ?? null;
    return { message, item };
}

export async function applyByHash(mesId, hash, { silent = false } = {}) {
    const { message, item } = findItem(mesId, hash);
    if (!message || !item) {
        if (!silent) toastr.error('Deliverable no longer present in the message', "Tavernkeeper's Workshop");
        return { ok: false, message: 'Deliverable not found' };
    }
    const result = await apply(item);
    await setState(message, hash, { status: result.ok ? 'applied' : 'failed', note: result.message, ts: Date.now() });
    decorateMessage(mesId);
    if (!silent) {
        result.ok
            ? toastr.success(result.message, "Tavernkeeper's Workshop")
            : toastr.error(result.message, "Tavernkeeper's Workshop");
    }
    return result;
}

/**
 * Apply every pending (un-stated, valid) deliverable in a message.
 * includeScripts is only true for explicit user actions (/workshop-apply).
 */
export async function applyAllInMessage(mesId, { includeScripts = false } = {}) {
    const ctx = SillyTavern.getContext();
    const message = ctx.chat?.[mesId];
    if (!message) return { applied: 0, failed: 0, skipped: 0 };
    const state = getState(message);
    const results = { applied: 0, failed: 0, skipped: 0 };
    for (const item of extractDeliverables(message.mes)) {
        if (item.invalid || state[item.hash]) { results.skipped++; continue; }
        if (item.type === 'script' && !includeScripts) { results.skipped++; continue; }
        const result = await applyByHash(mesId, item.hash);
        result.ok ? results.applied++ : results.failed++;
    }
    return results;
}

async function maybeAutoApply(mesId) {
    const settings = getSettings();
    if (!settings.enabled || !settings.autoMode) return;
    const results = await applyAllInMessage(mesId, { includeScripts: false });
    if (results.skipped && !results.applied && !results.failed) return;
    const ctx = SillyTavern.getContext();
    const message = ctx.chat?.[mesId];
    const hasPendingScript = message && extractDeliverables(message.mes)
        .some(i => i.type === 'script' && !i.invalid && !getState(message)[i.hash]);
    if (hasPendingScript) {
        toastr.info('An STscript deliverable is waiting — scripts always need a manual Apply', "Tavernkeeper's Workshop");
    }
}

function onActionClick(event) {
    const card = event.target.closest('.tkw-action');
    if (!card) return;
    const mesId = Number(card.dataset.mesid);
    const hash = card.dataset.hash;

    if (event.target.closest('.tkw-apply')) {
        const button = event.target.closest('.tkw-apply');
        button.classList.add('disabled');
        button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        applyByHash(mesId, hash);
    } else if (event.target.closest('.tkw-dismiss')) {
        const ctx = SillyTavern.getContext();
        const message = ctx.chat?.[mesId];
        if (message) setState(message, hash, { status: 'dismissed', ts: Date.now() }).then(() => decorateMessage(mesId));
    } else if (event.target.closest('.tkw-reoffer')) {
        const ctx = SillyTavern.getContext();
        const message = ctx.chat?.[mesId];
        if (message) setState(message, hash, null).then(() => decorateMessage(mesId));
    }
}

export function initInlineUi() {
    const ctx = SillyTavern.getContext();
    const { eventSource, eventTypes } = ctx;

    eventSource.on(eventTypes.CHARACTER_MESSAGE_RENDERED, (mesId) => {
        decorateMessage(mesId);
        maybeAutoApply(mesId);
    });
    eventSource.on(eventTypes.CHAT_CHANGED, () => queueMicrotask(decorateAllMessages));
    eventSource.on(eventTypes.MORE_MESSAGES_LOADED, () => queueMicrotask(decorateAllMessages));
    eventSource.on(eventTypes.MESSAGE_EDITED, (mesId) => queueMicrotask(() => decorateMessage(Number(mesId))));
    eventSource.on(eventTypes.MESSAGE_SWIPED, (mesId) => queueMicrotask(() => decorateMessage(Number(mesId))));
    eventSource.on(eventTypes.MESSAGE_UPDATED, (mesId) => queueMicrotask(() => decorateMessage(Number(mesId))));

    $(document).on('click', '.tkw-action', onActionClick);

    // Decorate whatever is already on screen (init happens after first CHAT_CHANGED).
    decorateAllMessages();
}
