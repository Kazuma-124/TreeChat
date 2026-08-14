// PM2 启动配置：常驻后端服务
// 用法（在 server/ 目录下）：
//   pm2 start ecosystem.config.cjs
//   pm2 save && pm2 startup   # 开机自启
//
// 重要：better-sqlite3 是本地文件库，必须单进程（fork + instances:1），
// 开 cluster 多实例会导致 SQLite 写锁冲突。

module.exports = {
  apps: [
    {
      name: 'treechat-server',
      cwd: __dirname,
      script: 'index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
    },
  ],
};
