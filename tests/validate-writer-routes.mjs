import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { init, info } from '../server-plugin/tavernkeeper-writer/index.js';

const routes = new Map();
const router = {
    get(route, handler) { routes.set(`GET ${route}`, handler); },
    post(route, handler) { routes.set(`POST ${route}`, handler); },
};
await init(router);
assert.equal(info.id, 'tavernkeeper-writer');
for (const route of ['/health', '/projects', '/project', '/revision', '/validate/create', '/validate/adopt', '/validate/patch', '/validate/rollback', '/apply']) {
    const method = route === '/health' ? 'GET' : 'POST';
    assert.ok(routes.has(`${method} ${route}`), `missing ${method} ${route}`);
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tkw-routes-'));
const directories = { root, extensions: path.join(root, 'extensions') };
await fs.mkdir(directories.extensions, { recursive: true });

async function invoke(method, route, body = {}, withUser = true, userDirectories = directories) {
    let status = 200;
    let payload;
    const req = { body, user: withUser ? { directories: userDirectories, profile: { handle: 'tester' } } : undefined };
    const res = {
        status(value) { status = value; return this; },
        json(value) { payload = value; return this; },
    };
    await routes.get(`${method} ${route}`)(req, res);
    return { status, payload };
}

try {
    assert.deepEqual((await invoke('GET', '/health')).payload, { ok: true, id: 'tavernkeeper-writer', version: 1 });
    assert.equal((await invoke('POST', '/projects', {}, false)).status, 401);
    const validation = await invoke('POST', '/validate/create', {
        slug: 'route-test',
        displayName: 'Route Test',
        files: {
            'manifest.json': JSON.stringify({ display_name: 'Route Test', js: 'index.js' }),
            'index.js': 'console.log("route")',
        },
    });
    assert.equal(validation.status, 200);
    assert.ok(validation.payload.validationToken);
    const applied = await invoke('POST', '/apply', { validationToken: validation.payload.validationToken });
    assert.equal(applied.payload.revision, 1);
    const listed = await invoke('POST', '/projects');
    assert.equal(listed.payload.projects[0].slug, 'route-test');
    const invalid = await invoke('POST', '/validate/patch', { projectId: applied.payload.projectId, slug: 'route-test', expectedRevision: 0, operations: [] });
    assert.equal(invalid.status, 409);
    assert.equal(invalid.payload.error.code, 'STALE_REVISION');

    const relativeRoot = await fs.mkdtemp(path.join(process.cwd(), '.tkw-relative-routes-'));
    const relativeDirectories = {
        root: path.relative(process.cwd(), relativeRoot),
        extensions: path.relative(process.cwd(), path.join(relativeRoot, 'extensions')),
    };
    await fs.mkdir(path.join(relativeRoot, 'extensions'));
    const relativeList = await invoke('POST', '/projects', {}, true, relativeDirectories);
    assert.equal(relativeList.status, 200);
    assert.deepEqual(relativeList.payload, { projects: [] });
    await fs.rm(relativeRoot, { recursive: true, force: true });
    console.log('Managed extension writer routes passed');
} finally {
    await fs.rm(root, { recursive: true, force: true });
}
