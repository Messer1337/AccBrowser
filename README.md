# 🏝️ OASIS Browser

> **Next-Gen Multi-Account Isolated Profile Platform with Server-Authoritative Architecture, Real-Time Sync & Anti-Detection Protection**

![OASIS Browser Banner](assets/icon.png)

[![Electron](https://img.shields.io/badge/Electron-43.2.0-47848F?style=for-the-badge&logo=electron)](https://www.electronjs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=for-the-badge&logo=postgresql)](https://www.postgresql.org/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-Realtime_Sync-010101?style=for-the-badge&logo=socketdotio)](https://socket.io/)
[![Puppeteer](https://img.shields.io/badge/Puppeteer-Anti__Detect-40B5A4?style=for-the-badge&logo=puppeteer)](https://pptr.dev/)
[![Platform](https://img.shields.io/badge/Platform-macOS_%7C_Windows-000000?style=for-the-badge&logo=apple)](https://github.com/Messer1337/AccBrowser)

---

## ✨ Основні Можливості (Key Features)

### 🖥️ 1. Серверно-Авторитарна Архітектура (Server-Authoritative Backend)
* **Сервер як джерело правди**: База даних PostgreSQL, аутентифікація користувачів, профілі браузера, кукі сесій та лізинг зберігаються на сервері.
* **Браузер як виконавець**: Клієнтський Electron-додаток працює виключно як виконавець ("executor"). При запуску він одразу показує екран входу без локальних налаштувань чи створення адміна.

### 👑 2. Жорсткий захист Єдиного Адміністратора (Single-Admin Enforcement)
* **Унікальний Адмін**: У системі фізично існує лише **1 Адміністратор** (створюється під час первинної ініціалізації сервера).
* **Анти-підробка ролей**: Будь-які спроби створити другого адміна (`role: 'admin'`), підвищити привілеїв працівника або видалити/змінити єдиного адміна відхиляються сервером (`400 Bad Request`).

### ⚡ 3. Паралельна робота команди з розгалуженим Live-Sync
* **Одночасна робота з 1 профілю**: Декілька пристроїв/колег можуть **одночасно працювати з одного й того ж профілю**.
* **Єдиний проксі та відбиток**: Усі ПК підключаються через **один і той же проксі** з **однаковим фінгерпринтом** (User-Agent, мова, часовий пояс, заголовки). Для цільових сайтів усі запити йдуть з однієї зовнішньої IP-адреси.
* **Синхронізація у реальному часі**: Нові кукі синхронізуються через WebSockets та **live-inject'яться у відкритий браузер Chrome** на інших пристроях без перезапуску.

### 📲 4. Ротація мобільних проксі в 1 клік (Mobile Proxy IP Rotation)
* **Підтримка Change IP Link**: Для кожного профілю можна задати **"URL зміни IP (Мобільний проксі)"** (`proxyRotateUrl`).
* **Кнопка "🔄 Ротація IP"**: На картці профілю додано кнопку ротації. Натискання надсилає HTTP-запит до мобільного проксі-провайдера, виконує мережевий ping (`PreflightChecker`) та відображає новий отриманий IP у сповіщенні.

### 🛡️ 5. Обов'язкова перевірка проксі та WebRTC Shielding
* **Preflight Proxy Check**: Перед запуском Chrome виконується перевірка працездатності проксі. Якщо проксі недоступний — **Chrome НЕ відкривається**, запобігаючи витоку реального IP.
* **WebRTC Protection**: Прапори `--force-webrtc-ip-handling-policy=disable_non_proxied_udp` унеможливлюють витік локального/зовнішнього IP через WebRTC.
* **Auto-Timezone Alignment**: Часовий пояс профілю автоматично вирівнюється під географію проксі для обходу Anti-Fraud систем.

### 👥 6. Суворе розмежування прав (RBAC Access Control)
* **Адмін та Співробітники (`role: 'user'`)**: Адмін створює акаунти працівників та визначає масив дозволених профілів (`allowedProfiles`).
* **Ізоляція ресурсів**: Співробітники бачать та запускають **тільки свої профілі**, не мають доступу до адмін-функцій чи налаштувань проксі.

### 🔒 7. Кібербезпека & Red-Teamed Hardening
* Хешування Scrypt з 16-байтовою сілью, 24h JWT токени.
* Динамічна перевірка авторизації в БД при кожному HTTP / WebSocket запиті.
* Суворий Rate Limiting на авторизації (макс. 15 спроб входу на 15 хвилин).
* Обмеження розмірів payloads (700KB кукі, 50KB відбиток).

---

## 🛠 Технологічний стек (Tech Stack)

* **Backend Server**: Node.js 22, Express, PostgreSQL 16, Socket.IO, node-pg-migrate, Caddy.
* **Client App**: Electron 43, Node.js, JavaScript (ES6+).
* **Browser Automation & Stealth**: Puppeteer-core, fingerprint-generator, fingerprint-injector.
* **Security & Auth**: Scrypt, JWT, Timing-Safe Equality, Helmet, Express Rate Limit.
* **Containerization & Deployment**: Docker Compose, Caddy Reverse Proxy, Automated Postgres Backup.

---

## 🚀 Швидкий старт (Quick Start)

### 1. Запуск Self-Hosted Сервера (Docker Compose)

Створіть файл `.env` у корені проекту на вашому VPS:
```env
POSTGRES_DB=oasis
POSTGRES_USER=oasis
POSTGRES_PASSWORD=SuperSecretDbPassword123!
JWT_SECRET=SuperSecretJwtKeyMinimum64HexCharactersLongHereForProductionUse!
ADMIN_USERNAME=admin
ADMIN_PASSWORD=AdminInitialPassword123!
```

Запустіть сервер:
```bash
docker compose up -d --build
```

### 2. Клонування та Запуск Клієнтського Додатка (Electron)

```bash
git clone https://github.com/Messer1337/AccBrowser.git
cd AccBrowser
npm install
./start-selfhosted.sh
```

---

## 📦 Збірка та Публікація (Build & Release)

```bash
npm run build
```
*Згенеровані інсталятори (macOS ZIP / Windows NSIS EXE) будуть розміщені у папці `dist/`.*

---

## 📜 Ліцензія

Приватна розробка для внутрішнього використання команди. Всі права захищено © 2026 **OASIS Browser Team**.
