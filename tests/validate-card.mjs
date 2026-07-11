import assert from 'node:assert/strict';
import fs from 'node:fs';

const cardPath = new URL('../cards/Tavernkeeper.chara_card_v2.json', import.meta.url);
const pngPath = new URL('../cards/Tavernkeeper.png', import.meta.url);
const promptPath = new URL('../cards/AVATAR_PROMPT.md', import.meta.url);
const readmePath = new URL('../README.md', import.meta.url);
const card = JSON.parse(fs.readFileSync(cardPath, 'utf8'));

assert.equal(card.spec, 'chara_card_v2');
assert.equal(card.spec_version, '2.0');

const { data } = card;
for (const field of [
    'name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example',
    'creator_notes', 'system_prompt', 'post_history_instructions', 'character_version',
]) {
    assert.equal(typeof data[field], 'string', `${field} must be a string`);
}
assert.equal(data.name, 'Tavernkeeper');
assert.equal(data.character_version, '1.1');
assert.ok(data.creator_notes.includes('https://github.com/dkylepeppers-alt/Extension-Tavernkeeper'));
assert.ok(data.creator_notes.includes('plan mode'));
assert.ok(data.creator_notes.includes('auto mode'));
assert.ok(data.creator_notes.includes('jsonc'));
assert.ok(Array.isArray(data.alternate_greetings));
assert.equal(data.alternate_greetings.length, 3);
assert.ok(data.alternate_greetings.some(greeting => greeting.includes('/workshop-mode')));
assert.ok(data.mes_example.includes('```st-wi-entry'));
assert.ok(data.mes_example.includes('"book":'));
assert.ok(data.mes_example.includes('```st-script'));
assert.ok(Array.isArray(data.tags));
assert.ok(data.extensions && !Array.isArray(data.extensions) && typeof data.extensions === 'object');
assert.equal(data.extensions.world, 'Tavernkeeper Knowledge');
assert.notEqual(data.character_book, null);

const book = data.character_book;
assert.equal(book.token_budget, 2800);
assert.equal(book.recursive_scanning, false);
assert.equal(book.entries.length, 25);
assert.deepEqual(book.entries.map(entry => entry.id), Array.from({ length: 25 }, (_, i) => i));
for (const entry of book.entries) {
    assert.ok(Array.isArray(entry.keys), `entry ${entry.id} keys must be an array`);
    assert.equal(typeof entry.content, 'string', `entry ${entry.id} content must be a string`);
    assert.ok(entry.extensions && !Array.isArray(entry.extensions) && typeof entry.extensions === 'object', `entry ${entry.id} extensions must be an object`);
    assert.equal(entry.enabled, true, `entry ${entry.id} must be enabled`);
    assert.equal(typeof entry.insertion_order, 'number', `entry ${entry.id} insertion_order must be numeric`);
}

const protocol = book.entries[23];
assert.equal(protocol.comment, 'Workshop deliverable protocol (tagged fences)');
for (const tag of ['st-card', 'st-lorebook', 'st-wi-entry', 'st-qrset', 'st-regex', 'st-script']) {
    assert.ok(protocol.content.includes(tag), `protocol must document ${tag}`);
}
assert.ok(protocol.content.includes('jsonc'));
assert.ok(!protocol.content.includes('plain json fence for drafts'));

const operations = book.entries[24];
assert.equal(operations.comment, 'Workshop installation, modes & operation');
assert.equal(operations.constant, false);
assert.equal(operations.enabled, true);
assert.equal(operations.extensions.prevent_recursion, true);
for (const command of ['/workshop-mode', '/workshop-apply', '/workshop-queue']) {
    assert.ok(operations.content.includes(command), `operations must document ${command}`);
}
assert.ok(operations.content.includes('https://github.com/dkylepeppers-alt/Extension-Tavernkeeper'));
assert.ok(operations.content.includes('STscript'));
assert.ok(operations.content.includes('undo'));
assert.ok(operations.content.includes('jsonc'));

const prompt = fs.readFileSync(promptPath, 'utf8');
assert.ok(prompt.includes('Use case: stylized-concept'));
assert.ok(prompt.includes('No weapons'));
assert.ok(prompt.includes('No other people'));

const readme = fs.readFileSync(readmePath, 'utf8');
assert.ok(readme.includes('## Companion card'));
assert.ok(readme.includes('cards/Tavernkeeper.png'));
assert.ok(readme.includes('cards/Tavernkeeper.chara_card_v2.json'));
assert.ok(readme.includes('node tests/validate-card.mjs'));

const png = fs.readFileSync(pngPath);
assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
assert.equal(png.readUInt32BE(16), 1024);
assert.equal(png.readUInt32BE(20), 1536);

const textChunks = new Map();
for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');
    const chunk = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'tEXt') {
        const separator = chunk.indexOf(0);
        if (separator !== -1) {
            textChunks.set(chunk.subarray(0, separator).toString('latin1'), chunk.subarray(separator + 1).toString('latin1'));
        }
    }
    offset += 12 + length;
}

assert.ok(textChunks.has('chara'), 'PNG must contain a chara text chunk');
assert.ok(textChunks.has('ccv3'), 'PNG must contain a ccv3 text chunk');
const embeddedV2 = JSON.parse(Buffer.from(textChunks.get('chara'), 'base64').toString('utf8'));
const embeddedV3 = JSON.parse(Buffer.from(textChunks.get('ccv3'), 'base64').toString('utf8'));
assert.equal(embeddedV2.spec, 'chara_card_v2');
assert.equal(embeddedV2.spec_version, '2.0');
assert.deepEqual(embeddedV2.data, card.data);
assert.equal(embeddedV3.spec, 'chara_card_v3');
assert.equal(embeddedV3.spec_version, '3.0');
for (const field of ['name', 'character_version', 'creator_notes', 'description', 'mes_example', 'alternate_greetings', 'character_book', 'extensions']) {
    assert.deepEqual(embeddedV3.data[field], card.data[field], `V3 PNG data mismatch: ${field}`);
}

console.log('Tavernkeeper card validation passed');
