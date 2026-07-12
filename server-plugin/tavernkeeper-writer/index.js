import path from 'node:path';
import { createWriter, WriterError } from './engine.js';

export const info = {
    id: 'tavernkeeper-writer',
    name: 'Tavernkeeper Managed Extension Writer',
    description: 'Safely creates and updates user-owned SillyTavern UI extension folders after explicit review.',
};

const writers = new Map();

function writerFor(request) {
    const directories = request.user?.directories;
    if (!directories?.root || !directories?.extensions) {
        throw new WriterError('UNAUTHENTICATED', 'An authenticated SillyTavern user is required', 401);
    }
    const extensionsRoot = path.resolve(directories.extensions);
    const stateRoot = path.resolve(directories.root, 'tavernkeeper-writer');
    const key = `${extensionsRoot}\0${stateRoot}`;
    if (!writers.has(key)) writers.set(key, createWriter({ extensionsRoot, stateRoot }));
    return writers.get(key);
}

function route(handler) {
    return async (request, response) => {
        try {
            const result = await handler(writerFor(request), request.body ?? {}, request);
            return response.json(result);
        } catch (error) {
            if (error instanceof WriterError) {
                return response.status(error.status).json({ error: { code: error.code, message: error.message } });
            }
            console.error('[Tavernkeeper Writer] request failed', error);
            return response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Managed extension writer failed' } });
        }
    };
}

export async function init(router) {
    router.get('/health', (_request, response) => response.json({ ok: true, id: info.id, version: 1 }));
    router.post('/projects', route(writer => writer.listProjects().then(projects => ({ projects }))));
    router.post('/project', route((writer, body) => writer.getProject(body)));
    router.post('/revision', route((writer, body) => writer.getRevision(body)));
    router.post('/validate/create', route((writer, body) => writer.validateCreate(body)));
    router.post('/validate/adopt', route((writer, body) => writer.validateAdopt(body)));
    router.post('/validate/patch', route((writer, body) => writer.validatePatch(body)));
    router.post('/validate/rollback', route((writer, body) => writer.validateRollback(body)));
    router.post('/apply', route((writer, body) => writer.applyValidated(body)));
}

export async function exit() {
    writers.clear();
}
