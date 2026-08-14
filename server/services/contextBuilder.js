// 上下文组装：祖先路径（直接上下文，强制包含）+ 跨分支召回，按 token 预算裁剪。
// 阶段一输出的结构化计划决定「每个节点纳入到什么层级、资源原文要不要纳入」：
//   nodePlan[id] = none | question | question+desc | question+resource
//   context_intent = none | light | normal | full（none 时丢弃所有跨分支且不纳资源原文）
// 资源纳入层级：none/desc/raw（desc 仅描述文本，raw 含原文/原图）。

const est = (s) => Math.ceil((s?.length || 0) / 4);

function parseNodeResources(ce) {
  try {
    const arr = ce.resources ? JSON.parse(ce.resources) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// 单节点 token 估算：含 resourceMode 下应计入的资源内容。
function nodeTokens(n) {
  let t = est(n.user_message) + est(n.ai_message || n.summary || '');
  if (n.resources && n.resourceMode !== 'none') {
    for (const r of n.resources) {
      if (n.resourceMode === 'raw') t += est(r.content || '');
      else if (n.resourceMode === 'desc') t += est(r.description || '');
    }
  }
  return t;
}

// tier -> 资源纳入层级
function resModeOf(tier) {
  if (tier === 'question+resource') return 'raw';
  if (tier === 'question+desc') return 'desc';
  return 'none';
}

export function buildContext({ ancestorChain = [], crossNodes = [], plan = {}, budget = 6000 }) {
  const intent = plan.context_intent || 'normal';
  const nodePlan = plan.nodePlan || {};
  const includeCross = intent !== 'none';

  // 把 DB 行加工成带资源数组 + 资源纳入层级的内部节点
  const prep = (ce, fallback) => {
    const resources = parseNodeResources(ce);
    let tier = nodePlan[ce.id] || fallback;
    // 严格模式：none 意图下，不纳任何资源原文，祖先链也最多 question
    if (intent === 'none' && tier !== 'none') tier = 'question';
    return {
      id: ce.id,
      user_message: ce.user_message,
      ai_message: ce.ai_message || '',
      summary: ce.summary || '',
      resources,
      resourceMode: resModeOf(tier),
      included: tier !== 'none',
    };
  };

  const directRaw = ancestorChain.map((n) => prep(n, 'question'));
  const crossRaw = includeCross ? crossNodes.map((n) => prep(n, 'question')) : [];

  // 预算超 60% 时降级：更早的祖先与跨分支节点仅保留提问 + 用摘要替代完整回答，且不纳资源原文。
  const all = [...directRaw, ...crossRaw];
  const total = all.reduce((a, n) => a + nodeTokens(n), 0);
  const degrade = total > budget * 0.6;
  const recentFrom = Math.max(0, directRaw.length - 5);

  const direct = [];
  directRaw.forEach((n, i) => {
    if (!n.included) return;
    let { resourceMode } = n;
    let aiMessage = n.ai_message;
    if (degrade && i < recentFrom) {
      resourceMode = 'none';
      aiMessage = n.summary || n.ai_message;
    }
    direct.push({
      id: n.id,
      userMessage: n.user_message,
      aiMessage,
      resources: n.resources,
      resourceMode,
      degraded: degrade && i < recentFrom,
    });
  });

  let used = direct.reduce((a, n) => a + nodeTokens(n), 0);
  const cross = [];
  for (const n of crossRaw) {
    if (!n.included) continue;
    let { resourceMode } = n;
    let aiMessage = n.ai_message;
    if (degrade) {
      resourceMode = 'none';
      aiMessage = n.summary || n.ai_message;
    }
    const cand = {
      id: n.id,
      userMessage: n.user_message,
      aiMessage,
      resources: n.resources,
      resourceMode,
      degraded: degrade,
    };
    const t = nodeTokens(cand);
    if (used + t > budget) break;
    cross.push(cand);
    used += t;
  }

  return { direct, cross, intent };
}
