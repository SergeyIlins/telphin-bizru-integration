/**
 * Основной сервер интеграции Телфин + Бизнес.Ру
 */

const express = require('express');
const rateLimit = require('express-rate-limit');

const env = require('./config/env');
const bizru = require('./services/bizru');
const dealManager = require('./services/dealManager');
const webhookAuth = require('./middleware/webhookAuth');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// === Middleware ===
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiter для вебхуков
const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});

// === Health check ===
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    stats: dealManager.getStats()
  });
});

// === Главный вебхук Телфин ===
app.post('/webhook/telphin', webhookLimiter, webhookAuth, async (req, res) => {
  try {
    console.log('\n📨 Вебхук получен:', new Date().toISOString());
    console.log('  Body:', JSON.stringify(req.body, null, 2));

    const result = await dealManager.handleCall(req.body);

    res.status(200).json({
      success: true,
      ...result
    });

  } catch (err) {
    console.error('❌ Ошибка обработки вебхука:', err.message);
    res.status(200).json({
      success: false,
      error: 'Processing error logged'
    });
  }
});

// === Тестовый эндпоинт ===
app.post('/test/webhook', async (req, res) => {
  try {
    const result = await dealManager.handleCall(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === Статус сотрудников ===
app.get('/employees', async (req, res) => {
  try {
    const employees = await bizru.getEmployees();
    res.json(employees);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === 404 ===
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// === Error handler ===
app.use(errorHandler);

// === Запуск ===
let server = null;
let isShuttingDown = false;

async function start() {
  if (isShuttingDown) return;

  console.log('\n🚀 Запуск интеграции Телфин + Бизнес.Ру\n');

  try {
    // Проверяем токен (если есть в .env — используем, иначе получаем через repair.json)
    console.log('⏳ Проверка авторизации Бизнес.Ру...');
    await bizru.ensureToken();

    server = app.listen(env.PORT, () => {
      console.log(`\n✅ Сервер запущен на порту ${env.PORT}`);
      console.log(`📡 Вебхук Телфин:  POST https://your-domain.com/webhook/telphin`);
      console.log(`🔍 Health check:   http://localhost:${env.PORT}/health`);
      console.log(`\n📋 Настроенные сотрудники:`);
      const mapper = require('./config/employees');
      mapper.getAll().forEach(e => {
        console.log(`   • ${e.sip} → ${e.name} (ID: ${e.employee_id})`);
      });
      console.log('');
    });

  } catch (err) {
    console.error('❌ Критическая ошибка при старте:', err.message);
    console.error('Перезапуск через 10 секунд...');
    setTimeout(start, 10000);
  }
}

// Graceful shutdown
function shutdown(signal) {
  return () => {
    console.log(`\n👋 ${signal} получен, завершаю работу...`);
    isShuttingDown = true;

    if (server) {
      server.close(() => {
        console.log('✅ HTTP-сервер остановлен');
        process.exit(0);
      });

      setTimeout(() => {
        console.error('⚠️ Принудительное завершение');
        process.exit(1);
      }, 5000);
    } else {
      process.exit(0);
    }
  };
}

process.on('SIGTERM', shutdown('SIGTERM'));
process.on('SIGINT', shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err);
  shutdown('uncaughtException')();
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
});

start();
