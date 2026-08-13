import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import treesRouter from './routes/trees.js';
import chatRouter from './routes/chat.js';
import searchRouter from './routes/search.js';
import configRouter from './routes/config.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/trees', treesRouter);
app.use('/api/chat', chatRouter);
app.use('/api/search', searchRouter);
app.use('/api/configs', configRouter);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`TreeChat server running on http://localhost:${PORT}`);
});
