/**
 * API-клиент Бизнес.Ру
 * Токен получается ОДИН РАЗ и кэшируется на 50 минут
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
   * Проверить валидность токена (запас 10 минут)
   */
  isTokenValid() {
    if (!this.token || !this.tokenIssuedAt) return false;
    const ageSec = (Date.now() - this.tokenIssuedAt) / 1000;
    return ageSec < (this.tokenTTL - 600);
  }

  /**
   * Убедиться, что токен есть. 
   * Если есть в .env — используем. Если нет — получаем через repair.json (1 раз)
   */
  async ensureToken() {
    // Токен свежий — просто возвращаем
    if (this.isTokenValid()) {
      return this.token;
    }

    // Если авторизация уже идёт — ждём
    if (this.authPromise) {
      return this.authPromise;
    }

    // Если токен есть из .env, но ещё не инициализирован
    if (this.token && !this.tokenIssuedAt) {
      this.tokenIssuedAt = Date.now();
      console.log('✅ Бизнес.Ру: используем токен из .env');
      return this.token;
    }

    // Получаем через repair.json (singleton — параллельные запросы ждут)
    this.authPromise = this._fetchToken().finally(() => {
      this.authPromise = null;
    });
    return this.authPromise;
  }

  async _fetchToken() {
    const sign = crypto
      .createHash('md5')
      .update(this.secret + `app_id=${this.appId}`)
      .digest('hex');

    try {
      const { data } = await axios.get(`${this.baseURL}/api/rest/repair.json`, {
        params: { app_id: this.appId, app_psw: sign },
        timeout: 15000
      });

      const token = data.token || (data.result && data.result.token);
      if (!token) throw new Error('No token in response');

      this.token = token;
      this.tokenIssuedAt = Date.now();
      console.log('✅ Бизнес.Ру: токен получен через repair.json');
      console.log(`   💡 Добавьте в .env: BIZRU_TOKEN=${token}`);
      return token;
    } catch (err) {
      console.error('❌ Ошибка авторизации:', err.message);
      throw err;
    }
  }

  /**
   * Подпись запроса: MD5(token + secret + sorted_params)
   */
  getSignature(params = {}) {
    const sorted = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('');
    return crypto.createHash('md5').update(this.token + this.secret + sorted).digest('hex');
  }

  /**
   * Базовый запрос с ретраями
   */
  async request(action, params = {}, method = 'GET', retries = 3) {
    await this.ensureToken();

    const allParams = { app_id: this.appId, ...params };
    const sign = this.getSignature(allParams);
    const url = `${this.baseURL}/api/rest/${action}.json`;

    const config = {
      method, url, timeout: 20000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    };

    if (method === 'GET') {
      config.params = { ...allParams, app_psw: sign };
    } else {
      const formData = new URLSearchParams();
      Object.entries({ ...allParams, app_psw: sign }).forEach(([k, v]) => {
        if (v != null) formData.append(k, typeof v === 'object' ? JSON.stringify(v) : v);
      });
      config.data = formData.toString();
    }

    try {
      const { data } = await axios(config);
      if (data.status === 'error') throw new Error(data.error || 'API error');
      return data.result || data;
    } catch (err) {
      if (err.response?.status === 503 && retries > 0) {
        await new Promise(r => setTimeout(r, 3000));
        return this.request(action, params, method, retries - 1);
      }
      if (err.response?.status === 401 && !err._retried) {
        err._retried = true;
        this.token = null;
        this.tokenIssuedAt = null;
        return this.request(action, params, method, retries);
      }
      throw err;
    }
  }

  async getEmployees() { return this.request('employees'); }

  async findContactByPhone(phone) {
    try {
      const result = await this.request('contacts', { phone: phone.replace(/\D/g, ''), limit: 1 });
      return Array.isArray(result) ? (result[0] || null) : (result || null);
    } catch (err) {
      console.warn('⚠️ Поиск контакта:', err.message);
      return null;
    }
  }

  async createDeal(data) {
    const dealObj = {
      title: data.title,
      responsible_user: data.responsible_user,
      status: data.status || 'new'
    };
    if (data.customer_id) dealObj.customer_id = data.customer_id;
    return this.request('deals', { deal: dealObj }, 'POST');
  }

  async updateDeal(dealId, data) {
    const dealObj = {};
    if (data.title) dealObj.title = data.title;
    if (data.status) dealObj.status = data.status;
    return this.request(`deals/${dealId}`, { deal: dealObj }, 'PUT');
  }

  async sendNotification(employeeId, message) {
    return this.request('notifications', {
      'employee_ids[0]': employeeId,
      message: message,
      type: 'info'
    }, 'POST');
  }
}

module.exports = new BizruAPI();
