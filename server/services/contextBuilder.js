// 上下文组装：祖先路径（直接上下文，强制包含）+ 跨分支召回，按 token 预算裁剪。
// 祖先路径超预算 60% 时：仅保留最近 5 个全文，更早的用摘要替代（降级）。
// 跨分支节点在剩余预算内依次加入。

const est = (s) => Math.ceil((s?.length || 0) / 4);
const nodeTokens = (n) => est(n.user_message) + est(n.ai_message || n.summary || '');

export function buildContext({ ancestorChain = [], crossNodes = [], budget = 6000 }) {
  const degrade = ancestorChain.reduce((a, n) => a + nodeTokens(n), 0) > budget * 0.6;
  const recentFullFrom = Math.max(0, ancestorChain.length - 5);

  const direct = ancestorChain.map((n, i) => {
    if (degrade && i < recentFullFrom) {
      // 降级：用摘要代替完整回答
      return {
        id: n.id,
        userMessage: n.user_message,
        aiMessage: n.summary || n.ai_message || '',
        degraded: true,
      };
    }
    return { id: n.id, userMessage: n.user_message, aiMessage: n.ai_message || '', degraded: false };
  });

  let used = direct.reduce((a, n) => a + est(n.userMessage) + est(n.aiMessage), 0);
  const cross = [];
  for (const n of crossNodes) {
    const t = nodeTokens(n);
    if (used + t > budget) break;
    cross.push({ id: n.id, userMessage: n.user_message, aiMessage: n.ai_message || '', degraded: false });
    used += t;
  }

  return { direct, cross };
}
