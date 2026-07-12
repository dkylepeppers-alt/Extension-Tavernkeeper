import assert from 'node:assert/strict';
import fs from 'node:fs';
import { searchKnowledge, buildToc, buildPrimer } from '../src/knowledge.js';

const knowledgePath = new URL('../knowledge/tavernkeeper-knowledge.json', import.meta.url);
const knowledge = JSON.parse(fs.readFileSync(knowledgePath, 'utf8'));

// --- Schema ---

assert.ok(Number.isInteger(knowledge.version) && knowledge.version >= 3, 'knowledge version must be an integer >= 3');
assert.equal(knowledge.name, 'Tavernkeeper Knowledge');
assert.ok(knowledge.entries && !Array.isArray(knowledge.entries), 'entries must be an object keyed by uid');
assert.ok(Array.isArray(knowledge.changelog), 'changelog array required');
const currentLog = knowledge.changelog.find(c => c.version === knowledge.version);
assert.ok(currentLog && typeof currentLog.summary === 'string' && currentLog.summary.length > 10,
    'changelog must describe the current version');

// The database serves entries directly — only search-relevant fields belong here.
const ALLOWED_ENTRY_FIELDS = new Set(['uid', 'key', 'keysecondary', 'comment', 'content', 'constant', 'order']);

const entries = Object.entries(knowledge.entries);
assert.ok(entries.length >= 20, 'knowledge lost entries');
for (const [id, entry] of entries) {
    assert.equal(String(entry.uid), id, `entry ${id} uid must match its key`);
    assert.ok(Array.isArray(entry.key), `entry ${id} key must be an array`);
    assert.equal(typeof entry.content, 'string', `entry ${id} content must be a string`);
    assert.ok(entry.comment, `entry ${id} needs a comment (its TOC title)`);
    for (const field of Object.keys(entry)) {
        assert.ok(ALLOWED_ENTRY_FIELDS.has(field), `entry ${id} has unexpected field "${field}"`);
    }
    assert.ok(!entry.content.includes('```st-'), `entry ${id} must not embed the fence protocol (the extension injects it)`);
}
assert.equal(entries.filter(([, e]) => e.constant).length, 1, 'exactly one constant architecture entry (the primer source)');

// --- Content coverage ---

const contents = entries.map(([, e]) => e.content);
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
    ['knowledge search tool', 'workshop_search_knowledge'],
];
for (const [label, needle] of mustCover) {
    assert.ok(contents.some(c => c.includes(needle)), `knowledge must cover ${label} (missing "${needle}")`);
}
assert.ok(!contents.some(c => /heuristic/i.test(c)), 'heuristic detection was removed — knowledge must not describe it');
assert.ok(!contents.some(c => /extension-managed lorebook|synced.{0,20}lorebook|Tavernkeeper Knowledge.{0,30}world file/i.test(c)),
    'knowledge must not describe itself as a synced lorebook anymore');

// --- Table of contents ---

const toc = buildToc(knowledge);
for (const [id, entry] of entries) {
    assert.ok(toc.includes(`${id}:`), `TOC missing entry ${id}`);
    assert.ok(toc.includes(entry.comment), `TOC missing title "${entry.comment}"`);
}
assert.ok(toc.length < 2500, `TOC must stay compact (got ${toc.length} chars)`);

// --- Search: fetch by exact id ---

{
    const hits = searchKnowledge('5', knowledge);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].uid, 5);
    assert.equal(hits[0].content, knowledge.entries['5'].content, 'id fetch returns the full untruncated entry');
}

// --- Search: free-text queries rank the right entry first ---

{
    const hits = searchKnowledge('sticky cooldown recursion', knowledge);
    assert.ok(hits.length >= 1);
    assert.equal(hits[0].uid, 6, `expected advanced-WI entry first, got uid ${hits[0].uid}`);
}
{
    const hits = searchKnowledge('depth_prompt', knowledge);
    assert.ok(hits.some(h => h.uid === 2), 'depth_prompt should surface the card extensions entry');
}
{
    const hits = searchKnowledge("lorebook entry won't trigger", knowledge);
    assert.ok(hits.length >= 1);
    assert.equal(hits[0].uid, 5, `expected the activation-model entry first, got uid ${hits[0].uid}`);
}
{
    assert.deepEqual(searchKnowledge('zzz qqqxv wibblefrob', knowledge), [], 'nonsense queries return no hits');
    assert.deepEqual(searchKnowledge('', knowledge), [], 'empty query returns no hits');
}
{
    const hits = searchKnowledge('macro', knowledge);
    assert.ok(hits.length <= 3, 'search returns at most 3 entries');
    assert.ok(JSON.stringify(hits).length <= 16384, 'search results stay within the size cap');
}

// --- Primer ---

{
    const constant = entries.find(([, e]) => e.constant)[1];
    const primer = buildPrimer(knowledge, { webSearchAvailable: true });
    assert.ok(primer.includes(constant.content.slice(0, 60)), 'primer must carry the architecture summary');
    assert.ok(primer.includes('workshop_search_knowledge'), 'primer must point at the search tool');
    assert.ok(/WebSearch/i.test(primer), 'primer mentions WebSearch when the tool is available');
    for (const [id, entry] of entries) {
        assert.ok(primer.includes(entry.comment), `primer TOC missing "${entry.comment}" (entry ${id})`);
    }
    const noWeb = buildPrimer(knowledge, { webSearchAvailable: false });
    assert.ok(!/WebSearch/i.test(noWeb), 'primer omits WebSearch when the tool is absent');
}

console.log('Knowledge validation passed');
