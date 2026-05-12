/**
 * Маппинг SIP-номеров на сотрудников Бизнес.Ру
 * Поддерживает несколько форматов номера
 */

const { EMPLOYEES } = require('./env');

class EmployeeMapper {
  constructor() {
    this.cache = new Map();
    this.buildCache();
  }

  buildCache() {
    // Основные номера: 15657*101
    Object.entries(EMPLOYEES).forEach(([sip, data]) => {
      this.cache.set(sip, data);
      // Короткие номера: 101, 102
      const short = sip.split('*')[1];
      if (short && !this.cache.has(short)) {
        this.cache.set(short, data);
      }
    });
  }

  /**
   * Найти сотрудника по номеру
   * @param {string} calledNumber — номер из вебхука
   * @returns {object|null} — { employee_id, name }
   */
  find(calledNumber) {
    if (!calledNumber) return null;

    // Точное совпадение
    if (this.cache.has(calledNumber)) {
      return this.cache.get(calledNumber);
    }

    // Поиск по окончанию (если пришёл полный SIP)
    for (const [key, data] of this.cache) {
      if (calledNumber.endsWith(key) || key.endsWith(calledNumber)) {
        return data;
      }
    }

    return null;
  }

  getAll() {
    return Array.from(this.cache.entries()).map(([sip, data]) => ({
      sip,
      ...data
    }));
  }
}

module.exports = new EmployeeMapper();
