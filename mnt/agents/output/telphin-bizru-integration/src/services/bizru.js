/**
 * API-клиент Бизнес.Ру
 * Авторизация: token + MD5-подпись
 * Домен: {account}.business.ru
 * 
 * ИСПРАВЛЕНО по документации:
 * - Создание сделки: POST с JSON-объектом deal={...}
 * - Поле ответственного: responsible_user (не responsible_employee_id)
 * - Поле клиента: customer_id (не contact_id)
 * - Название сделки: title (не name)
 */

const axios = require('axios');
const crypto = require('crypto');
const env = require('../config/env');

class BizruAPI {
  constructor() {
    this.token = null;
    this.tokenExpiry = null;
    this.baseURL = env.BIZRU_DOMAIN;
    this.account = env.BIZRU_ACCOUNT;
    this.appId = env.BIZRU_APP_ID;
    this.secret = env.BIZRU_SECRET_KEY;
  }

  /**
   * Получить токен через repair.json
   * Подпись: MD5(secret_key + app_id=...)
   */
  async authenticate() {
    const sign = crypto
      .createHash('md5')
      .update(this.secret + `app_id=${this.appId}`)
      .digest('hex');

    const url = `${this.baseURL}/api/rest/repair.json`;

    try {
      const { data } = await axios.get(url, {
        params: { app_id: this.appId, app_psw: sign },
        timeout: 10000
      });

      if (data.status !== 'success' || !data.result?.token) {
        throw new Error(`Auth failed: ${JSON.stringify(data)}`);
      }

      this.token = data.result.token;
      // Токен живёт ~2 часа
      this.tokenExpiry = Date.now() + 90 * 60 * 1000;

      console.log('✅ Бизнес.Ру: токен получен');
      return this.token;
    } catch (err) {
      console.error('❌ Ошибка авторизации Бизнес.Ру:', err.message);
      throw err;
    }
  }

  /**
   * Проверить и обновить токен
   */
  async ensureToken() {
    if (!this.token || Date.now() >= this.tokenExpiry) {
      await this.authenticate();
    }
    return this.token;
  }

  /**
   * Вычислить подпись для рабочих запросов
   * MD5(token + secret + sorted_params)
   * Параметры сортируются по ключам
   */
  getSignature(params = {}) {
    const sorted = Object.keys(params)
      .sort()
      .map(k => `${k}=${params[k]}`)
      .join('');

    return crypto
      .createHash('md5')
      .update(this.token + this.secret + sorted)
      .digest('hex');
  }

  /**
   * Базовый запрос к API
   * Бизнес.Ру принимает JSON в теле POST-запроса
   */
  async request(action, params = {}, method = 'GET') {
    await this.ensureToken();

    const allParams = {
      app_id: this.appId,
      ...params
    };

    const sign = this.getSignature(allParams);
    const url = `${this.baseURL}/api/rest/${action}.json`;

    const config = {
      method,
      url,
      timeout: 15000,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    };

    if (method === 'GET') {
      config.params = { ...allParams, app_psw: sign };
    } else {
      // POST/PUT: формируем form-data (как требует Бизнес.Ру)
      const formData = new URLSearchParams();
      Object.entries({ ...allParams, app_psw: sign }).forEach(([k, v]) => {
        if (v !== null && v !== undefined) {
          // Для вложенных объектов (deal={...}) — сериализуем в JSON
          if (typeof v === 'object') {
            formData.append(k, JSON.stringify(v));
          } else {
            formData.append(k, v);
          }
        }
      });
      config.data = formData.toString();
    }

    try {
      const { data } = await axios(config);

      if (data.status === 'error') {
        throw new Error(`API error: ${data.error || JSON.stringify(data)}`);
      }

      return data.result || data;
    } catch (err) {
      // Если 401 — пробуем переавторизоваться один раз
      if (err.response?.status === 401 && !err._retried) {
        err._retried = true;
        this.token = null;
        return this.request(action, params, method);
      }
      throw err;
    }
  }

  // === Методы API ===

  /**
   * Получить список сотрудников
   */
  async getEmployees() {
    return this.request('employees');
  }

  /**
   * Найти клиента по номеру телефона
   * Используем contacts.json с поиском по phone
   */
  async findContactByPhone(phone) {
    const clean = phone.replace(/\D/g, '');

    try {
      const result = await this.request('contacts', {
        phone: clean,
        limit: 1
      });

      // Ответ может быть объектом или массивом
      if (Array.isArray(result)) {
        return result.length > 0 ? result[0] : null;
      }
      if (result && typeof result === 'object') {
        return result;
      }
      return null;
    } catch (err) {
      console.warn('⚠️ Ошибка поиска контакта:', err.message);
      return null;
    }
  }

  /**
   * Создать сделку
   * 
   * ИСПРАВЛЕНО по документации Бизнес.Ру:
   * - deal — объект с полями сделки
   * - title — название сделки
   * - responsible_user — ID ответственного
   * - customer_id — ID клиента
   * - status — статус: new, in_progress, decision, payment, success, canceled
   * 
   * @param {object} data — поля сделки
   */
  async createDeal(data) {
    // Формируем объект deal по документации
    const dealObj = {
      title: data.title,
      responsible_user: data.responsible_user,
      status: data.status || 'new'
    };

    // Добавляем опциональные поля
    if (data.customer_id) {
      dealObj.customer_id = data.customer_id;
    }
    if (data.budget) {
      dealObj.budget = data.budget;
    }
    if (data.currency) {
      dealObj.currency = data.currency;
    }

    return this.request('deals', { deal: dealObj }, 'POST');
  }

  /**
   * Обновить сделку
   */
  async updateDeal(dealId, data) {
    const dealObj = {};

    if (data.title) dealObj.title = data.title;
    if (data.status) dealObj.status = data.status;
    if (data.responsible_user) dealObj.responsible_user = data.responsible_user;
    if (data.budget) dealObj.budget = data.budget;

    return this.request(`deals/${dealId}`, { deal: dealObj }, 'PUT');
  }

  /**
   * Отправить уведомление сотруднику
   * Формат: employee_ids[0]=ID (не JSON-массив!)
   */
  async sendNotification(employeeId, message) {
    const params = {
      'employee_ids[0]': employeeId,
      message: message,
      type: 'info'
    };

    return this.request('notifications', params, 'POST');
  }
}

module.exports = new BizruAPI();
