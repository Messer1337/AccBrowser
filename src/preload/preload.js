const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    platform: process.platform,

    login: (username, password) => ipcRenderer.invoke('login', username, password),
    logout: () => ipcRenderer.invoke('logout'),
    getCurrentUser: () => ipcRenderer.invoke('get-current-user'),
    getUsers: () => ipcRenderer.invoke('get-users'),
    saveUser: (user) => ipcRenderer.invoke('save-user', user),
    deleteUser: (username) => ipcRenderer.invoke('delete-user', username),
    changePassword: (newPassword) => ipcRenderer.invoke('change-password', newPassword),

    listProfiles: () => ipcRenderer.invoke('list-profiles'),
    getProfile: (id) => ipcRenderer.invoke('get-profile', id),
    saveProfile: (profile) => ipcRenderer.invoke('save-profile', profile),
    deleteProfile: (id) => ipcRenderer.invoke('delete-profile', id),
    launchProfile: (id) => ipcRenderer.invoke('launch-profile', id),
    warmupProfile: (id) => ipcRenderer.invoke('warmup-profile', id),
    importCookies: (id, cookiesJson) => ipcRenderer.invoke('import-cookies', { id, cookiesJson }),
    runPreflightTest: (id) => ipcRenderer.invoke('run-preflight-test', id),
    runFullHealthCheck: (id) => ipcRenderer.invoke('run-full-health-check', id),
    getAuditLogs: () => ipcRenderer.invoke('get-audit-logs'),
    getSyncStatus: () => ipcRenderer.invoke('get-sync-status'),
    updateFirebaseConfig: (config) => ipcRenderer.invoke('update-firebase-config', config),
    exportProfiles: (password) => ipcRenderer.invoke('export-profiles', password),
    importProfiles: (password) => ipcRenderer.invoke('import-profiles', password),
    getChangelog: () => ipcRenderer.invoke('get-changelog'),

    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    installUpdate: () => ipcRenderer.invoke('install-update'),
    onUpdateStatus: (callback) => ipcRenderer.on('update-status', (event, data) => callback(data)),
    onForceLogout: (callback) => ipcRenderer.on('force-logout', (event, data) => callback(data)),
    onProfilesUpdated: (callback) => ipcRenderer.on('profiles-updated', () => callback())
});
