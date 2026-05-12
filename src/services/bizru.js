/**
 * API-клиент Бизнес.Ру
 * Авторизация: токен из .env или repair.json (один раз)
 */

const axios = require('axios');
const crypto = require('crypto');
const env = require('../config/env');

class BizruAPI {
  constructor() {
    this.token = env.BIZRU_TOKEN || null;
    this.tokenIssuedAt = null;
    this.tokenTTL = 3600;
    this.baseURL = env.BIZRU_DOMAIN;
    this.appId = env.BIZRU_APP_ID;
    this.secret = env.BIZRU_SECRET_KEY;
    this.authPromise = null;
  }

  /**
   * Получить токен через repair.json (только если нет в .env)
   * Singleton: параллельные вызовы ждут одну авторизацию
   */
  async authenticate() {
    // Если токен уже есть из .env — используем его
    if (this.token) {
      console.log('✅ Бизнес.Ру: используем токен из .env');
      this.tokenIssuedAt = Date.now();
      return this.token;
    }

    // Если авторизация уже идёт — ждём её
    if (this.authPromise) {
      return this.authPromise;
    }

    // Создаём promise авторизации
    this.authPromise = this._doAuthenticate().finally(() => {
      this.authPromise = null;
    });

    return this.authPromise;
  }

  async _doAuthenticate() {
    const sign = crypto
      .createHash('md5')
      .update(this.secret + `app_id=${this.appId}`)
      .digest('hex');

    const url = `${this.baseURL}/api/rest/repair.json`;

    try {
      const { data } = await axios.get(url, {
        params: { app_id: this.appId, app_psw: sign },
        timeout: 15000
      });

      let token = null;

      if (data.token) {
        token = data.token;
      } else if (data.result && data.result.token) {
        token = data.result.token;
      }

      if (!token) {
        throw new Error(`Auth failed: ${JSON.stringify(data)}`);
      }

      this.token = token;
      this.tokenIssuedAt = Date.now();

      console.log('✅ Бизнес.Ру: токен получен через repair.json');
      console.log(`   💡 Сохраните в .env: BIZRU_TOKEN=${token}`);
      return this.token;
    } catch (err) {
      console.error('❌ Ошибка авторизации Бизнес.Ру:', err.message);
      throw err;
    }
  }

  /**
   * Проверить, что токен ещё валиден (с запасом 10 минут)
   */
  isTokenValid() {
    if (!this.token || !this.tokenIssuedAt) return false;
    const age = (Date.now() - this.tokenIssuedAt) / 1000;
    return age < (this.tokenTTL - 600);
  }

  /**
   * Убедиться, что токен есть
   */
  async ensureToken() {
    if (this.isTokenValid()) {
      return this.token;
    }
    return this.authenticate();
  }

  /**
   * Вычислить подпись для рабочих запросов
   * MD5(token + secret + sorted_params)
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
   * Базовый запрос к API с ретраями
   */
  async request(action, params = {}, method = 'GET', retries = 3) {
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
      timeout: 20000,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    };

    if (method === 'GET') {
      config.params = { ...allParams, app_psw: sign };
    } else {
      const formData = new URLSearchParams();
      Object.entries({ ...allParams, app_psw: sign }).forEach(([k, v]) => {
        if (v !== null && v !== undefined) {
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
      // 503 — сервер перегружен, пробуем ещё раз через 3 секунды
      if (err.response?.status === 503 && retries > 0) {
        console.warn(`⚠️ 503 от Бизнес.Ру, ретрай через 3 сек... (${retries} осталось)`);
        await new Promise(r => setTimeout(r, 3000));
        return this.request(action, params, method, retries - 1);
      }

      // 401 — токен протух, обновляем один раз
      if (err.response?.status === 401 && !err._retried) {
        err._retried = true;
        this.token = null;
        this.tokenIssuedAt = null;
        return this.request(action, params, method, retries);
      }

      throw err;
    }
  }

  // === Методы API ===

  async getEmployees() {
    return this.request('employees');
  }

  async findContactByPhone(phone) {
    const clean = phone.replace(/\D/g, '');

    try {
      const result = await this.request('contacts', {
        phone: clean,
        limit: 1
      });

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

  async createDeal(data) {
    const dealObj = {
      title: data.title,
      responsible_user: data.responsible_user,
      status: data.status || 'new'
    };

    if (data.customer_id) {
      dealObj.customer_id = data.customer_id;
    }
    if (data.budget) {
      dealObj.budget = data.budget;
    }

    return this.request('deals', { deal: dealObj }, 'POST');
  }

  async updateDeal(dealId, data) {
    const dealObj = {};

    if (data.title) dealObj.title = data.title;
    if (data.status) dealObj.status = data.status;
    if (data.responsible_user) dealObj.responsible_user = data.responsible_user;

    return this.request(`deals/${dealId}`, { deal: dealObj }, 'PUT');
  }

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
