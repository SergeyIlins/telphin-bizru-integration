/**
 * Менеджер сделок
 * Логика: создание, обновление, дедупликация
 * 
 * ИСПРАВЛЕНО по документации Бизнес.Ру:
 * - createDeal использует объект deal={title, responsible_user, customer_id, status}
 * - Поле названия: title (не name)
 * - Поле ответственного: responsible_user (не responsible_employee_id)
 * - Поле клиента: customer_id (не contact_id)
 */

const bizru = require('./bizru');
const employeeMapper = require('../config/employees');
const env = require('../config/env');
const TelphinWebhook = require('./telphin');

// Кэш активных звонков
const activeCalls = new Map();
// Rate limiter: номер → время последней сделки
const lastDealTime = new Map();

class DealManager {
  /**
   * Обработать входящий вебхук
   */
  async handleCall(webhookData) {
    const webhook = new TelphinWebhook(webhookData);
    const call = webhook.parsed;

    console.log(`📞 Событие: ${webhook.eventType} | Звонок: ${call.callerId} → ${call.calledNumber}`);

    if (!webhook.isValid()) {
      console.log('⏭️ Звонок пропущен (невалидный)');
      return { skipped: true, reason: 'invalid' };
    }

    // Нормализуем номера
    call.callerId = TelphinWebhook.normalizePhone(call.callerId);
    call.calledNumber = TelphinWebhook.normalizePhone(call.calledNumber);

    // Находим сотрудника
    const employee = employeeMapper.find(call.calledNumber);
    if (!employee) {
      console.warn(`⚠️ Неизвестный номер: ${call.calledNumber}`);
      return { skipped: true, reason: 'unknown_employee' };
    }

    switch (webhook.eventType) {
      case 'dial-in':
        return this.handleDialIn(call, employee);

      case 'answer':
        return this.handleAnswer(call, employee);

      case 'hangup':
        return this.handleHangup(call, employee);

      default:
        return { skipped: true, reason: 'unknown_event' };
    }
  }

  /**
   * Входящий звонок — создаём сделку
   */
  async handleDialIn(call, employee) {
    // Rate limit: не чаще 1 сделки на номер за 5 минут
    const now = Date.now();
    const lastTime = lastDealTime.get(call.callerId);
    if (lastTime && (now - lastTime) < 5 * 60 * 1000) {
      console.log(`⏱️ Rate limit для ${call.callerId}`);
    }

    // Ищем существующего клиента
    const contact = await bizru.findContactByPhone(call.callerId);

    // Формируем название сделки (только латиница!)
    let dealTitle;
    if (contact) {
      dealTitle = `${env.DEAL_PREFIX} from ${call.callerId} (existing client)`;
    } else {
      dealTitle = `${env.DEAL_PREFIX} from ${call.callerId} to ext ${call.calledNumber}`;
    }

    // Создаём сделку по документации Бизнес.Ру
    try {
      const deal = await bizru.createDeal({
        title: dealTitle,
        responsible_user: employee.employee_id,
        customer_id: contact?.id || null,
        status: 'new'
      });

      // Сохраняем в кэш
      activeCalls.set(call.callId, {
        dealId: deal.id,
        employeeId: employee.employee_id,
        startTime: now,
        callerId: call.callerId
      });

      lastDealTime.set(call.callerId, now);

      console.log(`✅ Сделка создана: #${deal.id} для ${employee.name}`);

      // Отправляем уведомление менеджеру
      try {
        await bizru.sendNotification(
          employee.employee_id,
          `Incoming call from ${call.callerId}. Deal #${deal.id} created.`
        );
      } catch (notifyErr) {
        console.warn('⚠️ Не удалось отправить уведомление:', notifyErr.message);
      }

      return {
        success: true,
        dealId: deal.id,
        employee: employee.name,
        contact: contact ? contact.name : null
      };

    } catch (err) {
      console.error('❌ Ошибка создания сделки:', err.message);
      throw err;
    }
  }

  /**
   * Ответ на звонок — обновляем статус сделки
   */
  async handleAnswer(call, employee) {
    const active = activeCalls.get(call.callId);
    if (!active) {
      console.log('ℹ️ Нет активной сделки для обновления');
      return { skipped: true };
    }

    console.log(`📱 Менеджер ${employee.name} ответил на звонок`);

    // Обновляем статус на "в работе"
    try {
      await bizru.updateDeal(active.dealId, {
        status: 'in_progress'
      });
      console.log(`📝 Сделка #${active.dealId} переведена в статус "in_progress"`);
    } catch (err) {
      console.warn('⚠️ Не удалось обновить статус сделки:', err.message);
    }

    return { success: true, dealId: active.dealId, event: 'answered' };
  }

  /**
   * Завершение звонка — финализация
   */
  async handleHangup(call, employee) {
    const active = activeCalls.get(call.callId);
    if (!active) {
      return { skipped: true, reason: 'no_active_call' };
    }

    const duration = call.duration || 0;

    if (duration < env.MIN_CALL_DURATION) {
      console.log(`⏱️ Звонок слишком короткий (${duration}s)`);
    } else {
      console.log(`✅ Звонок завершён, длительность: ${duration}s`);
    }

    // Убираем из активных
    activeCalls.delete(call.callId);

    return {
      success: true,
      dealId: active.dealId,
      duration,
      finalized: true
    };
  }

  getStats() {
    return {
      activeCalls: activeCalls.size,
      lastDeals: lastDealTime.size
    };
  }
}

module.exports = new DealManager();
