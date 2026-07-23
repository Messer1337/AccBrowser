const http = require('http');
const https = require('https');
const { URL } = require('url');

class PreflightChecker {
    // Check if proxy works and returns correct IP
    static async checkProxy(proxyStr) {
        if (!proxyStr || proxyStr.trim() === '') {
            return { ok: true, type: 'direct', message: 'Пряме підключення (Без проксі)' };
        }

        try {
            // Basic parsing
            let host, port, user, pass;
            const str = proxyStr.trim();
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

            if (!host || !port) {
                return { ok: false, error: 'Некоректний формат проксі. Очікується host:port або host:port:user:pass' };
            }

            return {
                ok: true,
                type: 'proxy',
                host,
                port,
                user: user || null,
                message: `Проксі настроєно (${host}:${port})`
            };
        } catch (e) {
            return { ok: false, error: `Помилка парсингу проксі: ${e.message}` };
        }
    }

    // Check if target URL is alive and accessible
    static async checkUrlAccessibility(targetUrl) {
        return new Promise((resolve) => {
            try {
                const parsedUrl = new URL(targetUrl || 'https://chatgpt.com');
                const client = parsedUrl.protocol === 'https:' ? https : http;

                const req = client.request(parsedUrl.href, { method: 'HEAD', timeout: 5000 }, (res) => {
                    if (res.statusCode >= 200 && res.statusCode < 500) {
                        resolve({ ok: true, status: res.statusCode });
                    } else {
                        resolve({ ok: false, error: `Цільовий сайт повернув статус HTTP ${res.statusCode}` });
                    }
                });

                req.on('error', (err) => {
                    resolve({ ok: false, error: `Не вдалося підключитися до ${parsedUrl.hostname}: ${err.message}` });
                });

                req.on('timeout', () => {
                    req.destroy();
                    resolve({ ok: false, error: `Перевищено час очікування (Timeout) при підключенні до ${parsedUrl.hostname}` });
                });

                req.end();
            } catch (e) {
                resolve({ ok: false, error: `Некоректний URL: ${e.message}` });
            }
        });
    }
}

module.exports = PreflightChecker;
