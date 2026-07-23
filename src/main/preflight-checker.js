const http = require('http');
const https = require('https');
const { URL } = require('url');
// https-proxy-agent / socks-proxy-agent ship as pure ESM in current major versions,
// so they're loaded via dynamic import() from this CommonJS file rather than require().

class PreflightChecker {
    static parseProxy(proxyStr) {
        if (!proxyStr || proxyStr.trim() === '') return null;
        const str = proxyStr.trim();
        let protocol = 'http';
        let cleanStr = str;
        if (str.startsWith('socks5://') || str.startsWith('socks4://')) {
            protocol = 'socks5';
            cleanStr = str.replace(/socks5:\/\//i, '').replace(/socks4:\/\//i, '');
        } else if (str.startsWith('http://') || str.startsWith('https://')) {
            cleanStr = str.replace(/https?:\/\//i, '');
        }

        let host, port, user, pass;
        if (cleanStr.includes('@')) {
            const [auth, hp] = cleanStr.split('@');
            [user, pass] = auth.split(':');
            [host, port] = hp.split(':');
        } else {
            const parts = cleanStr.split(':');
            if (parts.length === 4) {
                [host, port, user, pass] = parts;
            } else if (parts.length === 2) {
                [host, port] = parts;
            }
        }
        return (host && port) ? { protocol, host, port, user, pass } : null;
    }

    static async checkProxy(proxyStr) {
        if (!proxyStr || proxyStr.trim() === '') {
            return { ok: true, type: 'direct', message: 'Пряме підключення (Без проксі)' };
        }
        const parsed = this.parseProxy(proxyStr);
        if (!parsed) {
            return { ok: false, error: 'Некоректний формат проксі. Очікується host:port або user:pass@host:port' };
        }
        return {
            ok: true,
            type: 'proxy',
            host: parsed.host,
            port: parsed.port,
            user: parsed.user || null,
            message: `Проксі настроєно (${parsed.host}:${parsed.port})`
        };
    }

    // Perform REAL Network Ping via Proxy to ip-api.com
    static async fetchLiveProxyInfo(proxyParsed) {
        if (!proxyParsed) return { ok: false, error: 'Без проксі' };

        let agent;
        try {
            const authStr = (proxyParsed.user && proxyParsed.pass) ? `${proxyParsed.user}:${proxyParsed.pass}@` : '';
            const proxyUrl = `${proxyParsed.protocol}://${authStr}${proxyParsed.host}:${proxyParsed.port}`;

            if (proxyParsed.protocol === 'socks5') {
                const { SocksProxyAgent } = await import('socks-proxy-agent');
                agent = new SocksProxyAgent(proxyUrl);
            } else {
                const { HttpsProxyAgent } = await import('https-proxy-agent');
                agent = new HttpsProxyAgent(proxyUrl);
            }
        } catch (e) {
            return { ok: false, error: 'Не вдалося ініціалізувати проксі-агент: ' + e.message };
        }

        return new Promise((resolve) => {
            try {
                const req = http.get('http://ip-api.com/json/', { agent, timeout: 6000 }, (res) => {
                    let raw = '';
                    res.on('data', chunk => raw += chunk);
                    res.on('end', () => {
                        try {
                            const data = JSON.parse(raw);
                            if (data && data.status === 'success') {
                                resolve({
                                    ok: true,
                                    ip: data.query,
                                    country: `${data.country} (${data.city})`,
                                    timezone: data.timezone
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
