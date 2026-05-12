/**
 * API-клиент Бизнес.Ру
 * Токен берётся из .env (BIZRU_TOKEN) — repair.json НЕ используется
 */

const axios = require('axios');
const crypto = require('crypto');
const env = require('../config/env');

class BizruAPI {
  constructor() {
    this.token = env.BIZRU_TOKEN || null;
    this.tokenIssuedAt = Date.now(); // считаем, что токен свежий при старте
    this.baseURL = env.BIZRU_DOMAIN;
    this.appId = env.BIZRU_APP_ID;
    this.secret = env.BIZRU_SECRET_KEY;
  }

  /**
   * Проверить валидность токена (запас 10 минут)
   */
  isTokenValid() {
    if (!this.token) return false;
    const ageSec = (Date.now() - this.tokenIssuedAt) / 1000;
    return ageSec < 3000; // 50 минут (токен живёт 60)
  }

  /**
   * Убедиться, что токен есть
   */
  async ensureToken() {
    if (!this.token) {
      throw new Error('BIZRU_TOKEN не задан в .env');
    }
    if (!this.isTokenValid()) {
      console.warn('⚠️ Токен возможно протух, но продолжаем...');
    }
    return this.token;
  }

  /**
   * Подпись запроса: md5(token + secret + sorted_params)
   */
  getSignature(params = {}) {
    const sorted = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('');
    return crypto.createHash('md5').update(this.token + this.secret + sorted).digest('hex');
  }

  /**
   * Базовый запрос с ретраями (только при 503, не при 401)
   */
  async request(action, params = {}, method = 'GET', retries = 2) {
    await this.ensureToken();

    const allParams = { app_id: this.appId, ...params };
    const sign = this.getSignature(allParams);
    const url = `${this.baseURL}/api/rest/${action}.json`;

    const config = {
      method, url, timeout: 15000,
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
      // 503 — сервер перегружен, ретрай через 5 сек
      if (err.response?.status === 503 && retries > 0) {
        console.warn(`⚠️ 503, ретрай через 5 сек... (${retries})`);
        await new Promise(r => setTimeout(r, 5000));
        return this.request(action, params, method, retries - 1);
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

  async sendNotification(employeeId, message) {
    return this.request('notifications', {
      'employee_ids[0]': employeeId,
      message: message,
      type: 'info'
    }, 'POST');
  }
}

module.exports = new BizruAPI();
