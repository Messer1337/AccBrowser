const { app, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');

// electron-updater returns releaseNotes as a plain string for a single version,
// or as an array of { version, note } when the update skips several versions at once.
function formatReleaseNotes(releaseNotes) {
    if (!releaseNotes) return '';
    if (typeof releaseNotes === 'string') return releaseNotes.replace(/<[^>]+>/g, '').trim();
    if (Array.isArray(releaseNotes)) {
        return releaseNotes
            .map(entry => `v${entry.version}:\n${(entry.note || '').replace(/<[^>]+>/g, '').trim()}`)
            .join('\n\n');
    }
    return '';
}

function initAutoUpdater(mainWindow) {
    // In dev (unpacked) there's no packaged app to update — electron-updater would just throw.
    if (!app.isPackaged) {
        console.log('[AutoUpdater] Skipped — running unpacked (dev mode).');
        return;
    }

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', (info) => {
        console.log(`[AutoUpdater] Update available: ${info.version}`);
    });

    autoUpdater.on('error', (err) => {
        console.warn('[AutoUpdater] Error checking/downloading update:', err.message);
    });

    autoUpdater.on('update-downloaded', async (info) => {
        const notes = formatReleaseNotes(info.releaseNotes);
        const detail = notes
            ? `Що нового:\n\n${notes}\n\nПерезапустити зараз, щоб застосувати оновлення?`
            : 'Перезапустити зараз, щоб застосувати оновлення?';

        const { response } = await dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Оновлення готове',
            message: `Завантажено нову версію OASIS Browser (${info.version}).`,
            detail,
            buttons: ['Перезапустити зараз', 'Пізніше'],
            defaultId: 0,
            cancelId: 1
        });
        if (response === 0) {
            autoUpdater.quitAndInstall();
        }
    });

    autoUpdater.checkForUpdates().catch(err => {
        console.warn('[AutoUpdater] Initial check failed:', err.message);
    });

    // Re-check periodically for a long-running session (every 4 hours)
    setInterval(() => {
        autoUpdater.checkForUpdates().catch(() => {});
    }, 4 * 60 * 60 * 1000);
}

module.exports = { initAutoUpdater };
