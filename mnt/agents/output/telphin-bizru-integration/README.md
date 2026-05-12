# 🤝 Интеграция Телфин + Бизнес.Ру

> Автоматическое создание сделок в CRM при входящих звонках

При входящем звонке на добавочный номер (например, `15657*101`) система Телфин отправляет вебхук на сервер, который создаёт сделку в Бизнес.Ру и назначает ответственного менеджера.

---

## 📦 Быстрый старт (2 минуты)

```bash
# 1. На сервере — один скрипт
curl -fsSL https://raw.githubusercontent.com/SergeyIlins/telphin-bizru-integration/main/install.sh | sudo bash

# Или ручной вариант:
git clone https://github.com/SergeyIlins/telphin-bizru-integration.git
cd telphin-bizru-integration
sudo ./install.sh
```

---

## 🏗 Архитектура

```
┌─────────────┐     POST      ┌─────────────────────────┐
│   Телфин    │ ─────────────→│  dev.sevendoors.ru:3000 │
│  (вебхук)   │   dial-in     │      Express сервер       │
└─────────────┘               └─────────────────────────┘
                                        │
                                        │ API REST
                                        ▼
                              ┌─────────────────────────┐
                              │   Бизнес.Ру (CRM)       │
                              │  • Создание сделки      │
                              │  • Назначение менеджера │
                              │  • Уведомление          │
                              └─────────────────────────┘
```

---

## 📁 Структура проекта

```
telphin-bizru-integration/
│
├── 📄 install.sh              ← Главный скрипт деплоя (git clone + тесты)
├── 📄 package.json            ← Зависимости
├── 📄 ecosystem.config.js     ← PM2 конфигурация
├── 📄 .env.example            ← Шаблон переменных окружения
├── 📄 README.md               ← Этот файл
│
└── 📁 src/
    ├── 📄 server.js           ← Express сервер (роуты, middleware)
    │
    ├── 📁 config/
    │   ├── 📄 env.js          ← Валидация .env, парсинг EMPLOYEE_*
    │   └── 📄 employees.js    ← Маппинг SIP → employee_id
    │
    ├── 📁 services/
    │   ├── 📄 bizru.js        ← API-клиент Бизнес.Ру (MD5-подпись)
    │   ├── 📄 telphin.js      ← Парсер вебхуков Телфин
    │   └── 📄 dealManager.js  ← Логика: создание/обновление сделок
    │
    └── 📁 middleware/
        ├── 📄 webhookAuth.js  ← Валидация IP Телфин (CIDR)
        └── 📄 errorHandler.js ← Централизованные ошибки
```

---

## ⚙️ Настройка

### 1. Переменные окружения (`.env`)

```bash
cp .env.example .env
nano .env
```

| Переменная | Описание | Пример |
|---|---|---|
| `BIZRU_ACCOUNT` | Поддомен Бизнес.Ру | `sevendoors` |
| `BIZRU_APP_ID` | ID приложения | `238360` |
| `BIZRU_SECRET_KEY` | Секретный ключ | `fOzjt3sk...` |
| `TELPHIN_APP_ID` | ID приложения Телфин | `74c86d00...` |
| `TELPHIN_APP_SECRET` | Секрет Телфин | `8a93a582...` |
| `EMPLOYEE_15657_101` | Маппинг номера → ID | `75574|Кабанина Анна` |

### 2. Вебхук Телфин

В личном кабинете Телфин (`https://teleo.telphin.ru`):
- Настройка → Call Interactive → Вебхуки
- URL: `https://dev.sevendoors.ru/webhook/telphin`
- События: `dial-in`, `answer`, `hangup`

### 3. PM2 (процесс-менеджер)

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd   # автозапуск при ребуте
```

---

## 🧪 Авто-тестирование

При каждом деплое `install.sh` автоматически проверяет:

| Тест | Что проверяет |
|---|---|
| Health check | Сервер отвечает на `/health` |
| Авторизация Бизнес.Ру | Токен получен, подпись работает |
| Сотрудники | API возвращает список, маппинг настроен |
| Вебхук | Тестовый `dial-in` создаёт сделку |

Результат:
```bash
╔═══════════════════════════════════════════════════════════════╗
║                    РЕЗУЛЬТАТЫ ТЕСТОВ                         ║
╠═══════════════════════════════════════════════════════════════╣
║  ✅ Пройдено:  4                                              ║
║  ❌ Ошибок:    0                                              ║
╚═══════════════════════════════════════════════════════════════╝
```

---

## 📚 Документация API

### Бизнес.Ру
- Авторизация: `MD5(token + secret + sorted_params)`
- Создание сделки: `POST /api/rest/deals.json` с `deal={title, responsible_user, customer_id}`
- Домен: `https://{account}.business.ru`

### Телфин
- Авторизация: OAuth 2.0 (`client_credentials`)
- Шлюз: `https://apiproxy.telphin.ru`
- Вебхуки: `POST` на ваш URL с полями `CallStatus`, `CallerIDNum`, `CalledNumber`

---

## 🐛 Отладка

```bash
# Логи в реальном времени
pm2 logs telphin-integration

# Тестовый вебхук вручную
curl -X POST http://localhost:3000/test/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "CallStatus": "dial-in",
    "CallerIDNum": "79161234567",
    "CalledNumber": "15657*101"
  }'

# Проверка авторизации Бизнес.Ру
node -e "require('./src/services/bizru').authenticate().then(t => console.log('OK:', t))"
```

---

## 📄 Лицензия

MIT — свободное использование и модификация.

---

**Автор:** [SergeyIlins](https://github.com/SergeyIlins)  
**Интеграция:** Телфин ↔ Бизнес.Ру | Май 2026
