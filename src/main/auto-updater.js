const { app, dialog, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');

let mainWindowRef = null;

function sendToWindow(channel, data) {
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
        mainWindowRef.webContents.send(channel, data);
    }
}

function triggerInstallAndRelaunch() {
    console.log('[AutoUpdater] Quitting and installing update...');
    setImmediate(() => {
        app.removeAllListeners("window-all-closed");
        if (mainWindowRef && !mainWindowRef.isDestroyed()) {
            mainWindowRef.close();
        }
        autoUpdater.quitAndInstall(false, true);
    });
}

function initAutoUpdater(mainWindow) {
    mainWindowRef = mainWindow;

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => {
        console.log('[AutoUpdater] Checking for update...');
        sendToWindow('update-status', { 
            status: 'checking', 
            message: 'Перевіряємо наявність оновлень...' 
        });
    });

    autoUpdater.on('update-available', (info) => {
        console.log(`[AutoUpdater] Update available: ${info.version}`);
        sendToWindow('update-status', { 
            status: 'available', 
            version: info.version, 
            message: `Знайдено нову версію v${info.version}! Завантаження...` 
        });
    });

    autoUpdater.on('update-not-available', (info) => {
        console.log('[AutoUpdater] No update available.');
        sendToWindow('update-status', { 
            status: 'not-available', 
            version: info.version, 
            message: `У вас встановлено найновішу версію (v${app.getVersion()}).` 
        });
    });

    autoUpdater.on('download-progress', (progressObj) => {
        const percent = Math.round(progressObj.percent || 0);
        sendToWindow('update-status', { 
            status: 'downloading', 
            percent, 
            message: `Завантаження оновлення: ${percent}%` 
        });
    });

    autoUpdater.on('error', (err) => {
        console.warn('[AutoUpdater] Error checking/downloading update:', err.message);
        sendToWindow('update-status', { 
            status: 'error', 
            message: `Помилка перевірки оновлення: ${err.message}` 
        });
    });

    autoUpdater.on('update-downloaded', async (info) => {
        console.log(`[AutoUpdater] Update downloaded: ${info.version}`);
        sendToWindow('update-status', { 
            status: 'downloaded', 
            version: info.version, 
            releaseNotes: info.releaseNotes,
            message: `Оновлення v${info.version} успішно завантажено!` 
        });

        const notes = typeof info.releaseNotes === 'string' 
            ? info.releaseNotes.replace(/<[^>]+>/g, '').trim() 
            : '';
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
            triggerInstallAndRelaunch();
        }
    });

    if (app.isPackaged) {
        autoUpdater.checkForUpdates().catch(err => {
            console.warn('[AutoUpdater] Initial check failed:', err.message);
        });

        setInterval(() => {
            autoUpdater.checkForUpdates().catch(() => {});
        }, 4 * 60 * 60 * 1000);
    }
}

function registerUpdateIpc() {
    ipcMain.handle('get-app-version', () => app.getVersion());

    ipcMain.handle('check-for-updates', async () => {
        if (!app.isPackaged) {
            return {
                status: 'dev',
                message: `Режим розробки (dev mode). Поточна версія: v${app.getVersion()}`
            };
        }
        try {
            const result = await autoUpdater.checkForUpdates();
            return { success: true, version: app.getVersion() };
        } catch (e) {
            return { success: false, message: e.message };
        }
    });

    ipcMain.handle('install-update', () => {
        triggerInstallAndRelaunch();
    });
}

module.exports = { initAutoUpdater, registerUpdateIpc };
