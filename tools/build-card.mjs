// Rebuild cards/Tavernkeeper.png from cards/Tavernkeeper.chara_card_v2.json:
// replaces the 'chara' (V2) and 'ccv3' (V3) tEXt chunks, keeping the image
// pixels untouched. Run after any card JSON change, then validate:
//   node tools/build-card.mjs && node tests/validate-card.mjs
import fs from 'node:fs';

const cardPath = new URL('../cards/Tavernkeeper.chara_card_v2.json', import.meta.url);
const pngPath = new URL('../cards/Tavernkeeper.png', import.meta.url);

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

function textChunk(keyword, text) {
    const data = Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(text, 'latin1')]);
    const chunk = Buffer.alloc(12 + data.length);
    chunk.writeUInt32BE(data.length, 0);
    chunk.write('tEXt', 4, 'ascii');
    data.copy(chunk, 8);
    chunk.writeUInt32BE(crc32(Buffer.concat([Buffer.from('tEXt', 'ascii'), data])), 8 + data.length);
    return chunk;
}

const card = JSON.parse(fs.readFileSync(cardPath, 'utf8'));
const v3 = { spec: 'chara_card_v3', spec_version: '3.0', data: structuredClone(card.data) };

const png = fs.readFileSync(pngPath);
if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('not a PNG');

const parts = [png.subarray(0, 8)];
for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');
    const chunk = png.subarray(offset, offset + 12 + length);
    const isCardChunk = type === 'tEXt' && ['chara', 'ccv3'].includes(chunk.subarray(8, 8 + length).toString('latin1').split('\0')[0]);
    if (type === 'IEND') {
        parts.push(textChunk('chara', Buffer.from(JSON.stringify(card), 'utf8').toString('base64')));
        parts.push(textChunk('ccv3', Buffer.from(JSON.stringify(v3), 'utf8').toString('base64')));
        parts.push(chunk);
    } else if (!isCardChunk) {
        parts.push(chunk);
    }
    offset += 12 + length;
}

fs.writeFileSync(pngPath, Buffer.concat(parts));
console.log(`Rebuilt ${fs.realpathSync(pngPath)} (chara + ccv3 chunks refreshed, ${Buffer.concat(parts).length} bytes)`);
