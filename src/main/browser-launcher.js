const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const { execFileSync } = require('child_process');
const { FingerprintGenerator } = require('fingerprint-generator');
const { FingerprintInjector } = require('fingerprint-injector');
const PreflightChecker = require('./preflight-checker');

class BrowserLauncher {
    constructor(userDataPath, syncManager, onSyncError = null) {
        this.userDataPath = userDataPath;
        this.syncManager = syncManager;
        this.onSyncError = onSyncError;
        this.activeBrowsers = new Map(); // id -> { browser, page, leaseInterval, unsubscribe, syncCurrentCookies }
        const platform = os.platform();
        const fingerprintOperatingSystem = platform === 'darwin'
            ? 'macos'
            : platform === 'win32'
                ? 'windows'
                : 'linux';
        this.fingerprintOperatingSystem = fingerprintOperatingSystem;
        this.fingerprintGenerator = new FingerprintGenerator({
            browsers: [{ name: 'chrome', minVersion: 120 }],
            devices: ['desktop'],
            // A Windows fingerprint injected into Chrome on macOS (or vice versa) is a
            // stable anomaly. Keep the generated navigator platform tied to the host OS.
            operatingSystems: [fingerprintOperatingSystem]
        });
        this.fingerprintInjector = new FingerprintInjector();
    }

    // Detect system Chrome path
    findChromePath() {
        const platform = os.platform();
        if (platform === 'darwin') {
            const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
            if (fs.existsSync(chromePath)) return chromePath;
        } else if (platform === 'win32') {
            const paths = [
                'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe')
            ];
            for (const p of paths) {
                if (fs.existsSync(p)) return p;
            }
        } else if (platform === 'linux') {
            const paths = ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'];
            for (const p of paths) {
                if (fs.existsSync(p)) return p;
            }
        }
        throw new Error('Google Chrome binary not found on your system. Please install Google Chrome.');
    }

    getChromeMajorVersion(executablePath) {
        try {
            const output = execFileSync(executablePath, ['--version'], { encoding: 'utf8', timeout: 3000 });
            const match = output.match(/(\d+)\./);
            const version = match ? Number(match[1]) : null;
            return Number.isInteger(version) && version >= 100 && version <= 999 ? version : null;
        } catch (error) {
            console.warn('[BrowserLauncher] Chrome version detection notice:', error.message);
            return null;
        }
    }

    generateFingerprint(chromeMajor) {
        if (chromeMajor) {
            try {
                return this.fingerprintGenerator.getFingerprint({
                    browsers: [{ name: 'chrome', minVersion: chromeMajor, maxVersion: chromeMajor }],
                    devices: ['desktop'],
                    operatingSystems: [this.fingerprintOperatingSystem]
                });
            } catch (error) {
                // The generator's dataset does not include every Chromium major version.
                // Falling back preserves launch availability while making the mismatch visible.
                console.warn(`[BrowserLauncher] Exact Chrome ${chromeMajor} fingerprint unavailable:`, error.message);
            }
        }
        return this.fingerprintGenerator.getFingerprint();
    }

    // Inject cookies live into active browser instance
    async injectCookiesLive(browser, cookies) {
        if (!browser || !browser.isConnected() || !Array.isArray(cookies)) return;
        try {
            const pages = await browser.pages();
            for (const page of pages) {
                if (page.isClosed()) continue;
                for (const cookie of cookies) {
                    const cleanCookie = { ...cookie };
                    delete cleanCookie.partitionKey;
                    delete cleanCookie.sameParty;
                    await page.setCookie(cleanCookie);
                }
            }
            console.log(`[BrowserLauncher] Live-injected ${cookies.length} updated cookies into active pages.`);
        } catch (e) {
            console.warn(`[BrowserLauncher] Live cookie injection notice:`, e.message);
        }
    }

    // Launch an isolated profile
    async launchProfile(profileId, username = 'user') {
        if (this.activeBrowsers.has(profileId)) {
            console.log(`[BrowserLauncher] Profile ${profileId} is already running locally.`);
            return { status: 'already_running' };
        }

        const profile = await this.syncManager.getProfile(profileId);
        if (!profile) {
            throw new Error(`Profile '${profileId}' not found.`);
        }

        const executablePath = this.findChromePath();
        if (!profile.fingerprint || typeof profile.fingerprint !== 'object') {
            const chromeMajor = this.getChromeMajorVersion(executablePath);
            const generated = this.generateFingerprint(chromeMajor);
            profile.fingerprint = generated.fingerprint;
            profile.fingerprintHeaders = generated.headers;
            profile.fingerprintUpdatedAt = Date.now();
        }

        const profileDir = path.join(this.userDataPath, 'profiles', `profile_${profile.id}`);
        await fs.ensureDir(profileDir);

        const args = [
            `--user-data-dir=${profileDir}`,
            '--no-default-browser-check',
            '--disable-blink-features=AutomationControlled',
            '--test-type',
            '--disable-infobars'
        ];

        let proxyUser = '', proxyPass = '';
        if (profile.proxy && profile.proxy.trim() !== '') {
            const proxyCheck = await PreflightChecker.checkProxy(profile.proxy);
            if (!proxyCheck.ok) {
                throw new Error(`Проксі недоступний: ${proxyCheck.error || 'не вдалося встановити з’єднання'}. Запуск профілю скасовано задля безпеки.`);
            }
            const parsedProxy = PreflightChecker.parseProxy(profile.proxy);
            if (!parsedProxy) throw new Error('Некоректний формат проксі.');
            const host = parsedProxy.host.includes(':') ? `[${parsedProxy.host}]` : parsedProxy.host;
            args.push(`--proxy-server=${parsedProxy.protocol}://${host}:${parsedProxy.port}`);
            proxyUser = parsedProxy.user || '';
            proxyPass = parsedProxy.pass || '';

            // Prevent WebRTC from leaking the real IP outside the proxy tunnel
            args.push('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
            // Force loopback through the proxy too, closing the default bypass exemption
            args.push('--proxy-bypass-list=<-loopback>');

            if (!profile.timezone && proxyCheck.realTimezone) {
                profile.timezone = proxyCheck.realTimezone;
            }
        }

        // The fingerprint's UA is canonical. A profile-level free-form UA that differs from
        // navigator.userAgent is a detectable contradiction, so it is used only for legacy
        // profiles that do not yet have a valid fingerprint.
        const fingerprintUserAgent = profile.fingerprint?.navigator?.userAgent;
        let customUserAgent = typeof fingerprintUserAgent === 'string' && fingerprintUserAgent
            ? fingerprintUserAgent
            : profile.userAgent ? profile.userAgent.trim() : '';
        if (customUserAgent) profile.userAgent = customUserAgent;
        if (customUserAgent) {
            args.push(`--user-agent=${customUserAgent}`);
        }
        const fingerprintLocale = profile.fingerprintHeaders?.['accept-language']?.split(',')[0]
            || profile.fingerprint?.navigator?.language;
        if (typeof fingerprintLocale === 'string' && /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(fingerprintLocale)) {
            args.push(`--lang=${fingerprintLocale}`);
        }

        console.log(`[BrowserLauncher] Launching Chrome for profile: ${profile.name}`);

        const browser = await puppeteer.launch({
            executablePath,
            headless: false,
            defaultViewport: null,
            args,
            ignoreDefaultArgs: ['--disable-extensions', '--enable-automation']
        });

        const [page] = await browser.pages();

        // A successful Chrome launch is the earliest safe point to claim a profile. Claiming
        // later leaves a window in which another device can launch the same profile too.
        try {
            profile.activeHolder = await this.syncManager.setActiveHolder(profileId, username, true)
                || { username, deviceId: this.syncManager.deviceId, launchedAt: Date.now() };
        } catch (error) {
            await browser.close().catch(() => {});
            throw error;
        }

        // Register cleanup immediately. Setup below can still fail (proxy authentication,
        // navigation, or an extension error) after the lease has been claimed.
        browser.once('disconnected', () => {
            this.syncManager.setActiveHolder(profileId, username, false).catch(error => {
                console.warn(`[BrowserLauncher] Could not release early profile lease '${profile.name}':`, error.message);
            });
        });

        try {
            await this.syncManager.ensureProfileFingerprint(profile, username);
        } catch (error) {
            // Fingerprinting must not prevent a legitimate, already-leased browser launch.
            console.warn(`[BrowserLauncher] Fingerprint persistence notice:`, error.message);
        }

        const applyProfileIdentity = async (targetPage) => {
            if (!targetPage || targetPage.isClosed()) return;
            try {
                const fingerprint = profile.fingerprint;
                if (!fingerprint || typeof fingerprint !== 'object') throw new Error('Fingerprint профілю відсутній.');
                if (typeof this.fingerprintInjector.attachFingerprintToPuppeteerPage === 'function') {
                    await this.fingerprintInjector.attachFingerprintToPuppeteerPage(targetPage, fingerprint);
                } else if (typeof this.fingerprintInjector.attachFingerprintToPage === 'function') {
                    await this.fingerprintInjector.attachFingerprintToPage(targetPage, fingerprint);
                }
                if (profile.fingerprintHeaders && typeof profile.fingerprintHeaders === 'object') {
                    await targetPage.setExtraHTTPHeaders(profile.fingerprintHeaders);
                }
                if (proxyUser && proxyPass) {
                    await targetPage.authenticate({ username: proxyUser, password: proxyPass });
                }
                if (profile.timezone && profile.timezone.trim() !== '') {
                    await targetPage.emulateTimezone(profile.timezone.trim());
                }
                await targetPage.evaluateOnNewDocument(() => {
                    Object.defineProperty(navigator, 'webdriver', { get: () => false });
                });
            } catch (error) {
                console.warn(`[BrowserLauncher] Profile identity notice:`, error.message);
            }
        };

        await applyProfileIdentity(page);

        if (profile.cookies && Array.isArray(profile.cookies) && profile.cookies.length > 0) {
            await this.injectCookiesLive(browser, profile.cookies);
        }

        const targetUrl = profile.url || 'https://chatgpt.com';
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 }).catch(err => {
            console.warn(`[BrowserLauncher] Initial navigation notice: ${err.message}`);
        });

        // Read the complete Chrome cookie jar, not only cookies visible to the first tab.
        // A profile can gain session cookies on a warm-up or popup domain.
        const getAllCookies = async () => {
            const client = await page.target().createCDPSession();
            try {
                const { cookies } = await client.send('Network.getAllCookies');
                return cookies;
            } finally {
                await client.detach().catch(() => {});
            }
        };

        // Cookie sync is driven by browser activity and debounced. This eliminates a
        // permanent five-second polling loop while still coalescing redirect-heavy flows.
        let syncTimer = null;
        let lastReportedSyncError = null;
        const syncCurrentCookies = async () => {
            if (!browser.isConnected()) return;
            try {
                if (page.isClosed()) return;
                const currentCookies = await getAllCookies();
                if (!this.syncManager.hasCookieChanges(profileId, currentCookies)) return;
                profile.cookies = currentCookies;
                profile.updatedAt = Date.now();
                const saved = await this.syncManager.saveProfile(profile, username, { cloudMode: 'session' });
                if (saved.cloudSyncError) {
                    if (saved.cloudSyncError !== lastReportedSyncError && typeof this.onSyncError === 'function') {
                        lastReportedSyncError = saved.cloudSyncError;
                        this.onSyncError({
                            profileId,
                            profileName: profile.name,
                            error: saved.cloudSyncError
                        });
                    }
                    return;
                }
                lastReportedSyncError = null;
                console.log(`[BrowserLauncher] Periodically synced ${currentCookies.length} cookies for profile '${profile.name}'.`);
            } catch (err) {
                const msg = err.message || '';
                if (!msg.includes('Session closed') && !msg.includes('Target closed') && !msg.includes('Protocol error')) {
                    console.warn('[BrowserLauncher] Periodic cookie sync notice:', msg);
                }
            }
        };

        const scheduleCookieSync = () => {
            if (syncTimer) clearTimeout(syncTimer);
            syncTimer = setTimeout(() => {
                syncTimer = null;
                syncCurrentCookies();
            }, 1500);
        };

        const watchCookieChanges = (targetPage) => {
            if (!targetPage || targetPage.isClosed()) return;
            targetPage.on('response', scheduleCookieSync);
            targetPage.on('framenavigated', scheduleCookieSync);
        };

        watchCookieChanges(page);

        // Each new tab receives the same fingerprint, locale, timezone, headers and proxy
        // credentials before its next navigation, then participates in cookie detection.
        browser.on('targetcreated', async (target) => {
            try {
                if (target.type() === 'page') {
                    const newPage = await target.page();
                    await applyProfileIdentity(newPage);
                    watchCookieChanges(newPage);
                }
            } catch (error) {
                console.warn('[BrowserLauncher] New tab watcher notice:', error.message);
            }
        });

        // Real-time listener for remote updates from parallel colleagues
        const unsubscribe = this.syncManager.subscribeToProfile(profileId, async (remoteProfileData) => {
            if (remoteProfileData && remoteProfileData.cookies) {
                console.log(`[BrowserLauncher] Applying live remote cookies from colleague for profile '${profile.name}'...`);
                profile.cookies = remoteProfileData.cookies;
                profile.updatedAt = remoteProfileData.updatedAt || profile.updatedAt;
                await this.injectCookiesLive(browser, remoteProfileData.cookies);
            }
        });

        const leaseInterval = setInterval(() => {
            this.syncManager.heartbeatProfileLease(profileId).catch(error => {
                console.warn(`[BrowserLauncher] Profile lease heartbeat failed for '${profile.name}':`, error.message);
            });
        }, 60 * 1000);
        this.activeBrowsers.set(profileId, { browser, page, leaseInterval, unsubscribe, syncCurrentCookies });

        browser.on('disconnected', async () => {
            if (syncTimer) clearTimeout(syncTimer);
            clearInterval(leaseInterval);
            if (typeof unsubscribe === 'function') unsubscribe();
            this.activeBrowsers.delete(profileId);
            await this.syncManager.setActiveHolder(profileId, username, false).catch(error => {
                console.warn(`[BrowserLauncher] Could not release profile lease '${profile.name}':`, error.message);
            });
            console.log(`[BrowserLauncher] Browser for profile '${profile.name}' closed. Active holder cleared.`);
        });

        return { status: 'success', profileId };
    }

    // Automated Profile Warmup (Visits high-trust sites to build cookies & trust score)
    async warmupProfile(profileId, username = 'user') {
        const profile = await this.syncManager.getProfile(profileId);
        if (!profile) throw new Error('Профіль не знайдено.');

        const warmupSites = [
            'https://www.google.com',
            'https://www.youtube.com',
            'https://www.wikipedia.org',
            'https://www.reddit.com'
        ];

        console.log(`[BrowserLauncher] Starting automated Cookie Warmup for: ${profile.name}`);

        await this.launchProfile(profileId, username);
        const active = this.activeBrowsers.get(profileId);

        if (active && active.page) {
            for (const site of warmupSites) {
                if (active.page.isClosed()) break;
                console.log(`[Warmup] Visiting ${site}...`);
                await active.page.goto(site, { waitUntil: 'networkidle2', timeout: 30000 }).catch(e => {});
                await new Promise(r => setTimeout(r, 3000));
            }
            const finalCookies = await active.page.cookies().catch(e => []);
            console.log(`[Warmup] Completed. Warmed up ${finalCookies.length} cookies.`);
            await active.page.goto(profile.url || 'https://chatgpt.com', { waitUntil: 'networkidle2' }).catch(e => {});
        }

        return { status: 'warmed', profileId };
    }

    isProfileRunning(profileId) {
        return this.activeBrowsers.has(profileId);
    }

    // Used by the Electron shutdown path. Unlike a user killing Chrome directly, this still
    // has an active CDP connection and can persist the last cookie changes before closing it.
    async shutdown() {
        const active = Array.from(this.activeBrowsers.values());
        await Promise.all(active.map(async ({ browser, syncCurrentCookies }) => {
            await syncCurrentCookies().catch(() => {});
            await browser.close().catch(() => {});
        }));
    }
}

module.exports = BrowserLauncher;
