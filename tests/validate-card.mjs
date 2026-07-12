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
assert.equal(data.character_version, '3.0');
assert.ok(data.creator_notes.includes('https://github.com/dkylepeppers-alt/Extension-Tavernkeeper'));
assert.ok(data.creator_notes.includes('plan mode'));
assert.ok(data.creator_notes.includes('auto mode'));
assert.ok(data.creator_notes.includes('jsonc'));
assert.ok(data.creator_notes.includes('workshop_search_knowledge'), 'creator_notes must explain the knowledge tool');
assert.ok(/Web Search/i.test(data.creator_notes), 'creator_notes must recommend the Web Search extension');
assert.ok(!/heuristic/i.test(JSON.stringify(card)), 'heuristic detection was removed — the card must not mention it');
assert.ok(data.description.includes('workshop_search_knowledge'), 'the persona must consult the knowledge tool');
assert.ok(Array.isArray(data.alternate_greetings));
assert.equal(data.alternate_greetings.length, 3);
assert.ok(data.alternate_greetings.some(greeting => greeting.includes('/workshop-mode')));
assert.ok(data.mes_example.includes('```st-wi-entry'));
assert.ok(data.mes_example.includes('"book":'));
assert.ok(data.mes_example.includes('```st-script'));
assert.ok(Array.isArray(data.tags));
assert.ok(data.extensions && !Array.isArray(data.extensions) && typeof data.extensions === 'object');
assert.equal(data.extensions.world, undefined, 'the world link is retired — knowledge is served by the extension');
assert.equal(data.character_book, undefined, 'the card must NOT embed a book — knowledge is served by the extension');
assert.ok(data.extensions.depth_prompt?.prompt.includes('workshop_search_knowledge'), 'depth prompt must steer to the knowledge tool');

// --- Bundled assets ---

const prompt = fs.readFileSync(promptPath, 'utf8');
assert.ok(prompt.includes('Use case: stylized-concept'));
assert.ok(prompt.includes('No weapons'));
assert.ok(prompt.includes('No other people'));

const readme = fs.readFileSync(readmePath, 'utf8');
assert.ok(readme.includes('## Companion card'));
assert.ok(readme.includes('cards/Tavernkeeper.png'));
assert.ok(readme.includes('cards/Tavernkeeper.chara_card_v2.json'));
assert.ok(readme.includes('node tests/validate-card.mjs'));
assert.ok(readme.includes('workshop_search_knowledge'), 'README must document the knowledge tool');

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
for (const field of ['name', 'character_version', 'creator_notes', 'description', 'mes_example', 'alternate_greetings', 'extensions']) {
    assert.deepEqual(embeddedV3.data[field], card.data[field], `V3 PNG data mismatch: ${field}`);
}
assert.equal(embeddedV3.data.character_book, undefined, 'V3 PNG must not embed a book');

console.log('Tavernkeeper card validation passed');
