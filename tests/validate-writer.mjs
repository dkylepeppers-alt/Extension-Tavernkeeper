import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWriter, WriterError } from '../server-plugin/tavernkeeper-writer/engine.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tkw-writer-'));
const extensionsRoot = path.join(root, 'extensions');
const stateRoot = path.join(root, 'state');
await fs.mkdir(extensionsRoot, { recursive: true });
const writer = createWriter({ extensionsRoot, stateRoot, tokenTtlMs: 60_000 });

const manifest = JSON.stringify({
    display_name: 'Tiny Clock',
    loading_order: 100,
    js: 'index.js',
    author: 'test',
    version: '1.0.0',
});

async function rejectsCode(fn, code) {
    await assert.rejects(fn, error => error instanceof WriterError && error.code === code);
}

try {
    await rejectsCode(() => writer.validateCreate({
        slug: 'bad-entry', displayName: 'Bad Entry',
        files: { 'manifest.json': JSON.stringify({ display_name: 'Bad Entry', js: 'missing.js' }) },
    }), 'MISSING_ENTRYPOINT');
    await rejectsCode(() => writer.validateCreate({
        slug: 'case-clash', displayName: 'Case Clash',
        files: {
            'manifest.json': JSON.stringify({ display_name: 'Case Clash', js: 'Index.js' }),
            'Index.js': 'one', 'index.js': 'two',
        },
    }), 'PATH_COLLISION');
    await rejectsCode(() => writer.validateCreate({
        slug: 'too-large', displayName: 'Too Large',
        files: {
            'manifest.json': JSON.stringify({ display_name: 'Too Large', js: 'index.js' }),
            'index.js': 'x'.repeat(256 * 1024 + 1),
        },
    }), 'FILE_TOO_LARGE');

    const create = await writer.validateCreate({
        slug: 'tiny-clock',
        displayName: 'Tiny Clock',
        files: { 'manifest.json': manifest, 'index.js': 'globalThis.tinyClock = true;\n' },
    });
    assert.equal(create.kind, 'create');
    assert.equal(create.changes.length, 2);
    assert.ok(create.warnings.some(warning => /JavaScript syntax/i.test(warning)));
    assert.ok(create.validationToken);

    await rejectsCode(
        () => writer.applyValidated({ ...create, validationToken: create.validationToken, slug: '../escape' }),
        'VALIDATION_MISMATCH',
    );

    const created = await writer.applyValidated({ validationToken: create.validationToken });
    assert.equal(created.revision, 1);
    assert.match(created.projectId, /^[0-9a-f-]{36}$/);
    assert.equal(await fs.readFile(path.join(extensionsRoot, 'tiny-clock', 'index.js'), 'utf8'), 'globalThis.tinyClock = true;\n');

    const projects = await writer.listProjects();
    assert.equal(projects.length, 1);
    assert.equal(projects[0].slug, 'tiny-clock');
    assert.equal(projects[0].revision, 1);

    const project = await writer.getProject({ projectId: created.projectId, slug: 'tiny-clock' });
    assert.equal(project.files['manifest.json'], manifest);
    assert.equal(project.files['index.js'], 'globalThis.tinyClock = true;\n');
    assert.equal(project.files['.tavernkeeper-managed.json'], undefined);

    for (const badPath of ['../outside.js', '/tmp/outside.js', 'nested/../../outside.js', '.tavernkeeper-managed.json']) {
        await rejectsCode(() => writer.validatePatch({
            projectId: created.projectId,
            slug: 'tiny-clock',
            expectedRevision: 1,
            operations: [{ op: 'add', path: badPath, content: 'bad' }],
        }), 'INVALID_PATH');
    }

    await fs.symlink('/tmp', path.join(extensionsRoot, 'tiny-clock', 'linked'));
    await rejectsCode(() => writer.validatePatch({
        projectId: created.projectId,
        slug: 'tiny-clock',
        expectedRevision: 1,
        operations: [{ op: 'add', path: 'linked/escape.js', content: 'bad' }],
    }), 'SYMLINK_FORBIDDEN');
    await fs.rm(path.join(extensionsRoot, 'tiny-clock', 'linked'));

    const tampered = await writer.validatePatch({
        projectId: created.projectId,
        slug: 'tiny-clock',
        expectedRevision: 1,
        operations: [{ op: 'replace', path: 'index.js', content: 'reviewed-content' }],
    });
    await fs.writeFile(path.join(extensionsRoot, 'tiny-clock', 'index.js'), 'changed-after-review');
    await rejectsCode(() => writer.applyValidated({ validationToken: tampered.validationToken }), 'VALIDATION_MISMATCH');
    await fs.writeFile(path.join(extensionsRoot, 'tiny-clock', 'index.js'), 'globalThis.tinyClock = true;\n');

    const patch = await writer.validatePatch({
        projectId: created.projectId,
        slug: 'tiny-clock',
        expectedRevision: 1,
        operations: [
            { op: 'replace', path: 'index.js', content: 'globalThis.tinyClock = "updated";\n' },
            { op: 'add', path: 'style.css', content: '.tiny-clock { display: block; }\n' },
            { op: 'rename', path: 'style.css', to: 'clock.css' },
            { op: 'delete', path: 'clock.css' },
        ],
    });
    assert.deepEqual(patch.changes.map(change => change.op), ['replace', 'add', 'rename', 'delete']);
    const updated = await writer.applyValidated({ validationToken: patch.validationToken });
    assert.equal(updated.revision, 2);
    assert.equal(await fs.readFile(path.join(extensionsRoot, 'tiny-clock', 'index.js'), 'utf8'), 'globalThis.tinyClock = "updated";\n');
    await assert.rejects(fs.access(path.join(extensionsRoot, 'tiny-clock', 'clock.css')));

    await rejectsCode(() => writer.validatePatch({
        projectId: created.projectId,
        slug: 'tiny-clock',
        expectedRevision: 1,
        operations: [{ op: 'replace', path: 'index.js', content: 'stale' }],
    }), 'STALE_REVISION');

    const rollback = await writer.validateRollback({
        projectId: created.projectId,
        slug: 'tiny-clock',
        expectedRevision: 2,
        targetRevision: 1,
    });
    assert.equal(rollback.changes[0].op, 'rollback');
    const restored = await writer.applyValidated({ validationToken: rollback.validationToken });
    assert.equal(restored.revision, 3);
    assert.equal(await fs.readFile(path.join(extensionsRoot, 'tiny-clock', 'index.js'), 'utf8'), 'globalThis.tinyClock = true;\n');

    await fs.writeFile(path.join(extensionsRoot, 'tiny-clock', '.tavernkeeper-managed.json'), '{"projectId":"spoof"}');
    await rejectsCode(() => writer.getProject({ projectId: created.projectId, slug: 'tiny-clock' }), 'OWNERSHIP_MISMATCH');

    const invalidRoot = path.join(root, 'other-user-extensions');
    await fs.mkdir(invalidRoot);
    const otherWriter = createWriter({ extensionsRoot: invalidRoot, stateRoot: path.join(root, 'other-state') });
    assert.deepEqual(await otherWriter.listProjects(), []);

    const adoptedRoot = path.join(extensionsRoot, 'existing-widget');
    await fs.mkdir(adoptedRoot);
    await fs.writeFile(path.join(adoptedRoot, 'manifest.json'), JSON.stringify({ display_name: 'Existing Widget', js: 'index.js' }));
    await fs.writeFile(path.join(adoptedRoot, 'index.js'), 'console.log("existing")');
    const adoption = await writer.validateAdopt({ slug: 'existing-widget' });
    assert.equal(adoption.kind, 'adopt');
    assert.equal(adoption.changes[0].op, 'adopt');
    const adopted = await writer.applyValidated({ validationToken: adoption.validationToken });
    assert.equal(adopted.revision, 1);
    assert.equal((await writer.getProject({ projectId: adopted.projectId, slug: 'existing-widget' })).displayName, 'Existing Widget');

    const binaryRoot = path.join(extensionsRoot, 'binary-widget');
    await fs.mkdir(binaryRoot);
    await fs.writeFile(path.join(binaryRoot, 'manifest.json'), JSON.stringify({ display_name: 'Binary Widget', js: 'index.js' }));
    await fs.writeFile(path.join(binaryRoot, 'index.js'), Buffer.from([0xff, 0xfe, 0xfd]));
    await rejectsCode(() => writer.validateAdopt({ slug: 'binary-widget' }), 'INVALID_CONTENT');

    const failureRoot = path.join(root, 'failure-extensions');
    const failureState = path.join(root, 'failure-state');
    await fs.mkdir(failureRoot);
    let registryWrites = 0;
    const failureWriter = createWriter({
        extensionsRoot: failureRoot,
        stateRoot: failureState,
        registryWriter: async (target, value, fallback) => {
            registryWrites++;
            if (registryWrites === 2) throw new Error('injected registry failure');
            await fallback(target, value);
        },
    });
    const failureCreate = await failureWriter.validateCreate({
        slug: 'atomic-test', displayName: 'Atomic Test',
        files: { 'manifest.json': JSON.stringify({ display_name: 'Atomic Test', js: 'index.js' }), 'index.js': 'before' },
    });
    const failureProject = await failureWriter.applyValidated({ validationToken: failureCreate.validationToken });
    const failurePatch = await failureWriter.validatePatch({
        projectId: failureProject.projectId, slug: 'atomic-test', expectedRevision: 1,
        operations: [{ op: 'replace', path: 'index.js', content: 'after' }],
    });
    await assert.rejects(() => failureWriter.applyValidated({ validationToken: failurePatch.validationToken }), /injected registry failure/);
    assert.equal(await fs.readFile(path.join(failureRoot, 'atomic-test', 'index.js'), 'utf8'), 'before', 'failed transaction restores original folder');
    assert.equal((await failureWriter.getProject({ projectId: failureProject.projectId, slug: 'atomic-test' })).revision, 1);
    let expectedRevision = 1;
    for (let index = 0; index < 12; index++) {
        const next = await failureWriter.validatePatch({
            projectId: failureProject.projectId, slug: 'atomic-test', expectedRevision,
            operations: [{ op: 'replace', path: 'index.js', content: `revision-${expectedRevision + 1}` }],
        });
        const result = await failureWriter.applyValidated({ validationToken: next.validationToken });
        expectedRevision = result.revision;
    }
    const retained = (await fs.readdir(path.join(failureState, 'snapshots', failureProject.projectId)))
        .filter(name => /^\d+$/.test(name)).map(Number).sort((a, b) => a - b);
    assert.equal(retained.length, 10);
    assert.deepEqual(retained, [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

    let fakeNow = 1000;
    const expiryRoot = path.join(root, 'expiry-extensions');
    await fs.mkdir(expiryRoot);
    const expiryWriter = createWriter({ extensionsRoot: expiryRoot, stateRoot: path.join(root, 'expiry-state'), tokenTtlMs: 5, now: () => fakeNow });
    const expiring = await expiryWriter.validateCreate({
        slug: 'expiry-test', displayName: 'Expiry Test',
        files: { 'manifest.json': JSON.stringify({ display_name: 'Expiry Test', js: 'index.js' }), 'index.js': 'text' },
    });
    fakeNow += 6;
    await rejectsCode(() => expiryWriter.applyValidated({ validationToken: expiring.validationToken }), 'VALIDATION_EXPIRED');

    console.log('Managed extension writer validation passed');
} finally {
    await fs.rm(root, { recursive: true, force: true });
}
