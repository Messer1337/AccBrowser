const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const { FingerprintGenerator } = require('fingerprint-generator');
const { FingerprintInjector } = require('fingerprint-injector');

class BrowserLauncher {
    constructor(userDataPath, syncManager) {
        this.userDataPath = userDataPath;
        this.syncManager = syncManager;
        this.activeBrowsers = new Map(); // id -> { browser, page, syncInterval, unsubscribe }
        this.fingerprintGenerator = new FingerprintGenerator({
            browsers: [{ name: 'chrome', minVersion: 120 }],
            devices: ['desktop'],
            operatingSystems: ['windows', 'macos']
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

        // Set active holder in SyncManager
        await this.syncManager.setActiveHolder(profileId, username, true);

        const executablePath = this.findChromePath();

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
            let proxyStr = profile.proxy.trim();
            if (proxyStr.includes('@')) {
                const [userPass, hostPort] = proxyStr.split('@');
                const [u, p] = userPass.split(':');
                proxyUser = u;
                proxyPass = p;
                args.push(`--proxy-server=http://${hostPort}`);
            } else {
                const parts = proxyStr.split(':');
                if (parts.length === 4) {
                    args.push(`--proxy-server=http://${parts[0]}:${parts[1]}`);
                    proxyUser = parts[2];
                    proxyPass = parts[3];
                } else {
                    args.push(`--proxy-server=http://${proxyStr}`);
                }
            }

            // Prevent WebRTC from leaking the real IP outside the proxy tunnel
            args.push('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
            // Force loopback through the proxy too, closing the default bypass exemption
            args.push('--proxy-bypass-list=<-loopback>');
        }

        let customUserAgent = profile.userAgent ? profile.userAgent.trim() : '';
        if (customUserAgent) {
            args.push(`--user-agent=${customUserAgent}`);
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

        try {
            const { fingerprint } = this.fingerprintGenerator.getFingerprint();
            if (typeof this.fingerprintInjector.attachFingerprintToPuppeteerPage === 'function') {
                await this.fingerprintInjector.attachFingerprintToPuppeteerPage(page, fingerprint);
            } else if (typeof this.fingerprintInjector.attachFingerprintToPage === 'function') {
                await this.fingerprintInjector.attachFingerprintToPage(page, fingerprint);
            }
            console.log(`[BrowserLauncher] Anti-detection fingerprint injected successfully.`);
        } catch (fErr) {
            console.warn(`[BrowserLauncher] Fingerprint notice:`, fErr.message);
        }

        if (proxyUser && proxyPass) {
            await page.authenticate({ username: proxyUser, password: proxyPass });
            console.log(`[BrowserLauncher] Proxy authentication set for: ${proxyUser}`);
        }

        // Keep the reported timezone consistent with the proxy's geography (avoids fraud-score mismatches)
        if (profile.timezone && profile.timezone.trim() !== '') {
            try {
                await page.emulateTimezone(profile.timezone.trim());
                console.log(`[BrowserLauncher] Timezone emulated: ${profile.timezone}`);
            } catch (tzErr) {
                console.warn(`[BrowserLauncher] Invalid timezone '${profile.timezone}':`, tzErr.message);
            }
        }

        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });

        // Setup Logout Blocker & Interception
        const setupLogoutBlocker = async (targetPage) => {
            if (!targetPage || targetPage.isClosed()) return;
            try {
                if (!targetPage._requestInterceptionEnabled) {
                    await targetPage.setRequestInterception(true);
                    targetPage.on('request', (req) => {
                        const url = req.url().toLowerCase();
                        const logoutKeywords = ['/logout', '/signout', '/log_out', '/sign_out', 'auth/logout', 'accounts/logout'];
                        const isLogout = logoutKeywords.some(kw => url.includes(kw));

                        if (isLogout) {
                            console.warn(`[LogoutBlocker] Blocked accidental logout attempt: ${req.url()}`);
                            return req.abort('blockedbyclient');
                        }
                        req.continue();
                    });
                }
            } catch (e) {}
        };

        await setupLogoutBlocker(page);

        browser.on('targetcreated', async (target) => {
            try {
                if (target.type() === 'page') {
                    const newPage = await target.page();
                    if (newPage) await setupLogoutBlocker(newPage);
                }
            } catch (e) {}
        });

        if (profile.cookies && Array.isArray(profile.cookies) && profile.cookies.length > 0) {
            await this.injectCookiesLive(browser, profile.cookies);
        }

        const targetUrl = profile.url || 'https://chatgpt.com';
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 }).catch(err => {
            console.warn(`[BrowserLauncher] Initial navigation notice: ${err.message}`);
        });

        // Periodic Local Cookie Sync
        const syncCurrentCookies = async () => {
            if (!browser.isConnected()) return;
            try {
                if (page.isClosed()) return;
                const currentCookies = await page.cookies();
                profile.cookies = currentCookies;
                profile.updatedAt = Date.now();
                await this.syncManager.saveProfile(profile, username);
                console.log(`[BrowserLauncher] Periodically synced ${currentCookies.length} cookies for profile '${profile.name}'.`);
            } catch (err) {
                const msg = err.message || '';
                if (!msg.includes('Session closed') && !msg.includes('Target closed') && !msg.includes('Protocol error')) {
                    console.warn('[BrowserLauncher] Periodic cookie sync notice:', msg);
                }
            }
        };

        // Short interval is cheap now — saveProfile skips the Firestore write when the cookie hash is unchanged
        const syncInterval = setInterval(syncCurrentCookies, 5000);

        // Real-time listener for remote updates from parallel colleagues
        const unsubscribe = this.syncManager.subscribeToProfile(profileId, async (remoteProfileData) => {
            if (remoteProfileData && remoteProfileData.cookies) {
                console.log(`[BrowserLauncher] Applying live remote cookies from colleague for profile '${profile.name}'...`);
                await this.injectCookiesLive(browser, remoteProfileData.cookies);
            }
        });

        this.activeBrowsers.set(profileId, { browser, page, syncInterval, unsubscribe });

        browser.on('disconnected', async () => {
            clearInterval(syncInterval);
            // Best-effort final flush; the CDP session may already be gone by this point,
            // but the 5s interval above means at most one cycle's worth of cookies is at risk anyway.
            await syncCurrentCookies();
            if (typeof unsubscribe === 'function') unsubscribe();
            this.activeBrowsers.delete(profileId);
            await this.syncManager.setActiveHolder(profileId, username, false);
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
}

module.exports = BrowserLauncher;
