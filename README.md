# 🏝️ OASIS Browser Enterprise Platform

> **Production-Grade Multi-Account Anti-Detect Browser Platform featuring Server-Authoritative Architecture, Real-Time WebSocket Synchronization, Single-Admin Security Model, Workspaces/Folders Organization & Live Proxy Health Dashboard.**

![OASIS Browser Banner](assets/icon.png)

[![Electron](https://img.shields.io/badge/Electron-43.2.0-47848F?style=for-the-badge&logo=electron)](https://www.electronjs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=for-the-badge&logo=postgresql)](https://www.postgresql.org/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-Realtime_Sync-010101?style=for-the-badge&logo=socketdotio)](https://socket.io/)
[![Puppeteer](https://img.shields.io/badge/Puppeteer-Anti__Detect-40B5A4?style=for-the-badge&logo=puppeteer)](https://pptr.dev/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=for-the-badge&logo=docker)](https://www.docker.com/)
[![Platform](https://img.shields.io/badge/Platform-macOS_%7C_Windows-000000?style=for-the-badge&logo=apple)](https://github.com/Messer1337/AccBrowser)

---

## 📐 Архітектура системи (System Architecture)

OASIS Browser побудовано за **серверно-авторитарною архітектурою**. Всі критичні дані (користувачі, ролі, профілі, сесійні кукі, папки/теги, лізинг та журнал аудіту) зберігаються у захищеній хмарній базі даних **PostgreSQL** на вашому самостійно розгорнутому сервері.

Клієнтський додаток (Electron) працює як безпечне середовище виконання ("executor"), що взаємодіє з сервером через REST API та WebSockets.

```
┌─────────────────────────────────────────────────────────┐
│              OASIS Browser Client (Electron)            │
│  - Chromium Execution Engine (Puppeteer Extra)          │
│  - Live Cookie Injector & WebRTC Leak Shield            │
│  - Workspaces/Folders & Live Proxy Health Dashboard     │
└────────────┬─────────────────────────────▲──────────────┘
             │ HTTP / REST                 │ WebSockets
             ▼                             │ (Socket.IO)
┌──────────────────────────────────────────┴──────────────┐
│             Self-Hosted Server (Express + Caddy)        │
│  - Single-Admin Security Guard                          │
│  - Preflight Proxy Health Checker                       │
│  - Multi-Device Concurrent Lease Manager                │
└────────────┬────────────────────────────────────────────┘
             │ SQL Queries
             ▼
┌─────────────────────────────────────────────────────────┐
│             PostgreSQL 16 Enterprise Database           │
└─────────────────────────────────────────────────────────┘
```

---

## ✨ Основні Функціональні Можливості (Key Features)

### 👑 1. Жорсткий захист Єдиного Адміністратора (Single-Admin Lock)
- **Унікальність Адміна**: В БД існує фізично лише **1 Адміністратор** (створюється при ініціалізації сервера).
- **Захист від підробки ролей**: Будь-які спроби створити другого адміна (`role: 'admin'`), змінити роль існуючого адміна чи видалити його блокуються сервером (`400 Bad Request`).
- **Співробітники (`role: 'user'`)**: Створюються Адміністратором і бачать тільки призначені їм профілі (`allowedProfiles`).

### 📁 2. Папки, Теги та Проекти (Workspaces & Folders)
- **Групування профілів**: Сортування акаунтів за проектами чи командами (наприклад: `Crypto Airdrops`, `Facebook Ads Team 1`, `Google Merchant`).
- **Теги**: Гнучке маркування акаунтів (наприклад: `#FB`, `#US`, `#Main`, `#TeamA`).
- **Швидка фільтрація**: Вибір папки у випадаючому списку та швидкий пошук в реальному часі за назвою або тегами.

### ⚡ 3. Моніторинг стану та пінгу проксі (Live Proxy Health Dashboard)
- **Вимірювання пінгу (Latency in ms)**: Автоматичне вимірювання затримки підключення через кожен проксі.
- **Індикація на картках**: Плашка статусу прямо на картці профілю (`🟢 95ms (US)` або `🔴 Офлайн`).
- **Кнопка "⚡ Перевірити проксі"**: Одночасна паралельна діагностика всіх профілів у 1 клік з виводом підсумкового звіту.

### ⚡ 4. Паралельна робота з 1 профілю & Live Cookie Sync
- **Одночасний запуск з різних ПК**: Декілька співробітників можуть **одночасно працювати з одного й того ж профілю**.
- **Єдиний проксі та відбиток**: Усі пристрої підключаються через **один і той же проксі-сервер** з однаковими цифровими відбитками (User-Agent, мова, часовий пояс).
- **Впорскування кукі у реальному часі**: Нові кукі синхронізуються через WebSockets та **впорскуються (live-inject) у відкриті вкладки Chrome** на інших пристроях без перезапуску браузера.

### 📲 5. Ротація мобільних проксі в 1 клік (Mobile Proxy IP Rotation)
- **Change IP Link**: Можливість задати для профілю посилання для примусової ротації IP (`proxyRotateUrl`).
- **Кнопка "🔄 Ротація IP"**: Натискання надсилає HTTP-запит до мобільного проксі-провайдера, перевіряє новий IP через `PreflightChecker` і виводить актуальну геолокацію та IP на картці.

### 🛡️ 6. Обов'язкова перевірка проксі & WebRTC Shielding
- **Preflight Live Proxy Ping**: Перед запуском Chrome виконується обов'язкова перевірка доступності проксі. Якщо проксі недоступний — **Chrome НЕ відкривається**, унеможливлюючи витік вашої реальної IP-адреси.
- **Захист від WebRTC-витоків**: Прапори `--force-webrtc-ip-handling-policy=disable_non_proxied_udp` унеможливлюють витік локального/зовнішнього IP.
- **Auto-Timezone Alignment**: Автоматичне узгодження часового поясу браузера з реальним IP проксі.

---

## 🛠 Технологічний стек (Tech Stack)

| Компонент | Технології |
| :--- | :--- |
| **Backend** | Node.js 22, Express, PostgreSQL 16, Socket.IO, node-pg-migrate, Caddy |
| **Client App** | Electron 43, JavaScript (ES6+), Puppeteer-core |
| **Fingerprinting** | fingerprint-generator, fingerprint-injector, Stealth Plugins |
| **Security** | Scrypt, JWT, Timing-Safe Equality, Express Rate Limit, Helmet |
| **DevOps** | Docker Compose, Caddy Reverse Proxy, Automated Postgres Backup (`pg_dump`) |

---

## 🚀 Швидкий старт (Quick Start & Deployment)

### 1. Розгортання Self-Hosted Сервера (Docker Compose)

Створіть файл `.env` на вашому VPS:
```env
POSTGRES_DB=oasis
POSTGRES_USER=oasis
POSTGRES_PASSWORD=SuperSecretDbPassword123!
JWT_SECRET=SuperSecretJwtKeyMinimum64HexCharactersLongHereForProductionUse!
ADMIN_USERNAME=admin
ADMIN_PASSWORD=AdminInitialPassword123!
OASIS_DOMAIN=your-domain.com
```

Запустіть контейнери:
```bash
docker compose up -d --build
```

### 2. Запуск клієнтського додатка (Electron Client)

```bash
git clone https://github.com/Messer1337/AccBrowser.git
cd AccBrowser
npm install
./start-selfhosted.sh
```

---

## 📦 Збірка Інсталяторів (Build & Packaging)

```bash
npm run build
```
*Згенеровані інсталятори розміщуються у папці `dist/`.*

---

## 📜 Ліцензія

Приватна розробка для внутрішнього використання команди. Всі права захищено © 2026 **OASIS Browser Team**.
