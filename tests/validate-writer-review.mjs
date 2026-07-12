import assert from 'node:assert/strict';
import { renderWriterReview } from '../src/writer-review.js';

const html = renderWriterReview({
    kind: 'patch',
    expectedRevision: 2,
    changes: [
        { op: 'replace', path: 'index.js', before: '<old>', after: '<new>' },
        { op: 'rename', path: 'a.css', to: 'b.css', before: 'x', after: 'x' },
        { op: 'delete', path: 'gone.txt', before: 'bye', after: null },
    ],
    warnings: ['Check runtime behavior'],
});
assert.match(html, /Review managed extension update/);
assert.match(html, /index\.js/);
assert.match(html, /a\.css → b\.css/);
assert.match(html, /&lt;old&gt;/);
assert.match(html, /&lt;new&gt;/);
assert.doesNotMatch(html, /<old>/);
assert.match(html, /Check runtime behavior/);
assert.match(html, /always executable/);
assert.match(renderWriterReview({ kind: 'adopt', changes: [] }), /Existing extension will become Tavernkeeper-managed/);
console.log('Managed extension review rendering passed');
