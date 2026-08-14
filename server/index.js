import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import treesRouter from './routes/trees.js';
import chatRouter from './routes/chat.js';
import searchRouter from './routes/search.js';
import configRouter from './routes/config.js';
import { migratePlaintextKeys } from './services/apiConfig.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/trees', treesRouter);
app.use('/api/chat', chatRouter);
app.use('/api/search', searchRouter);
app.use('/api/configs', configRouter);

// 404 兜底：所有未匹配的 API 路由统一返回 JSON 错误，避免前端收到 HTML
app.use((req, res) => {
  res.status(404).json({ error: `Not Found: ${req.method} ${req.path}` });
});

// 统一错误处理中间件：捕获路由中 throw 的异常，避免进程崩溃
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('Server error:', err);
  if (!res.headersSent) {
    res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
});

const PORT = process.env.PORT || 3001;
migratePlaintextKeys(); // 加密历史明文 API Key

function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`TreeChat server running on http://localhost:${port}`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`端口 ${port} 已被占用，请先关闭占用进程或设置环境变量 PORT 后重试。`);
    } else {
      console.error('服务启动失败：', err);
    }
    process.exit(1);
  });
}

startServer(PORT);
