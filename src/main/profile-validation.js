const MAX_BACKUP_BYTES = 25 * 1024 * 1024;
const MAX_LOCAL_COOKIE_BYTES = 5 * 1024 * 1024;

function validateCookiesPayload(cookies) {
    if (!Array.isArray(cookies) || cookies.length > 5000) {
        throw new Error('Cookies мають бути масивом до 5 000 записів.');
    }
    if (Buffer.byteLength(JSON.stringify(cookies), 'utf8') > MAX_LOCAL_COOKIE_BYTES) {
        throw new Error('Cookies перевищують локальний ліміт 5 MB.');
    }
    return cookies;
}

function validateProfilePayload(profile, parseProxy) {
    if (!profile || typeof profile !== 'object') throw new Error('Некоректні дані профілю.');
    const id = typeof profile.id === 'string' ? profile.id.trim() : '';
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) {
        throw new Error('ID профілю може містити лише літери, цифри, _ та -.');
    }
    const name = typeof profile.name === 'string' ? profile.name.trim() : '';
    if (!name || name.length > 120) throw new Error('Назва профілю має містити від 1 до 120 символів.');

    if (typeof profile.url !== 'string') throw new Error('Некоректний URL профілю.');
    let url;
    try {
        url = new URL(profile.url);
    } catch (error) {
        throw new Error('Некоректний URL профілю.');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new Error('Профіль підтримує лише HTTP(S) URL без вбудованих облікових даних.');
    }

    const proxy = typeof profile.proxy === 'string' ? profile.proxy.trim() : '';
    if (proxy && typeof parseProxy === 'function' && !parseProxy(proxy)) {
        throw new Error('Некоректний формат проксі.');
    }
    const timezone = typeof profile.timezone === 'string' ? profile.timezone.trim() : '';
    if (timezone) {
        try {
            Intl.DateTimeFormat('en-US', { timeZone: timezone });
        } catch (error) {
            throw new Error('Некоректний часовий пояс профілю.');
        }
    }
    const userAgent = typeof profile.userAgent === 'string' ? profile.userAgent.trim() : '';
    if (userAgent.length > 2048) throw new Error('User-Agent не може перевищувати 2 048 символів.');

    return {
        id,
        name,
        url: url.toString(),
        proxy,
        userAgent,
        timezone,
        ...(profile.cookies === undefined ? {} : { cookies: validateCookiesPayload(profile.cookies) }),
        updatedAt: typeof profile.updatedAt === 'number' ? profile.updatedAt : Date.now()
    };
}

module.exports = {
    MAX_BACKUP_BYTES,
    MAX_LOCAL_COOKIE_BYTES,
    validateCookiesPayload,
    validateProfilePayload
};
