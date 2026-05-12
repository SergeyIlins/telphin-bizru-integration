/**
 * Централизованная обработка ошибок
 * Логирование + стандартный ответ клиенту
 */

function errorHandler(err, req, res, next) {
  const timestamp = new Date().toISOString();

  // Логируем полную ошибку
  console.error(`[${timestamp}] ❌ Ошибка:`);
  console.error('  Message:', err.message);
  console.error('  Stack:', err.stack);

  if (err.response) {
    console.error('  API Response:', {
      status: err.response.status,
      data: err.response.data
    });
  }

  // Ответ клиенту (не раскрываем детали)
  const status = err.status || err.statusCode || 500;
  const message = status >= 500 
    ? 'Internal server error' 
    : (err.message || 'Bad request');

  res.status(status).json({
    success: false,
    error: message,
    timestamp
  });
}

module.exports = errorHandler;
