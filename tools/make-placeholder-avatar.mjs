// Generate cards/Chronicler.png: a plain 1024x1536 placeholder portrait (a warm
// hearth-glow gradient in the tavern palette, no text) to stand in until real art
// is produced from cards/CHRONICLER_AVATAR_PROMPT.md. Writes a bare PNG; run
// node tools/build-card.mjs Chronicler afterwards to embed the card data.
import fs from 'node:fs';
import zlib from 'node:zlib';

const pngPath = new URL('../cards/Chronicler.png', import.meta.url);
const WIDTH = 1024;
const HEIGHT = 1536;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
    return out;
}

const CHARCOAL = [43, 40, 38];
const WALNUT = [74, 52, 34];
const AMBER = [201, 149, 74];

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// Filter-0 scanlines: charcoal-to-walnut vertical gradient with a soft amber
// hearth glow above center, echoing the Tavernkeeper portrait's palette.
const raw = Buffer.alloc(HEIGHT * (1 + WIDTH * 3));
for (let y = 0; y < HEIGHT; y++) {
    const row = y * (1 + WIDTH * 3);
    const base = mix(WALNUT, CHARCOAL, y / (HEIGHT - 1));
    for (let x = 0; x < WIDTH; x++) {
        const dx = x / WIDTH - 0.5;
        const dy = y / HEIGHT - 0.38;
        const glow = Math.max(0, 1 - Math.hypot(dx * 1.6, dy) / 0.55) ** 2 * 0.6;
        const [r, g, b] = mix(base, AMBER, glow);
        raw.writeUInt8(Math.round(r), row + 1 + x * 3);
        raw.writeUInt8(Math.round(g), row + 2 + x * 3);
        raw.writeUInt8(Math.round(b), row + 3 + x * 3);
    }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(WIDTH, 0);
ihdr.writeUInt32BE(HEIGHT, 4);
ihdr.writeUInt8(8, 8); // bit depth
ihdr.writeUInt8(2, 9); // color type: truecolor

fs.writeFileSync(pngPath, Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
]));
console.log(`Wrote ${fs.realpathSync(pngPath)} (${WIDTH}x${HEIGHT} placeholder, no card chunks yet)`);
