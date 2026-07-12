import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tkw-setup-'));
const script = path.resolve('scripts/setup-writer.sh');
await fs.mkdir(path.join(root, 'plugins'), { recursive: true });
await fs.mkdir(path.join(root, 'data', 'default-user', 'extensions'), { recursive: true });
await fs.writeFile(path.join(root, 'config.yaml'), 'enableServerPlugins: false\n');

function run(...args) {
    return execFileSync('bash', [script, '--sillytavern-root', root, ...args], { encoding: 'utf8' });
}

try {
    const dry = run('--dry-run');
    assert.match(dry, /DRY RUN/);
    await assert.rejects(fs.access(path.join(root, 'plugins', 'tavernkeeper-writer')));

    const first = run();
    assert.match(first, /Installed Tavernkeeper UI extension/);
    assert.match(first, /enableServerPlugins is false/);
    assert.equal(await fs.readFile(path.join(root, 'config.yaml'), 'utf8'), 'enableServerPlugins: false\n');
    assert.equal(JSON.parse(await fs.readFile(path.join(root, 'plugins', 'tavernkeeper-writer', 'package.json'))).name, 'tavernkeeper-writer');
    assert.equal(JSON.parse(await fs.readFile(path.join(root, 'data', 'default-user', 'extensions', 'Extension-Tavernkeeper', 'manifest.json'))).display_name, "Tavernkeeper's Workshop");
    await assert.rejects(fs.access(path.join(root, 'data', 'default-user', 'extensions', 'Extension-Tavernkeeper', '.git')));

    await fs.writeFile(path.join(root, 'plugins', 'tavernkeeper-writer', 'old.txt'), 'preserve me');
    const second = run();
    assert.match(second, /Backed up existing companion plugin/);
    const backups = (await fs.readdir(path.join(root, 'plugins'))).filter(name => name.startsWith('tavernkeeper-writer.backup-'));
    assert.equal(backups.length, 1);
    assert.equal(await fs.readFile(path.join(root, 'plugins', backups[0], 'old.txt'), 'utf8'), 'preserve me');
    assert.match(run('--dry-run'), /DRY RUN/);

    assert.throws(
        () => execFileSync('bash', [script, '--sillytavern-root', path.join(root, 'missing')], { encoding: 'utf8', stdio: 'pipe' }),
        /Command failed/,
    );
    console.log('Writer setup script validation passed');
} finally {
    await fs.rm(root, { recursive: true, force: true });
}
