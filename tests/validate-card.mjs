import assert from 'node:assert/strict';
import fs from 'node:fs';

const cardPath = new URL('../cards/Tavernkeeper.chara_card_v2.json', import.meta.url);
const pngPath = new URL('../cards/Tavernkeeper.png', import.meta.url);
const promptPath = new URL('../cards/AVATAR_PROMPT.md', import.meta.url);
const readmePath = new URL('../README.md', import.meta.url);
const knowledgePath = new URL('../knowledge/tavernkeeper-knowledge.json', import.meta.url);
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
assert.equal(data.character_version, '2.0');
assert.ok(data.creator_notes.includes('https://github.com/dkylepeppers-alt/Extension-Tavernkeeper'));
assert.ok(data.creator_notes.includes('plan mode'));
assert.ok(data.creator_notes.includes('auto mode'));
assert.ok(data.creator_notes.includes('jsonc'));
assert.ok(data.creator_notes.includes('Tavernkeeper Knowledge'), 'creator_notes must explain the extension-managed knowledge book');
assert.ok(Array.isArray(data.alternate_greetings));
assert.equal(data.alternate_greetings.length, 3);
assert.ok(data.alternate_greetings.some(greeting => greeting.includes('/workshop-mode')));
assert.ok(data.mes_example.includes('```st-wi-entry'));
assert.ok(data.mes_example.includes('"book":'));
assert.ok(data.mes_example.includes('```st-script'));
assert.ok(Array.isArray(data.tags));
assert.ok(data.extensions && !Array.isArray(data.extensions) && typeof data.extensions === 'object');
assert.equal(data.extensions.world, 'Tavernkeeper Knowledge');
assert.equal(data.character_book, undefined, 'the card must NOT embed a book — the extension syncs the world file');

// --- Knowledge book (extension-managed source of truth) ---

const knowledge = JSON.parse(fs.readFileSync(knowledgePath, 'utf8'));
assert.ok(Number.isInteger(knowledge.version) && knowledge.version >= 1, 'knowledge version must be a positive integer');
assert.equal(knowledge.name, 'Tavernkeeper Knowledge');
assert.ok(knowledge.entries && !Array.isArray(knowledge.entries), 'entries must be an object keyed by uid');

// Native WI entry fields the sync template can fill; anything else is a typo.
const ALLOWED_ENTRY_FIELDS = new Set([
    'uid', 'displayIndex',
    'key', 'keysecondary', 'content', 'comment', 'constant', 'selective', 'selectiveLogic',
    'addMemo', 'order', 'position', 'depth', 'role', 'disable', 'probability', 'useProbability',
    'group', 'groupOverride', 'groupWeight', 'useGroupScoring', 'preventRecursion',
    'excludeRecursion', 'delayUntilRecursion', 'sticky', 'cooldown', 'delay',
    'scanDepth', 'caseSensitive', 'matchWholeWords', 'automationId', 'vectorized', 'ignoreBudget',
    'outletName', 'triggers', 'matchPersonaDescription', 'matchCharacterDescription',
    'matchCharacterPersonality', 'matchCharacterDepthPrompt', 'matchScenario', 'matchCreatorNotes',
]);

const entries = Object.entries(knowledge.entries);
assert.ok(entries.length >= 20, 'knowledge book lost entries');
for (const [id, entry] of entries) {
    assert.equal(String(entry.uid), id, `entry ${id} uid must match its key`);
    assert.ok(Array.isArray(entry.key), `entry ${id} key must be an array`);
    assert.equal(typeof entry.content, 'string', `entry ${id} content must be a string`);
    assert.ok(entry.comment, `entry ${id} needs a comment (UI title)`);
    assert.equal(typeof entry.order, 'number', `entry ${id} order must be numeric`);
    for (const field of Object.keys(entry)) {
        assert.ok(ALLOWED_ENTRY_FIELDS.has(field), `entry ${id} has unknown field "${field}"`);
    }
    assert.ok(!entry.content.includes('```st-'), `entry ${id} must not embed the fence protocol (the extension injects it)`);
}

const contents = entries.map(([, entry]) => entry.content);
const mustCover = [
    ['Macros 2.0 conditionals', '\\{\\{if condition\\}\\}'],
    ['variable shorthand', '$name'],
    ['keyed variable macros', 'getvarkey'],
    ['macro registration', 'macros.register('],
    ['deprecated registerMacro warning', 'deprecated'],
    ['reasoning storage', 'mes.extra.reasoning'],
    ['reasoning regex placement', 'placement 6'],
    ['WI match sources', 'matchPersonaDescription'],
    ['WI outlets', 'outletName'],
    ['embedded book inertness', 'INERT'],
    ['read tools', 'workshop_list_lorebooks'],
];
for (const [label, needle] of mustCover) {
    assert.ok(contents.some(content => content.includes(needle)), `knowledge must cover ${label} (missing "${needle}")`);
}
const constants = entries.filter(([, entry]) => entry.constant);
assert.equal(constants.length, 1, 'exactly one constant architecture entry');

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
assert.ok(readme.includes('Tavernkeeper Knowledge'), 'README must document the managed knowledge book');

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

console.log('Tavernkeeper card + knowledge validation passed');
