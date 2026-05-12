/**
 * Валидация и загрузка переменных окружения
 */

require('dotenv').config();

const REQUIRED = [
  'BIZRU_ACCOUNT',
  'BIZRU_APP_ID', 
  'BIZRU_SECRET_KEY',
  'TELPHIN_APP_ID',
  'TELPHIN_APP_SECRET'
];

function validate() {
  const missing = REQUIRED.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.error('❌ Отсутствуют обязательные переменные окружения:');
    missing.forEach(k => console.error(`   - ${k}`));
    process.exit(1);
  }
}

validate();

module.exports = {
  // Сервер
  PORT: parseInt(process.env.PORT, 10) || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  WEBHOOK_DOMAIN: process.env.WEBHOOK_DOMAIN || 'https://dev.sevendoors.ru',

  // Бизнес.Ру
  BIZRU_ACCOUNT: process.env.BIZRU_ACCOUNT,
  BIZRU_APP_ID: process.env.BIZRU_APP_ID,
  BIZRU_SECRET_KEY: process.env.BIZRU_SECRET_KEY,
  BIZRU_DOMAIN: process.env.BIZRU_DOMAIN || `https://${process.env.BIZRU_ACCOUNT}.business.ru`,
  BIZRU_TOKEN: process.env.BIZRU_TOKEN || null,

  // Телфин
  TELPHIN_APP_ID: process.env.TELPHIN_APP_ID,
  TELPHIN_APP_SECRET: process.env.TELPHIN_APP_SECRET,
  TELPHIN_API_GATEWAY: process.env.TELPHIN_API_GATEWAY || 'https://apiproxy.telphin.ru',

  // Безопасность
  ALLOWED_IPS: (process.env.ALLOWED_IPS || '').split(',').map(s => s.trim()).filter(Boolean),

  // Настройки сделок
  MIN_CALL_DURATION: parseInt(process.env.MIN_CALL_DURATION, 10) || 0,
  DEAL_PREFIX: process.env.DEAL_PREFIX || 'Call',
  SEND_NOTIFICATIONS: process.env.SEND_NOTIFICATIONS === 'true',

  // Внутренние номера → ID сотрудников
  EMPLOYEES: parseEmployees()
};

function parseEmployees() {
  const map = {};
  Object.keys(process.env).forEach(key => {
    if (key.startsWith('EMPLOYEE_')) {
      const sip = key.replace('EMPLOYEE_', '').replace(/_/g, '*');
      const [id, name] = process.env[key].split('|');
      map[sip] = {
        employee_id: parseInt(id, 10),
        name: name || 'Unknown'
      };
    }
  });
  return map;
}
