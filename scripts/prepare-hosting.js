// Copies only the files electron-updater's clients actually need (installers, zips,
// blockmaps, and the latest*.yml manifests) out of the noisy electron-builder dist/
// output into hosting_updates/updates/, which firebase.json serves as Hosting's public dir.
const fs = require('fs-extra');
const path = require('path');

const DIST_DIR = path.join(__dirname, '..', 'dist');
const OUT_DIR = path.join(__dirname, '..', 'hosting_updates', 'updates');

const KEEP_PATTERNS = [
    /\.exe$/i,
    /\.zip$/i,
    /\.blockmap$/i,
    /^latest.*\.yml$/i
];

async function main() {
    await fs.ensureDir(OUT_DIR);
    await fs.emptyDir(OUT_DIR);

    const entries = await fs.readdir(DIST_DIR);
    let copied = 0;

    for (const entry of entries) {
        const fullPath = path.join(DIST_DIR, entry);
        const stat = await fs.stat(fullPath);
        if (!stat.isFile()) continue;
        if (!KEEP_PATTERNS.some(rx => rx.test(entry))) continue;

        await fs.copy(fullPath, path.join(OUT_DIR, entry));
        copied++;
        console.log(`[prepare-hosting] Copied ${entry}`);
    }

    if (copied === 0) {
        console.warn('[prepare-hosting] No release artifacts found in dist/ — did the build run first?');
        process.exit(1);
    }
    console.log(`[prepare-hosting] Done — ${copied} files ready in hosting_updates/updates/`);
}

main().catch(err => {
    console.error('[prepare-hosting] Failed:', err.message);
    process.exit(1);
});
