#!/bin/bash
# =============================================================================
# install.sh — Деплой интеграции Телфин + Бизнес.Ру
# 
# Схема: git clone → npm install → получение токена → запуск → тесты
# =============================================================================

set -euo pipefail

REPO_URL="https://github.com/SergeyIlins/telphin-bizru-integration.git"
PROJECT_NAME="telphin-integration"
INSTALL_DIR="/opt/${PROJECT_NAME}"
NODE_MIN_VERSION="18"
PM2_APP_NAME="telphin-integration"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}ℹ️  $1${NC}"; }
log_ok()    { echo -e "${GREEN}✅ $1${NC}"; }
log_warn()  { echo -e "${YELLOW}⚠️  $1${NC}"; }
log_err()   { echo -e "${RED}❌ $1${NC}"; }

section() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "  $1"
  echo "═══════════════════════════════════════════════════════════════"
}

# ─── Шаг 1: Проверка системы ─────────────────────────────────────────────────
section "1. Проверка системных зависимостей"

if ! command -v node &> /dev/null; then
  log_err "Node.js не установлен"
  echo "   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -"
  echo "   sudo apt-get install -y nodejs"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//g' | cut -d'.' -f1)
if [[ "$NODE_VERSION" -lt "$NODE_MIN_VERSION" ]]; then
  log_err "Требуется Node.js ${NODE_MIN_VERSION}+, установлена: $(node -v)"
  exit 1
fi
log_ok "Node.js $(node -v)"

if ! command -v npm &> /dev/null; then
  log_err "npm не установлен"
  exit 1
fi
log_ok "npm $(npm -v)"

if ! command -v git &> /dev/null; then
  log_warn "git не найден, устанавливаю..."
  apt-get update -qq && apt-get install -y -qq git
fi
log_ok "git $(git --version | awk '{print $3}')"

if ! command -v pm2 &> /dev/null; then
  log_warn "PM2 не найден, устанавливаю..."
  npm install -g pm2@latest
fi
log_ok "PM2 $(pm2 -v)"

if ! command -v curl &> /dev/null; then
  log_warn "curl не найден, устанавливаю..."
  apt-get install -y -qq curl
fi

# ─── Шаг 2: Клонирование ─────────────────────────────────────────────────────
section "2. Клонирование репозитория"

pm2 delete "${PM2_APP_NAME}" 2>/dev/null || true

if [[ -d "${INSTALL_DIR}" ]]; then
  rm -rf "${INSTALL_DIR}"
fi

git clone "${REPO_URL}" "${INSTALL_DIR}"
cd "${INSTALL_DIR}"
log_ok "Репозиторий склонирован"

# ─── Шаг 3: Установка зависимостей ───────────────────────────────────────────
section "3. Установка npm-зависимостей"

npm ci --production --silent || {
  log_warn "npm ci не сработал, пробую npm install..."
  npm install --production --silent
}
log_ok "Зависимости установлены"

# ─── Шаг 4: Создание .env ────────────────────────────────────────────────────
section "4. Настройка конфигурации"

cp .env.example .env
chmod 600 .env
log_ok ".env создан из шаблона (секреты уже встроены)"

# ─── Шаг 5: Получение токена Бизнес.Ру ────────────────────────────────────────
section "5. Получение токена Бизнес.Ру"

log_info "Запрашиваю токен через repair.json..."
TOKEN_RESPONSE=$(curl -s --max-time 15 "https://sevendoors.business.ru/api/rest/repair.json?app_id=238360&app_psw=$(echo -n 'fOzjt3skalowLRhNvE3QDze3y7UBo2LAapp_id=238360' | md5sum | cut -d' ' -f1)" || echo "")

TOKEN=$(echo "$TOKEN_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || echo "")

if [[ -n "$TOKEN" ]]; then
  echo "BIZRU_TOKEN=$TOKEN" >> .env
  log_ok "Токен получен и сохранён в .env"
else
  log_warn "Не удалось получить токен автоматически"
  echo ""
  echo "   Получите вручную:"
  echo "   curl \"https://sevendoors.business.ru/api/rest/repair.json?app_id=238360&app_psw=0ae6ea74c25f399eba6c920afd03cf6a\""
  echo ""
  echo "   Затем добавьте в .env:"
  echo "   echo 'BIZRU_TOKEN=ВАШ_ТОКЕН' >> /opt/telphin-integration/.env"
  echo ""
  echo "   И перезапустите:"
  echo "   pm2 restart telphin-integration"
fi

# ─── Шаг 6: Запуск ───────────────────────────────────────────────────────────
section "6. Запуск приложения"

mkdir -p logs
pm2 start ecosystem.config.js
pm2 save
sleep 3

# ─── Шаг 7: Авто-тестирование ───────────────────────────────────────────────
section "7. Авто-тестирование"

TEST_PASSED=0
TEST_FAILED=0

# Тест 1: Health check
log_info "Тест 1: Health check..."
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health || echo "000")
if [[ "$HEALTH" == "200" ]]; then
  log_ok "Health check: OK"
  ((TEST_PASSED++))
else
  log_err "Health check: FAIL (HTTP $HEALTH)"
  ((TEST_FAILED++))
fi

# Тест 2: Вебхук
log_info "Тест 2: Тестовый вебхук..."
WEBHOOK_RESULT=$(curl -s -X POST http://localhost:3000/test/webhook \
  -H "Content-Type: application/json" \
  -d '{"CallStatus":"dial-in","CallerIDNum":"79161234567","CalledNumber":"15657*101","CallID":"test-'$(date +%s)'"}' | grep -o '"success":true' || echo "FAIL")

if [[ "$WEBHOOK_RESULT" == '"success":true' ]]; then
  log_ok "Вебхук: OK"
  ((TEST_PASSED++))
else
  log_err "Вебхук: FAIL"
  ((TEST_FAILED++))
fi

# Тест 3: Авторизация Бизнес.Ру
log_info "Тест 3: Авторизация Бизнес.Ру..."
node -e "
const bizru = require('./src/services/bizru');
bizru.ensureToken()
  .then(() => { console.log('${GREEN}✅ Бизнес.Ру: токен работает${NC}'); process.exit(0); })
  .catch(err => { console.log('${RED}❌ Бизнес.Ру: FAIL${NC}', err.message); process.exit(1); });
" && ((TEST_PASSED++)) || ((TEST_FAILED++))

# ─── Итоги ──────────────────────────────────────────────────────────────────
section "8. Итоги деплоя"

echo ""
echo "┌─────────────────────────────────────────────────────────────┐"
echo "│                    РЕЗУЛЬТАТЫ ТЕСТОВ                         │"
echo "├─────────────────────────────────────────────────────────────┤"
printf "│  ✅ Пройдено:  %-3d                                          │\\n" "$TEST_PASSED"
printf "│  ❌ Ошибок:    %-3d                                          │\\n" "$TEST_FAILED"
echo "└─────────────────────────────────────────────────────────────┘"
echo ""

if [[ "$TEST_FAILED" -gt 0 ]]; then
  log_warn "Деплой завершён с ошибками"
  echo ""
  echo "📋 Логи:"
  echo "   pm2 logs ${PM2_APP_NAME} --lines 50"
  echo ""
fi

log_ok "Установка завершена!"
echo ""
echo "  📁 Директория:  ${INSTALL_DIR}"
echo "  🔍 Health:      curl http://localhost:3000/health"
echo "  📞 Вебхук:      POST http://localhost:3000/webhook/telphin"
echo "  📜 Логи:        pm2 logs ${PM2_APP_NAME}"
echo ""
