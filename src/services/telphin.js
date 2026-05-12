/**
 * Парсер и валидатор вебхуков Телфин
 * Обрабатывает разные типы событий
 * 
 * ИСПРАВЛЕНО по документации Телфин:
 * - Добавлено поле RemoteNumber (внешний номер для dial-in)
 * - Поддержка полей из документации Call Interactive
 */

class TelphinWebhook {
  constructor(data) {
    this.raw = data;
    this.eventType = this.detectEventType();
    this.parsed = this.parse();
  }

  detectEventType() {
    // Определяем тип события по полям
    if (this.raw.CallStatus === 'dial-in' || this.raw.Event === 'DialIn') {
      return 'dial-in';
    }
    if (this.raw.CallStatus === 'answer' || this.raw.Event === 'Answer') {
      return 'answer';
    }
    if (this.raw.CallStatus === 'hangup' || this.raw.Event === 'Hangup') {
      return 'hangup';
    }
    if (this.raw.CallStatus === 'dial-out') {
      return 'dial-out';
    }
    return 'unknown';
  }

  parse() {
    // Для dial-in: CalledNumber — внутренний, RemoteNumber — внешний (если есть)
    // Для остальных: CallerIDNum — внешний, CalledNumber — внутренний
    const isDialIn = this.eventType === 'dial-in';

    return {
      // Номер звонящего (внешний)
      callerId: this.raw.CallerIDNum 
        || this.raw.From 
        || this.raw.caller_id 
        || (isDialIn ? this.raw.RemoteNumber : null)
        || null,

      // Внутренний номер менеджера (куда звонят)
      calledNumber: this.raw.CalledNumber 
        || this.raw.To 
        || this.raw.extension 
        || null,

      // Уникальный ID звонка
      callId: this.raw.CallID 
        || this.raw.call_id 
        || this.raw.UniqueID 
        || `call_${Date.now()}`,

      // Статус звонка
      status: this.eventType,

      // Длительность (для hangup)
      duration: parseInt(this.raw.Duration || this.raw.duration || 0, 10),

      // Время события
      timestamp: this.raw.Timestamp || new Date().toISOString(),

      // Направление
      direction: this.raw.Direction || 'inbound',

      // URL записи разговора
      recordingUrl: this.raw.RecordingUrl || null,

      // Дополнительные поля из документации
      remoteNumber: this.raw.RemoteNumber || null,
      localNumber: this.raw.LocalNumber || null,
      sipCallId: this.raw.SipCallId || null
    };
  }

  /**
   * Проверить, является ли звонок валидным для обработки
   */
  isValid() {
    // Игнорируем исходящие
    if (this.parsed.direction === 'outbound' && this.eventType === 'dial-out') {
      return false;
    }

    // Должен быть номер звонящего
    if (!this.parsed.callerId || this.parsed.callerId === 'anonymous') {
      return false;
    }

    // Должен быть номер назначения
    if (!this.parsed.calledNumber) {
      return false;
    }

    return true;
  }

  /**
   * Очистить номер телефона
   */
  static normalizePhone(phone) {
    if (!phone) return null;

    let clean = phone.toString().replace(/^(sip:|tel:)/i, '');
    clean = clean.replace(/[^0-9+*]/g, '');

    return clean;
  }
}

module.exports = TelphinWebhook;
