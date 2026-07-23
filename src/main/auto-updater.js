const { app, dialog, ipcMain, shell } = require('electron');
const { autoUpdater } = require('electron-updater');

const RELEASES_URL = 'https://github.com/Messer1337/AccBrowser/releases/latest';

let mainWindowRef = null;

function sendToWindow(channel, data) {
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
        mainWindowRef.webContents.send(channel, data);
    }
}

function triggerInstallAndRelaunch() {
    // Squirrel.Mac (what electron-updater uses on macOS) requires the app to be signed
    // with an Apple Developer ID for quitAndInstall() to actually replace the app bundle
    // and relaunch it — without a paid cert, this build isn't signed, so the silent
    // install step does nothing (the app just closes and never reopens, no error surfaced
    // because the window is already gone by the time it would fail). Until we have a
    // Developer ID cert to sign+notarize mac builds, send the user to download it by hand
    // instead of pretending the one-click relaunch will work.
    if (process.platform === 'darwin') {
        console.log('[AutoUpdater] macOS build is unsigned — falling back to manual download.');
        shell.openExternal(RELEASES_URL);
        if (mainWindowRef && !mainWindowRef.isDestroyed()) {
            dialog.showMessageBox(mainWindowRef, {
                type: 'info',
                title: 'Встановіть оновлення вручну',
                message: 'На macOS автоматичне встановлення поки недоступне — застосунок ще не підписаний Apple-сертифікатом.',
                detail: 'Відкрили сторінку релізу у браузері. Завантажте новий .zip, розпакуйте і перетягніть у папку Applications (Програми) поверх старої версії.',
                buttons: ['Зрозуміло']
            });
        }
        return;
    }

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
        const actionLine = process.platform === 'darwin'
            ? 'Відкрити сторінку завантаження зараз?'
            : 'Перезапустити зараз, щоб застосувати оновлення?';
        const detail = notes ? `Що нового:\n\n${notes}\n\n${actionLine}` : actionLine;

        const { response } = await dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Оновлення готове',
            message: `Завантажено нову версію OASIS Browser (${info.version}).`,
            detail,
            buttons: [process.platform === 'darwin' ? 'Відкрити завантаження' : 'Перезапустити зараз', 'Пізніше'],
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
