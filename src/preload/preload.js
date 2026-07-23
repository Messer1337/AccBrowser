const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
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
    getSyncStatus: () => ipcRenderer.invoke('get-sync-status'),
    updateFirebaseConfig: (config) => ipcRenderer.invoke('update-firebase-config', config),
    exportProfiles: (password) => ipcRenderer.invoke('export-profiles', password),
    importProfiles: (password) => ipcRenderer.invoke('import-profiles', password)
});
