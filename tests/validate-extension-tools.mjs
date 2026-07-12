import assert from 'node:assert/strict';
import { TOOL_DEFS } from '../src/tools.js';

const byName = new Map(TOOL_DEFS.map(tool => [tool.name, tool]));
for (const name of [
    'workshop_list_extension_projects',
    'workshop_get_extension_project',
    'workshop_get_extension_revision',
    'workshop_create_extension',
    'workshop_adopt_extension',
    'workshop_patch_extension',
    'workshop_rollback_extension',
]) assert.ok(byName.has(name), `missing ${name}`);

assert.equal(byName.get('workshop_list_extension_projects').readOnly, true);
assert.equal(byName.get('workshop_create_extension').toItem({ slug: 'tiny', displayName: 'Tiny', files: { 'manifest.json': '{}' } }).type, 'extension-create');
assert.equal(byName.get('workshop_patch_extension').schema.properties.operations.items.properties.op.enum.join(','), 'add,replace,rename,delete');
assert.equal(byName.get('workshop_rollback_extension').toItem({ projectId: 'id', slug: 'tiny', expectedRevision: 2, targetRevision: 1 }).type, 'extension-rollback');
console.log('Managed extension function tools passed');
