import { verifyToken } from '../services/auth.js';

// 登录校验中间件：从 Authorization: Bearer <token> 解析 userId，注入 req.userId / req.isAdmin。
// 失败时返回 401，所有受保护接口挂载本中间件。
export function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录' });
  }
  const token = header.slice(7).trim();
  try {
    const payload = verifyToken(token);
    req.userId = payload.sub;
    req.isAdmin = !!payload.isAdmin;
    req.username = payload.username;
    next();
  } catch {
    res.status(401).json({ error: '登录已过期或无效' });
  }
}
