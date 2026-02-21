/**
 * PM2 Ecosystem Configuration
 * Production-ready process manager configuration for high availability and auto-scaling
 *
 * Usage:
 *   Development:  pm2 start ecosystem.config.js --env development
 *   Production:   pm2 start ecosystem.config.js --env production
 *   Stop:         pm2 stop ecosystem.config.js
 *   Reload:       pm2 reload ecosystem.config.js
 *   Monitoring:   pm2 monit
 */

module.exports = {
  apps: [
    {
      name: 'medics-gateway',
      script: 'src/index.js',

      // Cluster mode for load balancing across CPU cores
      instances: 'max', // Auto-scale to number of CPU cores (or set to specific number like 4)
      exec_mode: 'cluster', // Enable cluster mode

      // Memory management
      max_memory_restart: '4G', // Auto-restart if process exceeds 4GB
      node_args: '--max-old-space-size=4096 --max-semi-space-size=64',

      // Auto-restart configuration
      autorestart: true,
      max_restarts: 10, // Max 10 restarts within min_uptime
      min_uptime: '10s', // Process must stay up 10s to be considered stable
      restart_delay: 4000, // Wait 4s before restarting

      // Graceful shutdown
      kill_timeout: 5000, // Wait 5s for graceful shutdown before force kill
      listen_timeout: 3000, // Wait 3s for app to be ready

      // Logging
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,

      // Environment variables
      env_development: {
        NODE_ENV: 'development',
        PORT: 4000
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 4000,
        NODE_OPTIONS: '--max-old-space-size=4096'
      },

      // Monitoring
      watch: false, // Disable file watching in production
      ignore_watch: ['node_modules', 'logs', 'test'],

      // Advanced features
      source_map_support: true,
      instance_var: 'INSTANCE_ID', // Inject instance ID as env var

      // Metrics and monitoring
      pmx: true, // Enable PM2 metrics

      // Time-based restart (optional - restart daily at 3 AM)
      cron_restart: '0 3 * * *'
    },

    // Separate process for dedicated worker (optional)
    {
      name: 'medics-worker',
      script: 'src/processor/worker.js',
      instances: 2, // Run 2 worker instances
      exec_mode: 'cluster',
      max_memory_restart: '2G',
      node_args: '--max-old-space-size=2048',
      autorestart: true,
      error_file: './logs/worker-error.log',
      out_file: './logs/worker-out.log',
      env_production: {
        NODE_ENV: 'production',
        WORKER_ONLY: 'true'
      }
    }
  ],

  // Deployment configuration (optional)
  deploy: {
    production: {
      user: 'deploy',
      host: ['prod-server-1', 'prod-server-2'],
      ref: 'origin/main',
      repo: 'git@github.com:yourorg/medics-gateway.git',
      path: '/var/www/medics-gateway',
      'post-deploy': 'npm install && pm2 reload ecosystem.config.js --env production',
      env: {
        NODE_ENV: 'production'
      }
    }
  }
};
