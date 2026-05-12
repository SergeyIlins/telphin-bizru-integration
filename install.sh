#!/bin/bash
# =============================================================================
# install.sh — Деплой интеграции Телфин + Бизнес.Ру
# 
# Схема: GitHub → сервер → PM2
# Авто-тестирование после установки
# =============================================================================

set -euo pipefail

# ─── Конфигурация ─────────────────────────────────────────────────────────────
REPO_URL="https://github.com/SergeyIlins/telphin-bizru-integration.git"
PROJECT_NAME="telphin-integration"
INSTALL_DIR="/opt/${PROJECT_NAME}"
NODE_MIN_VERSION="18"
PM2_APP_NAME="telphin-integration"
LOG_DIR="${INSTALL_DIR}/logs"

# Цвета
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ─── Утилиты ──────────────────────────────────────────────────────────────────
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

# Node.js
if ! command -v node &> /dev/null; then
  log_err "Node.js не установлен"
  echo "   Установите: curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -"
  echo "                sudo apt-get install -y nodejs"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//g' | cut -d'.' -f1)
if [[ "$NODE_VERSION" -lt "$NODE_MIN_VERSION" ]]; then
  log_err "Требуется Node.js ${NODE_MIN_VERSION}+, установлена: $(node -v)"
  exit 1
fi
log_ok "Node.js $(node -v)"

# npm
if ! command -v npm &> /dev/null; then
  log_err "npm не установлен"
  exit 1
fi
log_ok "npm $(npm -v)"

# git
if ! command -v git &> /dev/null; then
  log_warn "git не найден, устанавливаю..."
  apt-get update -qq && apt-get install -y -qq git
fi
log_ok "git $(git --version | awk '{print $3}')"

# PM2
if ! command -v pm2 &> /dev/null; then
  log_warn "PM2 не найден, устанавливаю..."
  npm install -g pm2@latest
fi
log_ok "PM2 $(pm2 -v)"

# curl (для тестов)
if ! command -v curl &> /dev/null; then
  log_warn "curl не найден, устанавливаю..."
  apt-get install -y -qq curl
fi

# ─── Шаг 2: Получение кода ───────────────────────────────────────────────────
section "2. Получение кода"

# Останавливаем старый процесс
pm2 delete "${PM2_APP_NAME}" 2>/dev/null || true

# Проверяем, запущены ли мы уже изнутри репозитория
CURRENT_DIR=$(pwd)
IS_INSIDE_REPO=false

if [[ -d "${CURRENT_DIR}/.git" ]] && git remote -v 2>/dev/null | grep -q "SergeyIlins/telphin-bizru-integration"; then
  IS_INSIDE_REPO=true
  INSTALL_DIR="${CURRENT_DIR}"
  log_info "Обнаружен локальный репозиторий, обновляю через git pull..."
  git pull origin main
elif [[ -d "${INSTALL_DIR}/.git" ]]; then
  IS_INSIDE_REPO=true
  INSTALL_DIR="${INSTALL_DIR}"
  log_info "Обнаружен репозиторий в ${INSTALL_DIR}, обновляю..."
  cd "${INSTALL_DIR}"
  git pull origin main
else
  # Чистая установка — клонируем
  log_info "Клонирование из GitHub..."

  # Сохраняем .env если есть
  if [[ -f "${INSTALL_DIR}/.env" ]]; then
    log_info "Сохраняю .env..."
    cp "${INSTALL_DIR}/.env" /tmp/telphin-env-backup
  fi

  # Удаляем старую директорию (только если мы НЕ внутри неё)
  if [[ -d "${INSTALL_DIR}" ]] && [[ "${CURRENT_DIR}" != "${INSTALL_DIR}"* ]]; then
    rm -rf "${INSTALL_DIR}"
  fi

  # Клонируем
  git clone "${REPO_URL}" "${INSTALL_DIR}"
  cd "${INSTALL_DIR}"

  # Восстанавливаем .env
  if [[ -f /tmp/telphin-env-backup ]]; then
    log_info "Восстанавливаю .env из бэкапа..."
    cp /tmp/telphin-env-backup "${INSTALL_DIR}/.env"
    rm /tmp/telphin-env-backup
  fi
fi

log_ok "Код получен: ${INSTALL_DIR}"

# ─── Шаг 3: Установка зависимостей ────────────────────────────────────────────
section "3. Установка npm-зависимостей"

npm ci --production --silent || {
  log_warn "npm ci не сработал, пробую npm install..."
  npm install --production --silent
}
log_ok "Зависимости установлены"

# ─── Шаг 4: Настройка .env ────────────────────────────────────────────────────
section "4. Проверка конфигурации .env"

if [[ ! -f "${INSTALL_DIR}/.env" ]]; then
  log_warn ".env не найден, создаю из шаблона..."
  cp "${INSTALL_DIR}/.env.example" "${INSTALL_DIR}/.env"
  log_err "⚠️  ОБЯЗАТЕЛЬНО отредактируйте ${INSTALL_DIR}/.env перед запуском!"
  echo "   nano ${INSTALL_DIR}/.env"
  echo ""
  echo "   Ключевые поля:"
  echo "     BIZRU_SECRET_KEY=..."
  echo "     TELPHIN_APP_SECRET=..."
  echo "     EMPLOYEE_15657_101=75574|Имя"
  exit 1
fi

# Проверяем, что не остались дефолтные значения
if grep -q "fOzjt3skalowLRhNvE3QDze3y7UBo2LA" "${INSTALL_DIR}/.env"; then
  log_err "В .env остались дефолтные секреты! Отредактируйте файл."
  exit 1
fi

chmod 600 "${INSTALL_DIR}/.env"
log_ok ".env настроен"

# ─── Шаг 5: Создание директорий ─────────────────────────────────────────────
section "5. Создание вспомогательных директорий"

mkdir -p "${LOG_DIR}"
chown -R "$(whoami):$(whoami)" "${INSTALL_DIR}" 2>/dev/null || true
log_ok "Директории созданы"

# ─── Шаг 6: Запуск приложения ─────────────────────────────────────────────────
section "6. Запуск приложения (PM2)"

pm2 start ecosystem.config.js
pm2 save

# Ждём запуска
sleep 3

# ─── Шаг 7: Авто-тестирование ─────────────────────────────────────────────────
section "7. Авто-тестирование"

TEST_PASSED=0
TEST_FAILED=0

# Тест 1: Health check
log_info "Тест 1: Health check (GET /health)..."
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health || echo "000")
if [[ "$HEALTH" == "200" ]]; then
  log_ok "Health check: OK"
  ((TEST_PASSED++))
else
  log_err "Health check: FAIL (HTTP $HEALTH)"
  ((TEST_FAILED++))
fi

# Тест 2: Проверка авторизации Бизнес.Ру
log_info "Тест 2: Авторизация Бизнес.Ру..."
node -e "
const bizru = require('./src/services/bizru');
bizru.authenticate()
  .then(() => { console.log('${GREEN}✅ Бизнес.Ру авторизация: OK${NC}'); process.exit(0); })
  .catch(err => { console.log('${RED}❌ Бизнес.Ру авторизация: FAIL${NC}', err.message); process.exit(1); });
" && ((TEST_PASSED++)) || ((TEST_FAILED++))

# Тест 3: Загрузка сотрудников
log_info "Тест 3: Загрузка сотрудников..."
node -e "
const bizru = require('./src/services/bizru');
const mapper = require('./src/config/employees');
bizru.getEmployees()
  .then(employees => {
    const configured = mapper.getAll();
    console.log('${GREEN}✅ Сотрудники: OK${NC} (загружено ' + (Array.isArray(employees) ? employees.length : 'N/A') + ', настроено ' + configured.length + ')');
    process.exit(0);
  })
  .catch(err => { console.log('${RED}❌ Сотрудники: FAIL${NC}', err.message); process.exit(1); });
" && ((TEST_PASSED++)) || ((TEST_FAILED++))

# Тест 4: Тестовый вебхук
log_info "Тест 4: Обработка тестового вебхука..."
WEBHOOK_RESULT=$(curl -s -X POST http://localhost:3000/test/webhook   -H "Content-Type: application/json"   -d '{
    "CallStatus": "dial-in",
    "CallerIDNum": "79161234567",
    "CalledNumber": "15657*101",
    "CallID": "test-auto-"'"'"$(date +%s)"'"'"
  }' | grep -o '"success":true' || echo "FAIL")

if [[ "$WEBHOOK_RESULT" == '"success":true' ]]; then
  log_ok "Вебхук: OK"
  ((TEST_PASSED++))
else
  log_err "Вебхук: FAIL"
  ((TEST_FAILED++))
fi

# ─── Итоги тестирования ───────────────────────────────────────────────────────
section "8. Итоги деплоя"

echo ""
echo "┌─────────────────────────────────────────────────────────────┐"
echo "│                    РЕЗУЛЬТАТЫ ТЕСТОВ                         │"
echo "├─────────────────────────────────────────────────────────────┤"
printf "│  ✅ Пройдено:  %-3d                                          │\n" "$TEST_PASSED"
printf "│  ❌ Ошибок:    %-3d                                          │\n" "$TEST_FAILED"
echo "└─────────────────────────────────────────────────────────────┘"
echo ""

if [[ "$TEST_FAILED" -gt 0 ]]; then
  log_err "Деплой завершён с ошибками!"
  echo ""
  echo "📋 Логи для диагностики:"
  echo "   pm2 logs ${PM2_APP_NAME} --lines 50"
  echo "   cat ${LOG_DIR}/out.log"
  echo "   cat ${LOG_DIR}/err.log"
  exit 1
fi

log_ok "Все тесты пройдены! Деплой успешен."
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  🚀 ПРИЛОЖЕНИЕ ЗАПУЩЕНО"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  📁 Директория:    ${INSTALL_DIR}"
echo "  📋 Конфигурация:   ${INSTALL_DIR}/.env"
echo "  📜 Логи PM2:      pm2 logs ${PM2_APP_NAME}"
echo "  🔍 Health:        curl http://localhost:3000/health"
echo "  📞 Вебхук:        POST https://your-domain.com/webhook/telphin"
echo ""
echo "  Полезные команды:"
echo "    pm2 status              — статус процессов"
echo "    pm2 logs ${PM2_APP_NAME}     — логи в реальном времени"
echo "    pm2 restart ${PM2_APP_NAME}  — перезапуск"
echo "    pm2 stop ${PM2_APP_NAME}     — остановка"
echo ""
echo "  Автозапуск при ребуте:"
echo "    pm2 startup systemd"
echo "    pm2 save"
echo ""
