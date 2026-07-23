// Pulls the CHANGELOG.md section matching the current package.json version into
// RELEASE_NOTES_CURRENT.md, which electron-builder embeds into latest.yml via
// build.releaseInfo.releaseNotesFile. electron-updater then hands that text back
// as info.releaseNotes on the client, so users see "what's new" before restarting.
const fs = require('fs-extra');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CHANGELOG_PATH = path.join(ROOT, 'CHANGELOG.md');
const OUT_PATH = path.join(ROOT, 'RELEASE_NOTES_CURRENT.md');

function main() {
    const { version } = require(path.join(ROOT, 'package.json'));
    const changelog = fs.readFileSync(CHANGELOG_PATH, 'utf8');

    // Matches "## [1.1.0] - 2026-07-23" up to the next "## [" heading (or end of file)
    const sectionRegex = new RegExp(
        `^## \\[${version.replace(/\./g, '\\.')}\\][^\\n]*\\n([\\s\\S]*?)(?=^## \\[|\\Z)`,
        'm'
    );
    const match = changelog.match(sectionRegex);

    if (!match) {
        console.warn(`[extract-release-notes] No CHANGELOG.md entry found for version ${version} — writing a placeholder.`);
        fs.writeFileSync(OUT_PATH, `Версія ${version}.`, 'utf8');
        return;
    }

    fs.writeFileSync(OUT_PATH, match[1].trim() + '\n', 'utf8');
    console.log(`[extract-release-notes] Wrote release notes for v${version} to RELEASE_NOTES_CURRENT.md`);
}

main();
