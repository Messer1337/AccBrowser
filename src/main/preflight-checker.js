const http = require('http');
const https = require('https');
const { URL } = require('url');
// https-proxy-agent / socks-proxy-agent ship as pure ESM in current major versions,
// so they're loaded via dynamic import() from this CommonJS file rather than require().

class PreflightChecker {
    static parseProxy(proxyStr) {
        if (!proxyStr || proxyStr.trim() === '') return null;
        const value = proxyStr.trim();

        // Legacy host:port:user:password is supported explicitly. All other forms are
        // delegated to WHATWG URL so IPv6 and percent-encoded credentials stay intact.
        const legacyParts = value.split(':');
        if (!value.includes('://') && !value.includes('@') && /^[^\[\]:]+:\d{1,5}:[^:]+:.+$/.test(value)) {
            const [host, port, user, ...passwordParts] = legacyParts;
            if (!host || !/^\d{1,5}$/.test(port) || !user || passwordParts.length === 0) return null;
            return { protocol: 'http', host, port, user, pass: passwordParts.join(':') };
        }

        try {
            const url = new URL(value.includes('://') ? value : `http://${value}`);
            const protocol = url.protocol.replace(':', '').toLowerCase();
            if (!['http', 'https', 'socks4', 'socks5'].includes(protocol) || !url.hostname || !url.port) {
                return null;
            }
            const port = Number(url.port);
            if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
            return {
                protocol,
                host: url.hostname,
                port: String(port),
                user: url.username ? decodeURIComponent(url.username) : undefined,
                pass: url.password ? decodeURIComponent(url.password) : undefined
            };
        } catch (e) {
            return null;
        }
    }

    static async createProxyAgent(proxyParsed) {
        const authStr = (proxyParsed.user && proxyParsed.pass)
            ? `${encodeURIComponent(proxyParsed.user)}:${encodeURIComponent(proxyParsed.pass)}@`
            : '';
        const host = proxyParsed.host.includes(':') ? `[${proxyParsed.host}]` : proxyParsed.host;
        const proxyUrl = `${proxyParsed.protocol}://${authStr}${host}:${proxyParsed.port}`;
        if (proxyParsed.protocol === 'socks4' || proxyParsed.protocol === 'socks5') {
            const { SocksProxyAgent } = await import('socks-proxy-agent');
            return new SocksProxyAgent(proxyUrl);
        }
        const { HttpsProxyAgent } = await import('https-proxy-agent');
        return new HttpsProxyAgent(proxyUrl);
    }

    static async checkProxy(proxyStr) {
        if (!proxyStr || proxyStr.trim() === '') {
            return { ok: true, type: 'direct', message: 'Пряме підключення (Без проксі)' };
        }
        const parsed = this.parseProxy(proxyStr);
        if (!parsed) {
            return { ok: false, error: 'Некоректний формат проксі. Очікується URL, host:port або legacy host:port:user:password.' };
        }
        const liveInfo = await this.fetchLiveProxyInfo(parsed);
        if (!liveInfo.ok) return { ok: false, error: liveInfo.error };
        return {
            ok: true,
            type: 'proxy',
            host: parsed.host,
            port: parsed.port,
            user: parsed.user || null,
            ip: liveInfo.ip,
            pingMs: liveInfo.pingMs || 0,
            country: liveInfo.country || '',
            message: `Проксі доступний (${parsed.host}:${parsed.port})`
        };
    }

    static async rotateProxyIp(rotateUrl, proxyStr) {
        if (!rotateUrl || rotateUrl.trim() === '') {
            return { ok: false, error: 'URL ротації IP не вказано.' };
        }
        let parsedTarget;
        try {
            parsedTarget = new URL(rotateUrl.trim());
        } catch (e) {
            return { ok: false, error: 'Некоректний URL ротації проксі.' };
        }

        try {
            await new Promise((resolve, reject) => {
                const client = parsedTarget.protocol === 'https:' ? https : http;
                const req = client.get(parsedTarget, { timeout: 10000 }, (res) => {
                    res.resume();
                    resolve();
                });
                req.on('error', err => reject(err));
                req.on('timeout', () => {
                    req.destroy();
                    reject(new Error('Час очікування ротації IP вичерпано (10s).'));
                });
            });
        } catch (err) {
            return { ok: false, error: `Помилка виклику ротації IP: ${err.message}` };
        }

        await new Promise(r => setTimeout(r, 1500));

        if (!proxyStr) return { ok: true, message: 'Запит ротації надіслано.' };
        const liveInfo = await this.checkProxy(proxyStr);
        if (!liveInfo.ok) {
            return { ok: false, error: `Ротацію виконано, але проксі недоступний: ${liveInfo.error}` };
        }
        return {
            ok: true,
            newIp: liveInfo.ip,
            message: `IP успішно змінено на ${liveInfo.ip}`
        };
    }

    // Perform REAL Network Ping via Proxy to ip-api.com
    static async fetchLiveProxyInfo(proxyParsed) {
        if (!proxyParsed) return { ok: false, error: 'Без проксі' };

        let agent;
        try {
            agent = await this.createProxyAgent(proxyParsed);
        } catch (e) {
            return { ok: false, error: 'Не вдалося ініціалізувати проксі-агент: ' + e.message };
        }

        const start = Date.now();
        return new Promise((resolve) => {
            try {
                const req = http.get('http://ip-api.com/json/', { agent, timeout: 6000 }, (res) => {
                    let raw = '';
                    res.on('data', chunk => raw += chunk);
                    res.on('end', () => {
                        const pingMs = Date.now() - start;
                        try {
                            const data = JSON.parse(raw);
                            if (data && data.status === 'success') {
                                resolve({
                                    ok: true,
                                    ip: data.query,
                                    country: `${data.country} (${data.city})`,
                                    timezone: data.timezone,
                                    pingMs
                                });
                            } else {
                                resolve({ ok: false, error: 'ip-api повернув статус помилки' });
                            }
                        } catch (e) {
                            resolve({ ok: false, error: 'Помилка парсингу JSON відповіді проксі' });
                        }
                    });
                });

                req.on('error', (err) => {
                    resolve({ ok: false, error: err.message });
                });

                req.on('timeout', () => {
                    req.destroy();
                    resolve({ ok: false, error: 'Перевищено час очікування (Timeout 6s)' });
                });
            } catch (e) {
                resolve({ ok: false, error: e.message });
            }
        });
    }

    static async checkUrlAccessibility(urlString, proxyString = '') {
        let target;
        try {
            target = new URL(urlString);
        } catch (e) {
            return { ok: false, error: 'Некоректний URL профілю.' };
        }
        if (!['http:', 'https:'].includes(target.protocol) || !target.hostname) {
            return { ok: false, error: 'Підтримуються лише HTTP(S) URL профілю.' };
        }
        if (target.hostname === 'localhost' || target.hostname.endsWith('.localhost') || /^(127\.|0\.0\.0\.0$|::1$)/.test(target.hostname)) {
            return { ok: false, error: 'Локальні адреси не дозволені для мережевої перевірки.' };
        }

        let agent;
        const proxy = this.parseProxy(proxyString);
        try {
            if (proxy) agent = await this.createProxyAgent(proxy);
        } catch (e) {
            return { ok: false, error: `Не вдалося ініціалізувати проксі: ${e.message}` };
        }

        return new Promise((resolve) => {
            const client = target.protocol === 'https:' ? https : http;
            const req = client.request(target, { method: 'HEAD', agent, timeout: 10000 }, (res) => {
                res.resume();
                resolve({ ok: res.statusCode >= 200 && res.statusCode < 500, statusCode: res.statusCode });
            });
            req.on('error', (err) => resolve({ ok: false, error: err.message }));
            req.on('timeout', () => {
                req.destroy();
                resolve({ ok: false, error: 'Перевищено час очікування URL (10s)' });
            });
            req.end();
        });
    }

    // Comprehensive Live Anti-Detect Health Diagnosis
    static async runFullHealthCheck(profile) {
        const warnings = [];
        let score = 100;
        let proxyIp = 'Не визначено';
        let country = 'Невідомо';
        let realTimezone = null;
        let timezoneMatch = true;

        const proxyParsed = this.parseProxy(profile.proxy);

        if (!proxyParsed) {
            warnings.push('⚠️ Проксі не вказано — використовується пряме домашнє IP-підключення.');
            return {
                ok: true,
                score: 50,
                statusBadge: '🟡 Пряме підключення (Без проксі)',
                proxyIp: 'Домашній IP',
                country: 'Локальна мережа',
                profileTimezone: profile.timezone || 'Системна',
                timezoneMatch: true,
                webrtcShield: false,
                warnings,
                checkedAt: Date.now()
            };
        }

        // Live Real Network Echo Ping
        const liveInfo = await this.fetchLiveProxyInfo(proxyParsed);

        if (!liveInfo.ok) {
            warnings.push(`❌ Помилка мережевого з'єднання з проксі: ${liveInfo.error}. Перевірте IP, порт та авторизацію.`);
            return {
                ok: false,
                score: 0,
                statusBadge: '🔴 Проксі недоступний або заблокований',
                proxyIp: `${proxyParsed.host}:${proxyParsed.port}`,
                country: 'Недоступно',
                profileTimezone: profile.timezone || 'Не вказано',
                timezoneMatch: false,
                webrtcShield: true,
                warnings,
                checkedAt: Date.now()
            };
        }

        // Live Network Success
        proxyIp = liveInfo.ip;
        country = liveInfo.country;
        realTimezone = liveInfo.timezone;

        // Compare real timezone with profile timezone
        if (profile.timezone && profile.timezone.trim() !== '') {
            const configuredTz = profile.timezone.trim();
            if (realTimezone && configuredTz.toLowerCase() !== realTimezone.toLowerCase()) {
                score -= 25;
                timezoneMatch = false;
                warnings.push(`⚠️ Незбіг часового поясу! Налаштовано: '${configuredTz}', Реальний IP проксі: '${realTimezone}'. Рекомендовано змінити часовий пояс профілю на '${realTimezone}'.`);
            }
        } else {
            score -= 15;
            timezoneMatch = false;
            warnings.push(`⚠️ У профілі не вказано часовий пояс. Реальний пояс проксі: '${realTimezone}'. Рекомендовано задати його для обходу Anti-Fraud.`);
        }

        let statusBadge = '🟢 100% Trust (Ідеально)';
        if (score < 60) {
            statusBadge = '🔴 Високий ризик блокування';
        } else if (score < 100) {
            statusBadge = '🟡 Середній ризик (Увага)';
        }

        return {
            ok: true,
            score,
            statusBadge,
            proxyIp: `${proxyIp} (${proxyParsed.host})`,
            country,
            profileTimezone: profile.timezone || 'Не вказано',
            realTimezone: realTimezone || 'Не визначено',
            timezoneMatch,
            webrtcShield: true,
            warnings,
            checkedAt: Date.now()
        };
    }
}

module.exports = PreflightChecker;
