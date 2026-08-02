# 🛡️ OASIS Browser Enterprise Backend Engine

> **Server-Authoritative Backend Microservice for OASIS Anti-Detect Browser Platform with PostgreSQL, Socket.IO Real-Time Cookie Sync & Single-Admin Security Model.**

---

## 📐 Архітектура та Можливості (Overview)

Самостійно керований (Self-Hosted) сервер забезпечує повний контроль над даними команди:
* **Single-Admin Enforcement**: Фізично підтримується лише 1 Адміністратор. Спроби створення додаткових адмінів блокуються.
* **Multi-Device Concurrent Profiles**: Декілька пристроїв можуть відкривати один і той же профіль під єдиним проксі.
* **WebSocket Real-Time Cookie Injection**: Оновлені кукі синхронізуються у реальному часі через `Socket.IO` та впорскуються у Chrome без перезапуску.
* **Mobile Proxy IP Rotation**: Підтримка `proxyRotateUrl` з автоматичною перевіркою доступності.

---

## 🚀 Розгортання (Docker Compose Deployment)

### 1. Підготовка середовища
Створіть `.env` файл на вашому Linux-сервері:

```bash
cp .env.example .env
```

Налаштуйте змінні в `.env`:
```env
POSTGRES_DB=oasis
POSTGRES_USER=oasis
POSTGRES_PASSWORD=YourStrongDatabasePasswordHere!
JWT_SECRET=YourSuperLongJwtSecretKeyMinimum64CharactersHexFormatHere!
ADMIN_USERNAME=admin
ADMIN_PASSWORD=InitialAdminPassword123!
OASIS_DOMAIN=your-domain.com
```

### 2. Запуск контейнерів
```bash
docker compose up -d --build
```

Це запустить 4 сервіси:
1. **`postgres`** — База даних PostgreSQL 16.
2. **`api`** — Express REST API + Socket.IO сервер. При першому запуску виконує міграції та створює bootstrap-адміністратора.
3. **`caddy`** — Reverse Proxy з автоматичним отриманням HTTPS SSL-сертифіката від Let's Encrypt.
4. **`postgres-backup`** — Автоматичне щоденне створення зашифрованих `pg_dump` бекапів у папку `./backups`.

---

## 🛠️ Запуск клієнта для підключення до сервера

На пристроях співробітників підключення виконується так:

```bash
OASIS_BACKEND=selfhosted OASIS_SELFHOSTED_URL=https://your-domain.com npm start
```

або через скрипт запуску:
```bash
./start-selfhosted.sh
```

---

## 💾 Резервне копіювання та Відновлення (Backups & Restore)

Сервіс `postgres-backup` робить автоматичні бекапи в `./backups/daily/oasis-latest.sql.gz`.

### Відновлення бази даних (Restore Procedure):
```bash
docker compose down
docker compose up -d postgres
gunzip -c backups/daily/oasis-latest.sql.gz | docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
docker compose up -d
```

---

## 📜 Ліцензія
Приватна розробка для внутрішнього використання команди. Всі права захищено © 2026 **OASIS Browser Team**.
