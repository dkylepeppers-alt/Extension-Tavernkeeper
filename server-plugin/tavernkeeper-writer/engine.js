import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const MARKER = '.tavernkeeper-managed.json';
const REGISTRY = 'registry.json';
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TRANSACTION_BYTES = 1024 * 1024;
const SNAPSHOT_LIMIT = 10;
const ALLOWED_EXTENSIONS = new Set(['.js', '.mjs', '.css', '.html', '.json', '.md', '.txt', '.svg']);
const JS_WARNING = 'JavaScript syntax and runtime safety cannot be proven by the writer; inspect executable code carefully.';

export class WriterError extends Error {
    constructor(code, message, status = 400) {
        super(message);
        this.name = 'WriterError';
        this.code = code;
        this.status = status;
    }
}

function fail(code, message, status) {
    throw new WriterError(code, message, status);
}

function assertSlug(slug) {
    if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) {
        fail('INVALID_SLUG', 'Slug must be 2-63 lowercase letters, numbers, or hyphens');
    }
}

function normalizeFilePath(value) {
    if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\') || path.isAbsolute(value)) {
        fail('INVALID_PATH', `Invalid project-relative path: ${String(value)}`);
    }
    const normalized = path.posix.normalize(value);
    const parts = normalized.split('/');
    if (normalized !== value || normalized === '..' || normalized.startsWith('../') || parts.some(part => !part || part.startsWith('.'))) {
        fail('INVALID_PATH', `Invalid project-relative path: ${value}`);
    }
    if (!ALLOWED_EXTENSIONS.has(path.posix.extname(normalized).toLowerCase())) {
        fail('UNSUPPORTED_FILE', `Unsupported text file type: ${value}`);
    }
    return normalized;
}

function assertContent(content, filePath) {
    if (typeof content !== 'string' || content.includes('\0')) fail('INVALID_CONTENT', `${filePath} must contain text`);
    const bytes = Buffer.byteLength(content);
    if (bytes > MAX_FILE_BYTES) fail('FILE_TOO_LARGE', `${filePath} exceeds ${MAX_FILE_BYTES} bytes`);
    return bytes;
}

function assertCaseUnique(paths) {
    const seen = new Map();
    for (const filePath of paths) {
        const folded = filePath.toLocaleLowerCase('en-US');
        if (seen.has(folded) && seen.get(folded) !== filePath) {
            fail('PATH_COLLISION', `Case-colliding paths: ${seen.get(folded)} and ${filePath}`);
        }
        seen.set(folded, filePath);
    }
}

function validateManifest(files, displayName) {
    const raw = files.get('manifest.json');
    if (raw === undefined) fail('INVALID_MANIFEST', 'manifest.json is required');
    let manifest;
    try {
        manifest = JSON.parse(raw);
    } catch (error) {
        fail('INVALID_MANIFEST', `manifest.json is invalid JSON: ${error.message}`);
    }
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || typeof manifest.display_name !== 'string' || typeof manifest.js !== 'string') {
        fail('INVALID_MANIFEST', 'manifest.json requires string display_name and js fields');
    }
    if (displayName && manifest.display_name !== displayName) fail('INVALID_MANIFEST', 'displayName must match manifest.json display_name');
    for (const field of ['js', 'css']) {
        if (manifest[field] === undefined) continue;
        const entry = normalizeFilePath(manifest[field]);
        if (!files.has(entry)) fail('MISSING_ENTRYPOINT', `manifest.json ${field} entry does not exist: ${entry}`);
    }
    return manifest;
}

async function exists(target) {
    try { await fs.access(target); return true; } catch { return false; }
}

async function readJson(target, fallback) {
    try { return JSON.parse(await fs.readFile(target, 'utf8')); } catch (error) {
        if (error.code === 'ENOENT') return fallback;
        fail('CORRUPT_STATE', `Cannot read ${path.basename(target)}: ${error.message}`, 500);
    }
}

async function writeJsonAtomic(target, value) {
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.tmp-${crypto.randomUUID()}`;
    await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    await fs.rename(temp, target);
}

async function scanFiles(root, { includeMarker = false } = {}) {
    const files = new Map();
    async function walk(directory, prefix = '') {
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
            const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
            const absolute = path.join(directory, entry.name);
            const stat = await fs.lstat(absolute);
            if (stat.isSymbolicLink()) fail('SYMLINK_FORBIDDEN', `Managed projects may not contain symlinks: ${relative}`);
            if (stat.isDirectory()) {
                if (entry.name.startsWith('.')) fail('INVALID_PATH', `Hidden project directory is forbidden: ${relative}`);
                await walk(absolute, relative);
            } else if (stat.isFile()) {
                if (relative === MARKER && !includeMarker) continue;
                if (relative !== MARKER) normalizeFilePath(relative);
                const buffer = await fs.readFile(absolute);
                let content;
                try {
                    content = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
                } catch {
                    fail('INVALID_CONTENT', `${relative} is not valid UTF-8 text`);
                }
                if (relative !== MARKER) assertContent(content, relative);
                files.set(relative, content);
            } else {
                fail('UNSUPPORTED_FILE', `Unsupported filesystem entry: ${relative}`);
            }
        }
    }
    await walk(root);
    assertCaseUnique(files.keys());
    return files;
}

async function writeFiles(root, files) {
    for (const [relative, content] of files) {
        const absolute = path.join(root, ...relative.split('/'));
        await fs.mkdir(path.dirname(absolute), { recursive: true });
        await fs.writeFile(absolute, content, { flag: 'wx' });
    }
}

function publicChanges(changes) {
    return changes.map(change => ({ ...change }));
}

function hashFiles(files) {
    const hash = crypto.createHash('sha256');
    for (const [filePath, content] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
        hash.update(filePath).update('\0').update(content).update('\0');
    }
    return hash.digest('hex');
}

export function createWriter({ extensionsRoot, stateRoot, tokenTtlMs = 5 * 60_000, now = () => Date.now(), registryWriter = null }) {
    if (!path.isAbsolute(extensionsRoot) || !path.isAbsolute(stateRoot)) throw new TypeError('Writer roots must be absolute paths');
    const registryPath = path.join(stateRoot, REGISTRY);
    const snapshotsRoot = path.join(stateRoot, 'snapshots');
    const validations = new Map();
    const locks = new Set();
    const persistRegistry = (value) => registryWriter
        ? registryWriter(registryPath, value, writeJsonAtomic)
        : writeJsonAtomic(registryPath, value);

    async function loadRegistry() {
        const registry = await readJson(registryPath, { version: 1, projects: {} });
        if (registry.version !== 1 || !registry.projects || typeof registry.projects !== 'object') fail('CORRUPT_STATE', 'Invalid writer registry', 500);
        return registry;
    }

    async function projectRecord(projectId, slug) {
        assertSlug(slug);
        const registry = await loadRegistry();
        const record = registry.projects[projectId];
        if (!record || record.slug !== slug) fail('NOT_MANAGED', `No managed project ${slug}`, 404);
        const projectRoot = path.join(extensionsRoot, slug);
        const marker = await readJson(path.join(projectRoot, MARKER), null);
        if (!marker || marker.projectId !== projectId || marker.slug !== slug || marker.revision !== record.revision) {
            fail('OWNERSHIP_MISMATCH', `Managed ownership marker mismatch for ${slug}`, 409);
        }
        return { registry, record, projectRoot, marker };
    }

    function issueValidation(kind, action, changes, warnings = []) {
        const validationToken = crypto.randomUUID();
        validations.set(validationToken, { kind, action, expiresAt: now() + tokenTtlMs });
        return { kind, validationToken, expiresAt: now() + tokenTtlMs, changes: publicChanges(changes), warnings };
    }

    async function validateCreate(input) {
        assertSlug(input?.slug);
        if (typeof input.displayName !== 'string' || !input.displayName.trim()) fail('INVALID_REQUEST', 'displayName is required');
        if (!input.files || typeof input.files !== 'object' || Array.isArray(input.files)) fail('INVALID_REQUEST', 'files must be an object');
        if (await exists(path.join(extensionsRoot, input.slug))) fail('PROJECT_EXISTS', `Extension folder already exists: ${input.slug}`, 409);
        const files = new Map();
        let bytes = 0;
        for (const [rawPath, content] of Object.entries(input.files)) {
            const filePath = normalizeFilePath(rawPath);
            if (files.has(filePath)) fail('PATH_COLLISION', `Duplicate path: ${filePath}`);
            bytes += assertContent(content, filePath);
            files.set(filePath, content);
        }
        if (!files.size) fail('INVALID_REQUEST', 'At least one file is required');
        if (bytes > MAX_TRANSACTION_BYTES) fail('TRANSACTION_TOO_LARGE', 'Transaction exceeds size limit');
        assertCaseUnique(files.keys());
        const manifest = validateManifest(files, input.displayName);
        const projectId = crypto.randomUUID();
        const action = { slug: input.slug, displayName: input.displayName, files, manifest, projectId };
        const changes = [...files].map(([filePath, content]) => ({ op: 'add', path: filePath, before: null, after: content }));
        const result = issueValidation('create', action, changes, changes.some(change => /\.m?js$/i.test(change.path)) ? [JS_WARNING] : []);
        return { ...result, slug: input.slug, displayName: input.displayName };
    }

    async function validateAdopt(input) {
        assertSlug(input?.slug);
        const projectRoot = path.join(extensionsRoot, input.slug);
        if (!await exists(projectRoot)) fail('PROJECT_NOT_FOUND', `Extension folder does not exist: ${input.slug}`, 404);
        if (await exists(path.join(projectRoot, MARKER))) fail('ALREADY_MANAGED', `${input.slug} already has a managed ownership marker`, 409);
        const registry = await loadRegistry();
        if (Object.values(registry.projects).some(record => record.slug === input.slug)) fail('ALREADY_MANAGED', `${input.slug} is already registered`, 409);
        const files = await scanFiles(projectRoot);
        const manifest = validateManifest(files);
        const projectId = crypto.randomUUID();
        const action = {
            slug: input.slug,
            displayName: manifest.display_name,
            files,
            manifest,
            projectId,
            sourceDigest: hashFiles(files),
        };
        const result = issueValidation('adopt', action, [{ op: 'adopt', path: input.slug, before: 'unmanaged', after: 'Tavernkeeper-managed' }], [JS_WARNING]);
        return { ...result, slug: input.slug, displayName: manifest.display_name };
    }

    async function validatePatch(input) {
        const { registry, record, projectRoot } = await projectRecord(input?.projectId, input?.slug);
        if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== record.revision) fail('STALE_REVISION', `Expected revision ${record.revision}`, 409);
        if (!Array.isArray(input.operations) || !input.operations.length) fail('INVALID_REQUEST', 'operations must be non-empty');
        const files = await scanFiles(projectRoot);
        const changes = [];
        let bytes = 0;
        for (const operation of input.operations) {
            const op = operation?.op;
            const filePath = normalizeFilePath(operation?.path);
            if (op === 'add') {
                if (files.has(filePath)) fail('FILE_EXISTS', `File already exists: ${filePath}`);
                bytes += assertContent(operation.content, filePath);
                files.set(filePath, operation.content);
                changes.push({ op, path: filePath, before: null, after: operation.content });
            } else if (op === 'replace') {
                if (!files.has(filePath)) fail('FILE_NOT_FOUND', `File does not exist: ${filePath}`);
                bytes += assertContent(operation.content, filePath);
                const before = files.get(filePath);
                files.set(filePath, operation.content);
                changes.push({ op, path: filePath, before, after: operation.content });
            } else if (op === 'delete') {
                if (!files.has(filePath)) fail('FILE_NOT_FOUND', `File does not exist: ${filePath}`);
                const before = files.get(filePath);
                files.delete(filePath);
                changes.push({ op, path: filePath, before, after: null });
            } else if (op === 'rename') {
                const destination = normalizeFilePath(operation.to);
                if (!files.has(filePath)) fail('FILE_NOT_FOUND', `File does not exist: ${filePath}`);
                if (files.has(destination)) fail('FILE_EXISTS', `File already exists: ${destination}`);
                const content = files.get(filePath);
                files.delete(filePath);
                files.set(destination, content);
                changes.push({ op, path: filePath, to: destination, before: content, after: content });
            } else {
                fail('INVALID_OPERATION', `Unsupported operation: ${String(op)}`);
            }
        }
        if (bytes > MAX_TRANSACTION_BYTES) fail('TRANSACTION_TOO_LARGE', 'Transaction exceeds size limit');
        assertCaseUnique(files.keys());
        const manifest = validateManifest(files);
        const sourceDigest = hashFiles(await scanFiles(projectRoot));
        return {
            ...issueValidation('patch', { projectId: input.projectId, slug: input.slug, expectedRevision: input.expectedRevision, files, manifest, registry, sourceDigest }, changes, changes.some(change => /\.m?js$/i.test(change.path) || /\.m?js$/i.test(change.to ?? '')) ? [JS_WARNING] : []),
            projectId: input.projectId,
            slug: input.slug,
            expectedRevision: input.expectedRevision,
        };
    }

    async function validateRollback(input) {
        const { record, projectRoot } = await projectRecord(input?.projectId, input?.slug);
        if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== record.revision) fail('STALE_REVISION', `Expected revision ${record.revision}`, 409);
        if (!Number.isInteger(input.targetRevision) || input.targetRevision < 1) fail('INVALID_REQUEST', 'targetRevision must be a positive integer');
        const snapshotRoot = path.join(snapshotsRoot, input.projectId, String(input.targetRevision));
        if (!await exists(snapshotRoot)) fail('REVISION_NOT_FOUND', `Snapshot revision ${input.targetRevision} not found`, 404);
        const files = await scanFiles(snapshotRoot);
        validateManifest(files);
        return {
            ...issueValidation('rollback', { projectId: input.projectId, slug: input.slug, expectedRevision: input.expectedRevision, targetRevision: input.targetRevision, files, sourceDigest: hashFiles(await scanFiles(projectRoot)) }, [
                { op: 'rollback', path: input.slug, before: String(input.expectedRevision), after: String(input.targetRevision) },
            ], [JS_WARNING]),
            projectId: input.projectId,
            slug: input.slug,
            expectedRevision: input.expectedRevision,
            targetRevision: input.targetRevision,
        };
    }

    async function saveSnapshot(projectId, revision, projectRoot) {
        const destination = path.join(snapshotsRoot, projectId, String(revision));
        if (!await exists(destination)) {
            await fs.mkdir(path.dirname(destination), { recursive: true });
            await fs.cp(projectRoot, destination, { recursive: true, errorOnExist: true, force: false });
        }
        const revisions = (await fs.readdir(path.dirname(destination), { withFileTypes: true }))
            .filter(entry => entry.isDirectory() && /^\d+$/.test(entry.name))
            .map(entry => Number(entry.name)).sort((a, b) => b - a);
        for (const old of revisions.slice(SNAPSHOT_LIMIT)) await fs.rm(path.join(path.dirname(destination), String(old)), { recursive: true, force: true });
    }

    async function swapProject(projectRoot, stagingRoot) {
        const previousRoot = `${projectRoot}.previous-${crypto.randomUUID()}`;
        await fs.rename(projectRoot, previousRoot);
        try {
            await fs.rename(stagingRoot, projectRoot);
            return previousRoot;
        } catch (error) {
            if (await exists(projectRoot)) await fs.rm(projectRoot, { recursive: true, force: true });
            await fs.rename(previousRoot, projectRoot);
            throw error;
        }
    }

    async function applyValidated(input) {
        if (!input || Object.keys(input).length !== 1 || typeof input.validationToken !== 'string') fail('VALIDATION_MISMATCH', 'Apply accepts only the issued validationToken');
        const pending = validations.get(input.validationToken);
        if (!pending || pending.expiresAt < now()) fail('VALIDATION_EXPIRED', 'Validation token is missing or expired', 409);
        validations.delete(input.validationToken);
        const lockKey = pending.action.projectId ?? pending.action.slug;
        if (locks.has(lockKey)) fail('PROJECT_LOCKED', 'Project is already being updated', 409);
        locks.add(lockKey);
        try {
            await fs.mkdir(extensionsRoot, { recursive: true });
            await fs.mkdir(stateRoot, { recursive: true });
            if (pending.kind === 'create') {
                const action = pending.action;
                if (await exists(path.join(extensionsRoot, action.slug))) fail('PROJECT_EXISTS', `Extension folder already exists: ${action.slug}`, 409);
                const registry = await loadRegistry();
                const revision = 1;
                const stagingRoot = path.join(extensionsRoot, `.tkw-stage-${crypto.randomUUID()}`);
                await fs.mkdir(stagingRoot);
                try {
                    await writeFiles(stagingRoot, action.files);
                    await fs.writeFile(path.join(stagingRoot, MARKER), JSON.stringify({ projectId: action.projectId, slug: action.slug, revision }, null, 2) + '\n');
                    await fs.rename(stagingRoot, path.join(extensionsRoot, action.slug));
                } catch (error) {
                    await fs.rm(stagingRoot, { recursive: true, force: true });
                    throw error;
                }
                registry.projects[action.projectId] = { slug: action.slug, displayName: action.displayName, revision, updatedAt: new Date(now()).toISOString() };
                try {
                    await persistRegistry(registry);
                } catch (error) {
                    await fs.rm(path.join(extensionsRoot, action.slug), { recursive: true, force: true });
                    throw error;
                }
                return { ok: true, kind: pending.kind, projectId: action.projectId, slug: action.slug, revision, reloadRequired: true };
            }

            if (pending.kind === 'adopt') {
                const action = pending.action;
                const projectRoot = path.join(extensionsRoot, action.slug);
                if (!await exists(projectRoot) || await exists(path.join(projectRoot, MARKER))) fail('VALIDATION_MISMATCH', 'Extension changed since adoption review', 409);
                const currentFiles = await scanFiles(projectRoot);
                if (hashFiles(currentFiles) !== action.sourceDigest) fail('VALIDATION_MISMATCH', 'Extension changed since adoption review', 409);
                const registry = await loadRegistry();
                if (Object.values(registry.projects).some(record => record.slug === action.slug)) fail('ALREADY_MANAGED', `${action.slug} is already registered`, 409);
                const revision = 1;
                const stagingRoot = path.join(extensionsRoot, `.tkw-stage-${crypto.randomUUID()}`);
                await fs.mkdir(stagingRoot);
                try {
                    await writeFiles(stagingRoot, currentFiles);
                    await fs.writeFile(path.join(stagingRoot, MARKER), JSON.stringify({ projectId: action.projectId, slug: action.slug, revision }, null, 2) + '\n');
                    var previousRoot = await swapProject(projectRoot, stagingRoot);
                } catch (error) {
                    await fs.rm(stagingRoot, { recursive: true, force: true });
                    throw error;
                }
                registry.projects[action.projectId] = { slug: action.slug, displayName: action.displayName, revision, updatedAt: new Date(now()).toISOString() };
                try {
                    await persistRegistry(registry);
                    await fs.rm(previousRoot, { recursive: true, force: true });
                } catch (error) {
                    await fs.rm(projectRoot, { recursive: true, force: true });
                    await fs.rename(previousRoot, projectRoot);
                    throw error;
                }
                return { ok: true, kind: pending.kind, projectId: action.projectId, slug: action.slug, revision, reloadRequired: true };
            }

            const action = pending.action;
            const { registry, record, projectRoot } = await projectRecord(action.projectId, action.slug);
            if (record.revision !== action.expectedRevision) fail('STALE_REVISION', `Expected revision ${record.revision}`, 409);
            if (hashFiles(await scanFiles(projectRoot)) !== action.sourceDigest) fail('VALIDATION_MISMATCH', 'Project files changed since review', 409);
            await saveSnapshot(action.projectId, record.revision, projectRoot);
            const nextRevision = record.revision + 1;
            const stagingRoot = path.join(extensionsRoot, `.tkw-stage-${crypto.randomUUID()}`);
            await fs.mkdir(stagingRoot);
            try {
                await writeFiles(stagingRoot, action.files);
                await fs.writeFile(path.join(stagingRoot, MARKER), JSON.stringify({ projectId: action.projectId, slug: action.slug, revision: nextRevision }, null, 2) + '\n');
                var previousRoot = await swapProject(projectRoot, stagingRoot);
            } catch (error) {
                await fs.rm(stagingRoot, { recursive: true, force: true });
                throw error;
            }
            record.revision = nextRevision;
            record.updatedAt = new Date(now()).toISOString();
            try {
                await persistRegistry(registry);
                await fs.rm(previousRoot, { recursive: true, force: true });
            } catch (error) {
                await fs.rm(projectRoot, { recursive: true, force: true });
                await fs.rename(previousRoot, projectRoot);
                throw error;
            }
            return { ok: true, kind: pending.kind, projectId: action.projectId, slug: action.slug, revision: nextRevision, reloadRequired: true };
        } finally {
            locks.delete(lockKey);
        }
    }

    async function listProjects() {
        const registry = await loadRegistry();
        const projects = [];
        for (const [projectId, record] of Object.entries(registry.projects)) {
            try {
                await projectRecord(projectId, record.slug);
                projects.push({ projectId, ...record });
            } catch (error) {
                if (!(error instanceof WriterError)) throw error;
                projects.push({ projectId, ...record, invalid: error.message });
            }
        }
        return projects.sort((a, b) => a.slug.localeCompare(b.slug));
    }

    async function getProject({ projectId, slug }) {
        const { record, projectRoot } = await projectRecord(projectId, slug);
        const files = await scanFiles(projectRoot);
        return { projectId, ...record, files: Object.fromEntries(files) };
    }

    async function getRevision({ projectId, slug, revision }) {
        await projectRecord(projectId, slug);
        if (!Number.isInteger(revision) || revision < 1) fail('INVALID_REQUEST', 'revision must be a positive integer');
        const snapshotRoot = path.join(snapshotsRoot, projectId, String(revision));
        if (!await exists(snapshotRoot)) fail('REVISION_NOT_FOUND', `Snapshot revision ${revision} not found`, 404);
        return { projectId, slug, revision, files: Object.fromEntries(await scanFiles(snapshotRoot)) };
    }

    return { validateCreate, validateAdopt, validatePatch, validateRollback, applyValidated, listProjects, getProject, getRevision };
}
