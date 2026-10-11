const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
process.chdir(root);
const source = 'prisma/schema.prisma';
const generated = 'node_modules/.prisma/client/schema.prisma';
async function generate() {
    for (let attempt = 0; attempt < 3; attempt++) {
        // A transient Windows file lock must not leave startup using a stale client.
        if (process.platform === 'win32' && fs.existsSync(generated)) {
            try { fs.copyFileSync(source, generated); } catch { /* The generator retries the write below. */ }
        }
        const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'generate', '--schema', source], { cwd: root, encoding: 'utf8' });
        const output = (result.stdout || '') + (result.stderr || '');
        if (result.status === 0) { process.stdout.write(output); return; }
        if (process.platform !== 'win32' || !/UNKNOWN: unknown error|EPERM|EBUSY/.test(output) || attempt === 2) {
            process.stderr.write(output); if (result.error) console.error(result.error.message); process.exitCode = result.status || 1; return;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
}
generate().catch(error => { console.error(error.message); process.exitCode = 1; });
