import { escapeHtml } from './util.js';

function changeTitle(change) {
    if (change.op === 'rename') return `${change.path} → ${change.to}`;
    return change.path;
}

function revisionLine(validation) {
    if (validation.kind === 'create') return 'New managed extension · revision 1';
    if (validation.kind === 'adopt') return 'Existing extension will become Tavernkeeper-managed · revision 1';
    if (validation.kind === 'rollback') return `Rollback revision ${validation.expectedRevision} → ${validation.targetRevision}`;
    return `Update based on revision ${validation.expectedRevision}`;
}

export function renderWriterReview(validation) {
    const changes = (validation.changes ?? []).map(change => {
        const before = change.before === null || change.before === undefined ? '(none)' : String(change.before);
        const after = change.after === null || change.after === undefined ? '(none)' : String(change.after);
        return `
            <section class="tkw-diff-change tkw-diff-${escapeHtml(change.op)}">
                <h4><span>${escapeHtml(change.op.toUpperCase())}</span> ${escapeHtml(changeTitle(change))}</h4>
                <div class="tkw-diff-grid">
                    <div><b>Before</b><pre><code>${escapeHtml(before)}</code></pre></div>
                    <div><b>After</b><pre><code>${escapeHtml(after)}</code></pre></div>
                </div>
            </section>`;
    }).join('');
    const warnings = (validation.warnings ?? []).map(warning => `<li>${escapeHtml(warning)}</li>`).join('');
    return `
        <div class="tkw-writer-review">
            <h3>Review managed extension update</h3>
            <p>${escapeHtml(revisionLine(validation))}</p>
            <p class="tkw-warning"><i class="fa-solid fa-triangle-exclamation"></i> Extension JavaScript is always executable and will run after reload. Review every change before approving.</p>
            ${warnings ? `<ul class="tkw-warning">${warnings}</ul>` : ''}
            ${changes}
        </div>`;
}
