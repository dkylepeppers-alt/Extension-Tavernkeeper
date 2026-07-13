import assert from 'node:assert/strict';
import fs from 'node:fs';

const cardPath = new URL('../cards/Chronicler.chara_card_v2.json', import.meta.url);
const pngPath = new URL('../cards/Chronicler.png', import.meta.url);
const promptPath = new URL('../cards/CHRONICLER_AVATAR_PROMPT.md', import.meta.url);
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
assert.equal(data.name, 'Chronicler');
assert.equal(data.character_version, '1.0');
assert.ok(data.creator_notes.includes('https://github.com/dkylepeppers-alt/Extension-Tavernkeeper'));
assert.ok(data.creator_notes.includes('Tavernkeeper'), 'creator_notes must explain the pairing with Tavernkeeper');
assert.ok(data.creator_notes.includes('placeholder'), 'creator_notes must disclose the placeholder avatar');
assert.ok(data.creator_notes.includes('CHRONICLER_AVATAR_PROMPT.md'), 'creator_notes must point to the avatar prompt');
assert.ok(data.creator_notes.includes('workshop_search_knowledge'), 'creator_notes must explain the read tools');
assert.ok(/prose/i.test(data.description), 'the persona must commit to plain prose');
assert.ok(data.description.includes('workshop_get_character'), 'the persona must read existing cards for continuity');
assert.ok(data.description.includes('workshop_get_lorebook'), 'the persona must read existing books for continuity');
assert.ok(data.description.includes('workshop_search_knowledge'), 'the persona must consult the knowledge tool');
assert.equal(data.system_prompt, '', 'system_prompt stays empty to preserve user presets');
assert.equal(data.post_history_instructions, '', 'post_history_instructions stays empty to preserve user presets');
assert.ok(Array.isArray(data.alternate_greetings));
assert.equal(data.alternate_greetings.length, 2);
assert.ok(data.alternate_greetings.some(greeting => greeting.includes('Tavernkeeper')), 'a greeting must set up the group-chat handoff');
assert.ok(data.mes_example.includes('```text'), 'examples must deliver prose in inert text fences');
assert.ok(!data.mes_example.includes('"book":'), 'examples must not emit structured lorebook JSON');
assert.ok(!JSON.stringify(card).includes('```st-'), 'the card must never emit appliable st-* fences');
assert.ok(Array.isArray(data.tags));
assert.ok(data.extensions && !Array.isArray(data.extensions) && typeof data.extensions === 'object');
assert.equal(data.extensions.world, undefined, 'the card must not link a world file');
assert.equal(data.character_book, undefined, 'the card must NOT embed a book');
assert.ok(data.extensions.depth_prompt?.prompt.includes('prose'), 'depth prompt must reinforce prose-only output');
assert.ok(data.extensions.depth_prompt?.prompt.includes('Tavernkeeper'), 'depth prompt must defer structure to Tavernkeeper');
assert.equal(data.extensions.depth_prompt?.role, 'system');

// --- Bundled assets ---

const prompt = fs.readFileSync(promptPath, 'utf8');
assert.ok(prompt.includes('Use case: stylized-concept'));
assert.ok(prompt.includes('No weapons'));
assert.ok(prompt.includes('No other people'));
assert.ok(prompt.includes('placeholder'), 'avatar prompt must explain the bundled PNG is a placeholder');

const readme = fs.readFileSync(readmePath, 'utf8');
assert.ok(readme.includes('cards/Chronicler.png'));
assert.ok(readme.includes('cards/Chronicler.chara_card_v2.json'));
assert.ok(readme.includes('cards/CHRONICLER_AVATAR_PROMPT.md'));
assert.ok(readme.includes('node tests/validate-chronicler-card.mjs'));

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

console.log('Chronicler card validation passed');
