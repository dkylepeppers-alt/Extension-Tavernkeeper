export function escapeHtml(text) {
    return String(text ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

/** Truncate for tool-result digests; single line, ellipsis on overflow. */
export function truncateText(text, max) {
    const value = String(text ?? '');
    return value.length > max ? value.slice(0, max - 1) + '…' : value;
}
