const BASE = '/api/plugins/tavernkeeper-writer';

export class WriterClientError extends Error {
    constructor(code, message, status) {
        super(message);
        this.name = 'WriterClientError';
        this.code = code;
        this.status = status;
    }
}

async function request(route, body, { method = 'POST' } = {}) {
    const ctx = SillyTavern.getContext();
    const headers = method === 'GET'
        ? ctx.getRequestHeaders()
        : { ...ctx.getRequestHeaders(), 'Content-Type': 'application/json' };
    const response = await fetch(`${BASE}${route}`, {
        method,
        headers,
        cache: 'no-cache',
        ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
    });
    let payload;
    try { payload = await response.json(); } catch { payload = {}; }
    if (!response.ok) {
        const error = payload?.error ?? {};
        throw new WriterClientError(error.code ?? 'WRITER_UNAVAILABLE', error.message ?? `Writer request failed (HTTP ${response.status})`, response.status);
    }
    return payload;
}

export async function probeWriter() {
    try {
        const result = await request('/health', undefined, { method: 'GET' });
        return result?.ok === true;
    } catch {
        return false;
    }
}

export async function listManagedProjects() {
    return (await request('/projects', {})).projects ?? [];
}

export async function getManagedProject(params) {
    return await request('/project', params);
}

export async function getManagedRevision(params) {
    return await request('/revision', params);
}

const VALIDATION_ROUTES = {
    'extension-create': '/validate/create',
    'extension-adopt': '/validate/adopt',
    'extension-patch': '/validate/patch',
    'extension-rollback': '/validate/rollback',
};

export async function validateManagedItem(item) {
    const route = VALIDATION_ROUTES[item?.type];
    if (!route) throw new WriterClientError('INVALID_ITEM', `Unsupported managed extension item: ${item?.type}`, 400);
    return await request(route, item.data);
}

export async function applyValidationToken(validationToken) {
    return await request('/apply', { validationToken });
}
