/**
 * Валидация источника вебхуков
 * Проверка IP-адреса по белому списку
 * 
 * ИСПРАВЛЕНО:
 * - Добавлены официальные сети Телфин из документации
 * - 213.170.84.96/27, 46.229.221.80/28, 79.175.9.160/28, 81.29.132.240/29
 */

const env = require('../config/env');

function ipToLong(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

function isIpInCidr(ip, cidr) {
  const [range, bits] = cidr.split('/');
  const mask = -1 << (32 - parseInt(bits, 10));
  return (ipToLong(ip) & mask) === (ipToLong(range) & mask);
}

function webhookAuth(req, res, next) {
  // В режиме разработки пропускаем
  if (env.NODE_ENV === 'development') {
    return next();
  }

  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() 
    || req.socket.remoteAddress 
    || req.ip;

  // Если список разрешённых пуст — используем дефолтные сети Телфин
  const allowedIPs = env.ALLOWED_IPS.length > 0 
    ? env.ALLOWED_IPS 
    : ['213.170.84.96/27', '46.229.221.80/28', '79.175.9.160/28', '81.29.132.240/29'];

  const isAllowed = allowedIPs.some(allowed => {
    if (allowed.includes('/')) {
      return isIpInCidr(clientIp, allowed);
    }
    return clientIp === allowed;
  });

  if (!isAllowed) {
    console.warn(`🚫 Заблокирован запрос с IP: ${clientIp}`);
    return res.status(403).json({ error: 'Forbidden: IP not allowed' });
  }

  next();
}

module.exports = webhookAuth;
