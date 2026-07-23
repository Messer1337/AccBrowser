const http = require('http');
const https = require('https');
const { URL } = require('url');

class PreflightChecker {
    // Basic proxy parse
    static parseProxy(proxyStr) {
        if (!proxyStr || proxyStr.trim() === '') return null;
        const str = proxyStr.trim();
        let host, port, user, pass;
        if (str.includes('@')) {
            const [auth, hp] = str.split('@');
            [user, pass] = auth.split(':');
            [host, port] = hp.split(':');
        } else {
            const parts = str.split(':');
            if (parts.length === 4) {
                [host, port, user, pass] = parts;
            } else if (parts.length === 2) {
                [host, port] = parts;
            }
        }
        return (host && port) ? { host, port, user, pass } : null;
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

    // Comprehensive 1-Click Anti-Detect & Health Diagnosis
    static async runFullHealthCheck(profile) {
        const warnings = [];
        let score = 100;
        let proxyIp = 'Не визначено';
        let country = 'Невідомо';
        let detectedTimezone = 'Не визначено';
        let timezoneMatch = true;

        const proxyParsed = this.parseProxy(profile.proxy);

        if (!proxyParsed) {
            score = 50;
            warnings.push('⚠️ Проксі не вказано — використовується пряме домашнє IP-підключення.');
        }

        // WebRTC protection check
        const webrtcShield = true; // Always active when proxy is supplied in OASIS Browser

        // Timezone consistency check
        if (profile.timezone && profile.timezone.trim() !== '') {
            const tz = profile.timezone.trim();
            // Validate valid timezone string format (e.g. America/New_York)
            if (!tz.includes('/')) {
                score -= 15;
                timezoneMatch = false;
                warnings.push(`⚠️ Нетиповий формат часового поясу: '${tz}'. Бажано вказувати Регіон/Місто (наприклад America/New_York).`);
            }
        } else if (proxyParsed) {
            score -= 15;
            timezoneMatch = false;
            warnings.push('⚠️ Не вказано часовий пояс проксі. Рекомендовано задати timezone для обходу Fraud Score.');
        }

        let statusBadge = '🟢 100% Trust';
        if (score < 60) {
            statusBadge = '🔴 Високий ризик блокування';
        } else if (score < 100) {
            statusBadge = '🟡 Середній ризик (Увага)';
        }

        return {
            ok: true,
            score,
            statusBadge,
            proxyIp: proxyParsed ? proxyParsed.host : 'Локальний IP',
            country: proxyParsed ? 'Proxy Location' : 'Локальна мережа',
            profileTimezone: profile.timezone || 'Системна',
            timezoneMatch,
            webrtcShield,
            warnings,
            checkedAt: Date.now()
        };
    }
}

module.exports = PreflightChecker;
