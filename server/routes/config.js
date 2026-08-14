import { Router } from 'express';
import {
  listConfigs,
  getConfig,
  createConfig,
  updateConfig,
  deleteConfig,
  setActive,
} from '../services/apiConfig.js';

const router = Router();

// 列表（api_key 已脱敏）
router.get('/', (req, res) => res.json(listConfigs(req.userId)));

// 详情（含完整 api_key，用于编辑表单回填）
router.get('/:id', (req, res) => {
  const c = getConfig(req.userId, req.params.id);
  if (!c) return res.status(404).json({ error: 'not found' });
  res.json(c);
});

// 新增；首个配置自动启用
router.post('/', (req, res) => {
  const { name, base_url, api_key, model, is_mock } = req.body || {};
  if (!name || !base_url || !api_key) {
    return res.status(400).json({ error: 'name / base_url / api_key 均为必填' });
  }
    const c = createConfig(req.userId, {
      name: String(name),
      base_url: String(base_url),
      api_key: String(api_key),
      model: model ? String(model) : 'gpt-4o-mini',
      is_mock: !!is_mock,
    });
    res.status(201).json(c);
});

// 更新
router.put('/:id', (req, res) => {
  const c = updateConfig(req.userId, req.params.id, req.body || {});
  if (!c) return res.status(404).json({ error: 'not found' });
  res.json(c);
});

// 删除（若删掉活动项，自动激活最近一条）
router.delete('/:id', (req, res) => {
  deleteConfig(req.userId, req.params.id);
  res.json({ ok: true });
});

// 启用某方案
router.post('/:id/activate', (req, res) => {
  setActive(req.userId, req.params.id);
  res.json(getConfig(req.userId, req.params.id));
});

export default router;
