import assert from 'node:assert/strict';

globalThis.SillyTavern = {
    getContext: () => ({ getRequestHeaders: () => ({ 'X-CSRF-Token': 'test-token' }) }),
};

const calls = [];
globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/health')) return { ok: true, json: async () => ({ ok: true }) };
    if (url.endsWith('/projects')) return { ok: true, json: async () => ({ projects: [{ slug: 'tiny' }] }) };
    if (url.endsWith('/validate/create')) return { ok: true, json: async () => ({ validationToken: 'token', changes: [] }) };
    if (url.endsWith('/apply')) return { ok: true, json: async () => ({ ok: true, revision: 1, reloadRequired: true }) };
    return { ok: false, status: 409, json: async () => ({ error: { code: 'STALE_REVISION', message: 'Expected revision 2' } }) };
};

const {
    probeWriter,
    listManagedProjects,
    validateManagedItem,
    applyValidationToken,
    WriterClientError,
} = await import('../src/writer-client.js');

assert.equal(await probeWriter(), true);
assert.deepEqual(await listManagedProjects(), [{ slug: 'tiny' }]);
const validation = await validateManagedItem({ type: 'extension-create', data: { slug: 'tiny', files: {} } });
assert.equal(validation.validationToken, 'token');
assert.equal((await applyValidationToken('token')).revision, 1);
const applyCall = calls.find(call => call.url.endsWith('/apply'));
assert.equal(JSON.parse(applyCall.options.body).validationToken, 'token');
await assert.rejects(
    () => validateManagedItem({ type: 'extension-patch', data: {} }),
    error => error instanceof WriterClientError && error.code === 'STALE_REVISION' && error.status === 409,
);
assert.equal(calls[0].options.method, 'GET');
assert.equal(calls[1].options.headers['Content-Type'], 'application/json');
console.log('Managed extension writer client passed');
