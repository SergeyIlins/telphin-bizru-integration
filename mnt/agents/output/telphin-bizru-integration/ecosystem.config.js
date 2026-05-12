module.exports = {
  apps: [{
    name: 'telphin-integration',
    script: './src/server.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production'
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    merge_logs: true,
    max_memory_restart: '256M',
    restart_delay: 3000,
    max_restarts: 5,
    min_uptime: '10s',
    watch: false,
    // Автоперезапуск при падении
    autorestart: true,
    // Graceful shutdown
    kill_timeout: 5000,
    listen_timeout: 10000
  }]
};
