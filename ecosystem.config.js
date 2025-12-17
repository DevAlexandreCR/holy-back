module.exports = {
  apps: [{
    name: 'holyverso-api',
    script: './dist/server.js',
    instances: 1,  // O 'max' para usar todos los CPUs
    exec_mode: 'cluster',
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    max_memory_restart: '1G',
    watch: false,

    // Restart strategies
    exp_backoff_restart_delay: 100,
    max_restarts: 10,
    min_uptime: '10s',

    // Cron job para daily verse (opcional, si no lo manejas en código)
    // cron_restart: '0 0 * * *'  // Restart diario a medianoche
  }]
}