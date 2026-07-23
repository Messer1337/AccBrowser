# 🏝️ OASIS Browser

> **Next-Gen Multi-Account Isolated Profile Platform with Cloud Sync & Anti-Detection Protection**

![OASIS Browser Banner](assets/icon.png)

[![Electron](https://img.shields.io/badge/Electron-30.5.1-47848F?style=for-the-badge&logo=electron)](https://www.electronjs.org/)
[![Firebase](https://img.shields.io/badge/Firebase-Cloud_Firestore-FFCA28?style=for-the-badge&logo=firebase)](https://firebase.google.com/)
[![Puppeteer](https://img.shields.io/badge/Puppeteer-Anti__Detect-40B5A4?style=for-the-badge&logo=puppeteer)](https://pptr.dev/)
[![Platform](https://img.shields.io/badge/Platform-macOS_%7C_Windows-000000?style=for-the-badge&logo=apple)](https://github.com/Messer1337/AccBrowser)

---

## ✨ Основні Можливості (Key Features)

### 🛡 1. Повний захист від відбитків (Anti-Detect & Stealth)
* **Fingerprint Injection**: Динамічне заміщення Canvas, WebGL, AudioContext, User-Agent та системних характеристик через `fingerprint-generator` & `fingerprint-injector`.
* **WebRTC Leak Protection**: Захист від витоку справжньої локальної/зовнішньої IP-адреси через прапор `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`.
* **Proxy Isolation & Fail-Closed**: Підтримка HTTP / HTTPS / SOCKS5 проксі з автоматичною автентифікацією та закритим тунелюванням (`--proxy-bypass-list=<-loopback>`).
* **Timezone Emulation**: Автоматична та ручна синхронізація часового поясу браузера з геолокацією проксі (`page.emulateTimezone`).

### ⚡ 2. Хмарна синхронізація у реальному часі (Real-time Cloud Sync)
* **Спільний доступ команди**: Профілі, кукі авторизації та активний стан синхронізуються між пристроями команди через **Google Cloud Firestore**.
* **Запобігання конфліктам**: Індикатор **Active Holder** попереджає, якщо колега вже працює в даному профілі паралельно.
* **Smart Cookie Trimming**: Автоматична фільтрація рекламних трекерів (`_ga`, `_fbp` тощо) для дотримання квоти в 1MB у Firestore без втрати сесійних токенів.

### 👥 3. Управління командою та правами (RBAC Access Control)
* **Ролі Admin та Worker**: Повний контроль адміністратора над створенням користувачів та призначенням доступів.
* **Персональні дозволи**: Гнучка налаштування прапорцями — співробітник бачить та запускає **тільки ті профілі**, які йому відмітив Admin.

### 🎨 4. Преміальний UI (Multi-Theme System)
* **4 колірні теми**:
  * 🌌 **Oasis Cyber** (Neon Indigo)
  * 🌴 **Oasis Emerald** (Tropical Cyan)
  * 🌅 **Oasis Sunset** (Gold & Rose)
  * 🖤 **Oasis Midnight** (Cyberpunk OLED)
* **Glassmorphism Design**: Сучасний інтерфейс з Backdrop Blur, неоновими підсвічуваннями та мікро-анімаціями.

### 🔥 5. Авто-прогрів акаунтів (Account Warmup)
* Автоматизований фоновий візит до високонадійних сайтів (*Google, YouTube, Reddit, Wikipedia*) для формування реальної історії браузера та Trust Score перед логіном.

### 🔒 6. Зашифрований бекап (.oasisbak)
* Резервне копіювання в один клік із шифруванням **AES-256-GCM** на основі пароля (PBKDF2).

### 🚀 7. Автоматичні оновлення (Auto-Updates)
* Фонова перевірка та завантаження нових версій через **`electron-updater`** + **Firebase Hosting**.

---

## 🛠 Технологічний стек (Tech Stack)

* **Core Framework**: Electron 30, Node.js, JavaScript (ES6+).
* **Browser Automation**: Puppeteer-extra, Stealth Plugin.
* **Database & Cloud**: Firebase Authentication, Cloud Firestore, Firebase Hosting.
* **Security & Crypto**: AES-256-GCM, SHA-256, PBKDF2, Crypto API.
* **Build System**: Electron Builder (`x64`, `arm64` macOS ZIP & Windows NSIS / Portable).

---

## 🚀 Швидкий старт (Quick Start)

### 1. Клонування репозиторію
```bash
git clone https://github.com/Messer1337/AccBrowser.git
cd AccBrowser
```

### 2. Встановлення залежностей
```bash
npm install
```

### 3. Запуск у режимі розробки
```bash
npm start
```

---

## 📦 Збірка та Публікація (Build & Release)

### Локальна збірка для всіх платформ (macOS ZIP + Windows EXE):
```bash
npm run build
```
*Згенеровані файли будуть знаходитися у папці `dist/`.*

### Повний реліз та публікація оновлень у хмару:
```bash
npm run release
```
*Автоматично збере додатки, відфільтрує артефакти та задеплоїть оновлення на Firebase Hosting.*

---

## 🔐 Налаштування Firebase (Firebase Setup)

1. У **Firebase Console ➔ Authentication**: увімкніть провайдер **Email/Password**.
2. У **Firebase Console ➔ Firestore Database ➔ Rules**: опублікуйте вміст файлу `firestore.rules`.
3. У колекцію `authorizedUsers` додайте UID вашого admin-користувача:
   ```json
   {
     "username": "admin",
     "role": "admin"
   }
   ```

---

## 📜 Ліцензія

Приватна розробка для внутрішнього використання команди. Всі права захищено © 2026 **OASIS Browser Team**.
