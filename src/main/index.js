const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');
const { initFirebase, isFirebaseConfigured } = require('../config/firebase');
const SyncManager = require('./sync-manager');
const BrowserLauncher = require('./browser-launcher');
const AuthManager = require('./auth-manager');
const PreflightChecker = require('./preflight-checker');
const { initAutoUpdater } = require('./auto-updater');

let mainWindow = null;
let syncManager = null;
let browserLauncher = null;
let authManager = null;
app.name = 'OASIS Browser';

// AES-256-GCM export/import for profile backups, keyed by a password the admin supplies at export time.
const BACKUP_PBKDF2_ITERATIONS = 100000;

function encryptBackup(dataObj, password) {
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = crypto.pbkdf2Sync(password, salt, BACKUP_PBKDF2_ITERATIONS, 32, 'sha256');
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(dataObj), 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return JSON.stringify({
        v: 1,
        salt: salt.toString('hex'),
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex'),
        ciphertext: ciphertext.toString('base64')
    });
}

function decryptBackup(fileContent, password) {
    const { salt, iv, authTag, ciphertext } = JSON.parse(fileContent);
    const key = crypto.pbkdf2Sync(password, Buffer.from(salt, 'hex'), BACKUP_PBKDF2_ITERATIONS, 32, 'sha256');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
}

function createWindow() {
    const iconPath = path.join(__dirname, '../../assets/icon.png');
    if (process.platform === 'darwin' && app.dock) {
        app.dock.setIcon(iconPath);
    }

    mainWindow = new BrowserWindow({
        title: 'OASIS Browser',
        icon: iconPath,
        width: 1100,
        height: 750,
        minWidth: 900,
        minHeight: 600,
        titleBarStyle: 'hiddenInset',
        backgroundColor: '#0f172a',
        webPreferences: {
            preload: path.join(__dirname, '../preload/preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(async () => {
    initFirebase();
    const userDataPath = app.getPath('userData');
    authManager = new AuthManager(userDataPath);
    await authManager.restoreSession();
    syncManager = new SyncManager(userDataPath);
    browserLauncher = new BrowserLauncher(userDataPath, syncManager);

    // Starter profiles (only create if neither local nor cloud profile exists)
    const chatgptProfile = await syncManager.getProfile('chatgpt_profile');
    if (!chatgptProfile) {
        await syncManager.saveProfile({
            id: 'chatgpt_profile',
            name: 'ChatGPT / OpenAI',
            url: 'https://chatgpt.com',
            proxy: '',
            userAgent: '',
            cookies: []
        }, 'system');
    }

    const claudeProfile = await syncManager.getProfile('claude_profile');
    if (!claudeProfile) {
        await syncManager.saveProfile({
            id: 'claude_profile',
            name: 'Claude AI',
            url: 'https://claude.ai',
            proxy: '',
            userAgent: '',
            cookies: []
        }, 'system');
    }

    // IPC Handlers: Preflight Diagnostic Test
    ipcMain.handle('run-preflight-test', async (event, profileId) => {
        if (!authManager.canAccessProfile(profileId)) {
            return { ok: false, error: 'Доступ заборонено.' };
        }
        const profile = await syncManager.getProfile(profileId);
        if (!profile) return { ok: false, error: 'Профіль не знайдено.' };

        const proxyCheck = await PreflightChecker.checkProxy(profile.proxy);
        if (!proxyCheck.ok) {
            return { ok: false, stage: 'proxy', error: proxyCheck.error };
        }

        const urlCheck = await PreflightChecker.checkUrlAccessibility(profile.url);
        if (!urlCheck.ok) {
            return { ok: false, stage: 'url', error: urlCheck.error };
        }

        return { ok: true, message: 'Всі тести пройдено! Профіль готовий до запуску.' };
    });

    // IPC Handlers: Auth
    ipcMain.handle('login', async (event, username, password) => {
        return authManager.login(username, password);
    });

    ipcMain.handle('logout', async () => {
        return authManager.logout();
    });

    ipcMain.handle('get-current-user', async () => {
        return authManager.getCurrentUser();
    });

    ipcMain.handle('get-users', async () => {
        const currentUser = authManager.getCurrentUser();
        if (currentUser && currentUser.role === 'admin') {
            return authManager.getUsersSafe();
        }
        return [];
    });

    ipcMain.handle('save-user', async (event, user) => {
        const currentUser = authManager.getCurrentUser();
        if (currentUser && currentUser.role === 'admin') {
            return authManager.saveUser(user);
        }
        return false;
    });

    ipcMain.handle('change-password', async (event, newPassword) => {
        const currentUser = authManager.getCurrentUser();
        if (!currentUser) return { success: false, message: 'Не авторизовано' };
        return authManager.changePassword(currentUser.username, newPassword);
    });

    // IPC Handlers: Profiles (Strictly Secured)
    ipcMain.handle('list-profiles', async () => {
        const currentUser = authManager.getCurrentUser();
        if (!currentUser) return { profiles: [], totalCount: 0, allowedCount: 0 };

        const allProfiles = await syncManager.listProfiles();
        const allowedProfiles = allProfiles.filter(p => authManager.canAccessProfile(p.id));

        return {
            profiles: allowedProfiles.map(p => ({
                ...p,
                isRunning: browserLauncher.isProfileRunning(p.id)
            })),
            totalCount: allProfiles.length,
            allowedCount: allowedProfiles.length
        };
    });

    ipcMain.handle('get-profile', async (event, id) => {
        if (!authManager.canAccessProfile(id)) throw new Error('Немає доступу до цього профілю.');
        return await syncManager.getProfile(id);
    });

    ipcMain.handle('run-full-health-check', async (event, profileId) => {
        if (!authManager.canAccessProfile(profileId)) {
            return { ok: false, error: 'Доступ заборонено.' };
        }
        const profile = await syncManager.getProfile(profileId);
        if (!profile) return { ok: false, error: 'Профіль не знайдено.' };
        return await PreflightChecker.runFullHealthCheck(profile);
    });

    ipcMain.handle('get-audit-logs', async () => {
        const currentUser = authManager.getCurrentUser();
        if (!currentUser || currentUser.role !== 'admin') {
            throw new Error('Тільки адміністратор має доступ до журналу дій.');
        }
        return await syncManager.getAuditLogs();
    });

    ipcMain.handle('save-profile', async (event, profile) => {
        const currentUser = authManager.getCurrentUser();
        if (!currentUser || currentUser.role !== 'admin') {
            throw new Error('Тільки адміністратор може редагувати або створювати профілі.');
        }
        const result = await syncManager.saveProfile(profile, currentUser.username);
        await syncManager.logActivity({
            action: 'Збереження профілю',
            username: currentUser.username,
            profileId: profile.id,
            profileName: profile.name
        });
        return result;
    });

    ipcMain.handle('delete-profile', async (event, id) => {
        const currentUser = authManager.getCurrentUser();
        if (!currentUser || currentUser.role !== 'admin') {
            throw new Error('Тільки адміністратор може видаляти профілі.');
        }
        const profile = await syncManager.getProfile(id);
        const result = await syncManager.deleteProfile(id);
        await syncManager.logActivity({
            action: 'Видалення профілю',
            username: currentUser.username,
            profileId: id,
            profileName: profile ? profile.name : id
        });
        return result;
    });

    ipcMain.handle('launch-profile', async (event, id) => {
        const currentUser = authManager.getCurrentUser();
        if (!currentUser || !authManager.canAccessProfile(id)) {
            throw new Error('Доступ заборонено: у вас немає прав на запуск цього профілю.');
        }

        const profile = await syncManager.getProfile(id);
        const proxyCheck = await PreflightChecker.checkProxy(profile.proxy);
        if (!proxyCheck.ok) {
            throw new Error(`Автотест не пройдено (Проксі): ${proxyCheck.error}`);
        }

        const launchResult = await browserLauncher.launchProfile(id, currentUser.username);
        await syncManager.logActivity({
            action: 'Запуск профілю',
            username: currentUser.username,
            profileId: id,
            profileName: profile ? profile.name : id
        });
        return launchResult;
    });

    ipcMain.handle('warmup-profile', async (event, id) => {
        const currentUser = authManager.getCurrentUser();
        if (!currentUser || !authManager.canAccessProfile(id)) {
            throw new Error('Доступ заборонено.');
        }
        const profile = await syncManager.getProfile(id);
        const warmupResult = await browserLauncher.warmupProfile(id, currentUser.username);
        await syncManager.logActivity({
            action: 'Авто-прогрів профілю',
            username: currentUser.username,
            profileId: id,
            profileName: profile ? profile.name : id
        });
        return warmupResult;
    });

    ipcMain.handle('import-cookies', async (event, { id, cookiesJson }) => {
        const currentUser = authManager.getCurrentUser();
        if (!currentUser || currentUser.role !== 'admin') {
            throw new Error('Тільки адміністратор може імпортувати кукі.');
        }
        let parsed = [];
        try {
            parsed = typeof cookiesJson === 'string' ? JSON.parse(cookiesJson) : cookiesJson;
            if (!Array.isArray(parsed)) throw new Error('Кукі мають бути масивом JSON.');
        } catch (e) {
            throw new Error('Некоректний формат JSON куків: ' + e.message);
        }

        const profile = await syncManager.getProfile(id);
        if (!profile) throw new Error('Профіль не знайдено.');

        profile.cookies = parsed;
        profile.updatedAt = Date.now();
        await syncManager.saveProfile(profile, currentUser.username);
        return { success: true, count: parsed.length };
    });

    ipcMain.handle('export-profiles', async (event, password) => {
        const currentUser = authManager.getCurrentUser();
        if (!currentUser || currentUser.role !== 'admin') {
            throw new Error('Тільки адміністратор може експортувати профілі.');
        }
        if (!password || password.length < 6) {
            throw new Error('Пароль для шифрування бекапу має містити щонайменше 6 символів.');
        }

        const profiles = await syncManager.listProfiles();
        const encrypted = encryptBackup({ exportedAt: Date.now(), profiles }, password);

        const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
            title: 'Експорт профілів OASIS Browser',
            defaultPath: `oasis-profiles-backup-${Date.now()}.oasisbak`,
            filters: [{ name: 'OASIS Encrypted Backup', extensions: ['oasisbak'] }]
        });
        if (canceled || !filePath) return { success: false, message: 'Скасовано.' };

        await fs.writeFile(filePath, encrypted, 'utf8');
        await syncManager.logActivity({
            action: `Експорт бекапу (${profiles.length} профілів)`,
            username: currentUser.username
        });
        return { success: true, path: filePath, count: profiles.length };
    });

    ipcMain.handle('import-profiles', async (event, password) => {
        const currentUser = authManager.getCurrentUser();
        if (!currentUser || currentUser.role !== 'admin') {
            throw new Error('Тільки адміністратор може імпортувати профілі.');
        }

        const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
            title: 'Імпорт профілів OASIS Browser',
            filters: [{ name: 'OASIS Encrypted Backup', extensions: ['oasisbak'] }],
            properties: ['openFile']
        });
        if (canceled || !filePaths || filePaths.length === 0) return { success: false, message: 'Скасовано.' };

        const fileContent = await fs.readFile(filePaths[0], 'utf8');
        let backup;
        try {
            backup = decryptBackup(fileContent, password);
        } catch (e) {
            throw new Error('Не вдалося розшифрувати файл — невірний пароль або пошкоджений файл.');
        }

        if (!backup || !Array.isArray(backup.profiles)) {
            throw new Error('Некоректний формат файлу бекапу.');
        }

        for (const profile of backup.profiles) {
            await syncManager.saveProfile(profile, currentUser.username);
        }

        await syncManager.logActivity({
            action: `Імпорт бекапу (${backup.profiles.length} профілів)`,
            username: currentUser.username
        });

        return { success: true, count: backup.profiles.length };
    });

    ipcMain.handle('get-sync-status', async () => {
        return {
            isCloudConfigured: isFirebaseConfigured(),
            mode: isFirebaseConfigured() ? 'Firebase Cloud Sync' : 'Локальний режим'
        };
    });

    ipcMain.handle('update-firebase-config', async (event, config) => {
        const currentUser = authManager.getCurrentUser();
        if (!currentUser || currentUser.role !== 'admin') {
            throw new Error('Тільки адміністратор може змінювати налаштування Firebase.');
        }
        initFirebase(config);
        return { success: true, isConfigured: isFirebaseConfigured() };
    });

    ipcMain.handle('delete-user', async (event, username) => {
        const currentUser = authManager.getCurrentUser();
        if (!currentUser || currentUser.role !== 'admin') {
            throw new Error('Тільки адміністратор може видаляти користувачів.');
        }
        authManager.deleteUser(username);
        return { success: true };
    });

    createWindow();
    initAutoUpdater(mainWindow);

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
