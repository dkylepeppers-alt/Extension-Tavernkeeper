import assert from 'node:assert/strict';
import { extractDeliverables, makeItem, isExecutable } from '../src/protocol.js';

const SETTINGS = { maxBlockKb: 256 };
const extract = (text, settings = SETTINGS) => extractDeliverables(text, settings);
const fence = (tag, body, ticks = '```') => `${ticks}${tag}\n${body}\n${ticks}`;

// --- Tagged fence parsing, one item per type ---

const card = { spec: 'chara_card_v2', spec_version: '2.0', data: { name: 'Nella' } };
{
    const items = extract(fence('st-card', JSON.stringify(card)));
    assert.equal(items.length, 1);
    assert.equal(items[0].type, 'card');
    assert.equal(items[0].name, 'Nella');
    assert.equal(items[0].invalid, null);
}
{
    const items = extract(fence('st-lorebook', JSON.stringify({ name: 'Realm', entries: [{ key: ['a'], content: 'x' }] })));
    assert.equal(items[0].type, 'lorebook');
    assert.equal(items[0].name, 'Realm');
    assert.equal(items[0].invalid, null);
}
{
    const items = extract(fence('st-wi-entry', JSON.stringify({ book: 'Realm', entry: { key: ['a'], content: 'x' } })));
    assert.equal(items[0].type, 'wi-entry');
    assert.equal(items[0].invalid, null);
}
{
    const items = extract(fence('st-qrset', JSON.stringify({ name: 'Kit', qrList: [{ label: 'Go', message: '/echo hi' }] })));
    assert.equal(items[0].type, 'qrset');
    assert.equal(items[0].invalid, null);
}
{
    const items = extract(fence('st-regex', JSON.stringify({ scriptName: 'Trim', findRegex: 'a+', replaceString: 'a' })));
    assert.equal(items[0].type, 'regex');
    assert.equal(items[0].invalid, null);
}
{
    const items = extract(fence('st-script', '/echo hello'));
    assert.equal(items[0].type, 'script');
    assert.equal(items[0].invalid, null);
}

// --- Invalid JSON is reported, not thrown ---
{
    const items = extract(fence('st-card', '{not json'));
    assert.equal(items.length, 1);
    assert.match(items[0].invalid, /Invalid JSON/);
}

// --- Heuristics are gone: untagged JSON blocks are never deliverables ---
{
    assert.equal(extract(fence('json', JSON.stringify(card))).length, 0);
    assert.equal(extract(fence('', JSON.stringify(card))).length, 0);
}

// --- Oversize blocks are skipped ---
{
    const big = JSON.stringify({ ...card, data: { name: 'Nella', description: 'x'.repeat(2048) } });
    assert.equal(extract(fence('st-card', big), { maxBlockKb: 1 }).length, 0);
}

// --- Variable-length fences: a 4-backtick fence may contain ``` lines ---
{
    const cardWithFences = {
        spec: 'chara_card_v2', spec_version: '2.0',
        data: { name: 'Meta', mes_example: '<START>\n{{char}}: like this:\n```st-script\n/echo hi\n```\ndone' },
    };
    const body = JSON.stringify(cardWithFences, null, 2);
    assert.ok(body.includes('```'), 'test body must embed a fence');
    const items = extract(fence('st-card', body, '````'));
    assert.equal(items.length, 1, 'four-backtick fence must parse as one deliverable');
    assert.equal(items[0].invalid, null, `body must survive intact: ${items[0].invalid}`);
    assert.equal(items[0].data.data.name, 'Meta');
}

// --- blockIndex counts every fence in order ---
{
    const text = `intro\n${fence('js', 'let x = 1')}\nmid\n${fence('st-script', '/echo hi')}`;
    const items = extract(text);
    assert.equal(items.length, 1);
    assert.equal(items[0].blockIndex, 1);
}

// --- Duplicate identical fences get distinct hashes; extraction is deterministic ---
{
    const text = `${fence('st-script', '/echo hi')}\n\n${fence('st-script', '/echo hi')}`;
    const items = extract(text);
    assert.equal(items.length, 2);
    assert.notEqual(items[0].hash, items[1].hash, 'identical duplicate blocks must not share state');
    const again = extract(text);
    assert.equal(items[0].hash, again[0].hash);
    assert.equal(items[1].hash, again[1].hash);
    // First occurrence keeps the legacy (unsalted) hash so pre-3.0 chat state still matches.
    assert.equal(items[0].hash, makeItem('script', null, '/echo hi').hash);
}

// --- No fences, no work ---
assert.deepEqual(extract('plain prose, nothing here'), []);

// --- isExecutable: anything that can run STscript needs manual approval ---
{
    const mk = (type, data, raw = JSON.stringify(data)) => makeItem(type, data, raw);
    assert.equal(isExecutable(mk('script', null, '/echo hi')), true);
    assert.equal(isExecutable(mk('card', card)), false);
    assert.equal(isExecutable(mk('regex', { scriptName: 'Trim', findRegex: 'a+' })), false);
    assert.equal(isExecutable(mk('qrset', { name: 'K', qrList: [{ label: 'a', message: '/x' }] })), false);
    for (const flag of ['executeOnStartup', 'executeOnUser', 'executeOnAi', 'executeOnChatChange', 'executeOnNewChat', 'executeOnGroupMemberDraft']) {
        const item = mk('qrset', { name: 'K', qrList: [{ label: 'a', message: '/x', [flag]: true }] });
        assert.equal(isExecutable(item), true, `qrset with ${flag} must be executable`);
    }
    assert.equal(isExecutable(mk('lorebook', { name: 'R', entries: [{ content: 'x' }] })), false);
    assert.equal(isExecutable(mk('lorebook', { name: 'R', entries: [{ content: 'x', automationId: 'fire' }] })), true);
    assert.equal(isExecutable(mk('lorebook', { name: 'R', entries: { 0: { content: 'x', automation_id: 'fire' } } })), true);
    assert.equal(isExecutable(mk('wi-entry', { book: 'R', entry: { content: 'x' } })), false);
    assert.equal(isExecutable(mk('wi-entry', { book: 'R', entry: { content: 'x', automationId: 'fire' } })), true);
}

console.log('Protocol validation passed');
