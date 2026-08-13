# 树形对话 AI 应用 —— MVP 合并设计方案

> 设计目标：以「极简可落地」为骨架（源自方案2），融合方案1 的两点优势——**更完整的上下文元素数据模型**与**提前的上下文透明度面板**。
> 一句话定位：让 AI 对话像思维一样分叉，且 AI 真正理解每一片叶子的来龙去脉，但第一版用最小成本跑通。

---

## 一、核心概念

| 概念 | 定义 |
|------|------|
| **上下文元素（CE, Context Element）** | 树的最小节点 = 一对「用户提问 + AI 回答」。也是上下文组装的最小单元。 |
| **对话树（Tree）** | 一棵 CE 组成的树。对回答发起子提问 → 子节点；同回答多个子提问/重新生成 → 兄弟节点。 |
| **元数据索引（Metadata Index）** | 所有 CE 的轻量投影（不含完整内容），用于阶段一检索。 |
| **两阶段上下文引擎** | 阶段一（检索）：用 LLM 从全树元数据中选相关 CE；阶段二（生成）：用选中 CE 完整内容生成回答。 |
| **祖先路径兜底** | 当前节点到根的路径视为直接上下文，**强制选中，不经 LLM 判断**；LLM 只负责跨分支召回。这是检索选错时的安全网。 |

**与现有产品的差异**：

- ChatGPT 分支：分叉即复制成新对话，分支间无法互引。
- Sapling：只沿父链取祖先，无法引用兄弟分支。
- CTA 论文：规则/手动传递上下文，无 LLM 智能检索。
- **本方案**：单棵树 + LLM 驱动的跨分支检索，祖先路径兜底 + 跨分支智能召回。

---

## 二、技术栈（极简优先）

沿用方案2 的选型，MVP 阶段不引入重组件：

| 层 | 技术 | 理由 |
|----|------|------|
| 前端 | React + Vite + TypeScript | 启动快、聊天 UI 组件多 |
| UI 组件 | Tailwind CSS + shadcn/ui | 快速搭界面，少写 CSS |
| 后端 | Node.js + Express | 已有 Node 环境，轻量 API 转发 |
| 数据库 | SQLite（better-sqlite3） | 零配置单文件，本地应用足够 |
| LLM 调用 | 直接 fetch OpenAI 兼容 API | DeepSeek / Claude / OpenAI 同格式 |
| 实时输出 | SSE（Server-Sent Events） | 流式回答，比 WebSocket 简单 |

> **明确不做（MVP 阶段）**：Redis、向量数据库（pgvector/Milvus）、消息队列、微服务拆分、K8s。
> **预留接口**：元数据生成与检索逻辑封装为独立 service，远期可无痛替换为向量召回 / 多服务架构（见第十节）。

---

## 三、数据模型（融合版）

融合方案1 的字段严谨度与方案2 的极简。SQLite 用 `TEXT` 存 JSON 数组/对象。

### 3.1 对话树表 `conversation_trees`

```typescript
interface ConversationTree {
  id: string;              // 树 ID（UUID）
  title: string;           // 标题（从根节点提问自动生成）
  root_node_id: string;    // 根节点 ID
  created_at: number;
  updated_at: number;
}
```

### 3.2 上下文元素表 `context_elements`（核心表）

相比方案2 增补：`status`、`sibling_index`、`model_config`、`token_count`、`embedding`（预留，MVP 可为 null）、并把 `context_element_ids` 快照保留以做追溯。

```typescript
interface ContextElement {
  // === 基础标识 ===
  id: string;                    // 节点 UUID
  tree_id: string;               // 所属树

  // === 树关系 ===
  parent_id: string | null;      // 父节点（根 = null）
  sibling_index: number;         // 兄弟序号（0-based，保证排序稳定）
  depth: number;                 // 深度（根 = 0）

  // === 对话内容 ===
  user_message: string;          // 用户提问
  ai_message: string | null;     // AI 回答（生成中 = null）
  model: string;                 // 使用的模型
  model_config: object;          // { temperature, top_p, ... }（预留）

  // === 状态（新增，支撑流式与错误态）===
  status: 'pending' | 'streaming' | 'completed' | 'error';

  // === 元数据（阶段一检索用）===
  summary: string;               // 摘要（AI 生成，50–100 字）
  tags: string[];                // 标签（AI 生成，3–5 个）
  token_count: number;           // 本次消耗 token（统计用）

  // === 上下文快照（追溯用）===
  context_element_ids: string[]; // 本次回答实际用了哪些 CE 的 ID

  // === 语义向量（预留，MVP 可为 null）===
  embedding: number[] | null;

  // === 探索标记（借鉴 CTA）===
  is_volatile: boolean;          // 探索节点（默认 false）

  created_at: number;
  updated_at: number;
}
```

### 3.3 元数据索引 `metadata_index`（阶段一发送内容）

从 `context_elements` 投影的轻量视图，**不含完整对话内容**，控制 token：

```typescript
interface MetadataEntry {
  id: string;
  parent_id: string | null;
  sibling_index: number;
  depth: number;
  summary: string;        // "讨论了 TCP 三次握手与 SYN 洪泛攻击"
  tags: string[];         // ["TCP", "网络", "三次握手"]
  is_volatile: boolean;
  created_at: number;
}
```

> 关键约束：每条元数据 50–100 token。200 个节点时整表约 1–2 万 token，多数模型窗口装得下。

---

## 四、两阶段上下文引擎

### 阶段一：上下文检索（Context Retrieval）

```
输入：
  1. 当前节点 N 的祖先路径元数据（根 → N，强制全选，不经 LLM）
  2. 全树元数据索引表
  3. 用户新提问
输出：
  选中的跨分支 CE ID 列表 + reasoning
```

**设计要点（继承方案2 的扎实决策）**：

1. **祖先路径默认全选**——直接上下文，不浪费一次 LLM 判断。
2. **LLM 只做跨分支召回**——这是与 Sapling 等的核心差异。
3. **用便宜模型**（DeepSeek-Chat / GPT-4o-mini）做检索，省成本。
4. **返回结构化 JSON**（`{selected_ids, reasoning}`），便于程序解析。
5. **Token 预算**：prompt 内告知总预算（如 8000），控制选择数量。

**检索选错的兜底**：祖先路径强制选中，即使阶段一返回空也至少有直接上下文可用。

### 阶段二：回答生成（Generation）

```
输入：
  1. System Prompt（明确区分【直接上下文】与【相关上下文】）
  2. 选中的 CE 完整内容（祖先路径按时间序 + 跨分支召回按相关度序）
  3. 用户新提问
输出：
  AI 回答 + 顺带返回 summary / tags（省一次调用）
```

阶段二 prompt 末尾附加不可见元数据块：

```
<metadata>{"summary":"...","tags":["TCP","SYN cookies"]}</metadata>
```

程序解析提取后写入 `context_elements` 与 `metadata_index`。

### Token 预算分配（64K 窗口，预留 8K 给回答）

| 部分 | 预算 | 说明 |
|------|------|------|
| System Prompt | 1K | 角色 + 区分上下文类型 |
| 祖先路径完整内容 | 动态 | 浅时全放，深时早期节点用摘要替代 |
| 跨分支召回内容 | 动态 | 阶段一控制数量 |
| 当前提问 | 0.5K | |
| 回答预留 | 8K | max_tokens |

**祖先路径降级**：路径 token < 预算 60% 全放全文；超出时最近 5 个放全文，更早的用 `summary` 替代。

### 元数据表过大的优化（后期）

- 方案A（MVP）：只发最近 N 个节点 + 祖先路径，更早不参与检索。
- 方案B（进阶）：对 `summary+tags` 做 embedding，向量库粗筛 top-20 再 LLM 精选（即方案1 的多路召回）。
- 方案C（折中）：按标签预筛选，只发与提问标签有交集的 CE。

---

## 五、上下文透明度面板（提前，源自方案1）

**这是差异化卖点，MVP 即从「后期」提前**。目的：让用户看见 AI「用了哪些记忆」，同时缓解「检索选错」带来的不信任。

```
┌─────────────────────────────────────────┐
│  📋 本次回答的上下文来源                  │
│                                         │
│  ✅ 直接上下文（祖先路径，自动包含）:      │
│  · CE-001 讨论了 TCP 三次握手 - 深度0     │
│  · CE-005 讨论了 SYN 洪泛攻击 - 深度1     │
│                                         │
│  🔍 智能召回（跨分支）:                   │
│  · CE-003 讨论了 TCP 拥塞控制 [相似度高]  │
│                                         │
│  ❌ 排除的节点:                          │
│  · CE-002 UDP 游戏应用 [无关]            │
│                                         │
│  📊 统计: 3 节点 | 2100 tokens          │
│  [✏️ 手动调整上下文]                     │
└─────────────────────────────────────────┘
```

- MVP：只读展示（选中了什么、排除了什么）。
- 进阶：用户可手动增删上下文节点后重新生成（方案1 的 `ContextAdjustDialog`）。

---

## 六、UI/UX 设计

### 主界面

```
┌──────────────────────────────────────────────┐
│  侧边栏：对话树列表          │  主聊天区        │
│  📁 TCP 网络学习             │  Q: TCP 三次握手  │
│  📁 Godot 项目讨论           │  A: 三次握手是..  │
│  📁 秋招准备                 │    ├─ 子提问 ↓    │
│                            │    │ Q: SYN 攻击?  │
│                            │    │ A: 攻击是..    │
│                            │    │   └─ 子提问↓  │
│                            │  [输入框]          │
└────────────────────────────┴────────────────┘
```

### 交互要点

1. **默认显示活跃路径**（根 → 当前节点），像普通聊天。
2. **子提问缩进**：AI 回答下方「💬 追问」→ 子回答缩进显示，可无限嵌套。
3. **兄弟节点切换**：`< 1/3 >` Tab，类似 ChatGPT 多回答切换。
4. **上下文来源面板**：每个回答下方内嵌第五节面板（折叠默认）。
5. **探索节点（Volatile，借鉴 CTA）**：子提问可勾选「探索模式」，虚线/半透明标记；删除时弹「合并到父节点 / 直接丢弃」。
6. **树可视化（轻量，MVP 末期或可选）**：按钮弹出 React Flow 全屏图，节点显示摘要，点击跳转；当前路径高亮。MVP 不阻塞主流程。

---

## 七、项目结构

```
tree-chat/
├── server/
│   ├── index.js                 # Express 入口 + SSE
│   ├── db.js                    # SQLite 初始化 + 查询
│   ├── routes/
│   │   ├── trees.js             # 对话树 CRUD
│   │   └── chat.js              # 发送消息、两阶段调用、SSE 流式
│   ├── services/
│   │   ├── contextRetriever.js  # 阶段一：元数据检索（LLM）
│   │   ├── chatGenerator.js     # 阶段二：生成 + 顺带 metadata
│   │   ├── metadataGenerator.js  # summary/tags 解析与写入
│   │   └── treeTraversal.js     # 祖先路径回溯、兄弟/子树遍历
│   └── prompts/
│       ├── retrieve.txt         # 阶段一 system prompt
│       └── generate.txt         # 阶段二 system prompt
├── src/                         # React 前端
│   ├── App.tsx
│   ├── components/
│   │   ├── ChatWindow.tsx       # 主聊天区（递归渲染子节点）
│   │   ├── MessageNode.tsx      # 单条消息
│   │   ├── SubQuestion.tsx      # 子提问输入框
│   │   ├── BranchSwitcher.tsx   # 兄弟节点切换
│   │   ├── ContextSourcePanel.tsx  # 上下文透明度面板（提前）
│   │   └── TreeSidebar.tsx      # 对话树列表
│   └── api.ts                   # 后端 API 调用（含 SSE）
└── package.json
```

---

## 八、分阶段实现路线

### 第一阶段：最小可用（1–2 周）
- [ ] SQLite 建表（树 + CE，含 `status`/`sibling_index`）
- [ ] 后端：发送消息 API，**先只用祖先路径作上下文**（跳过阶段一）
- [ ] 前端：基础聊天 + 子提问缩进 + 兄弟切换
- [ ] 能创建树、发消息、子提问、切分支

### 第二阶段：两阶段上下文引擎（1 周）
- [ ] 阶段一：元数据检索 API + prompt
- [ ] 阶段二：组装上下文 + 生成，**顺带返回 summary/tags**
- [ ] Token 预算 + 祖先路径降级
- [ ] **上下文透明度面板（ContextSourcePanel）只读展示**
- [ ] 对比测试：开/关跨分支检索的回答质量差异

### 第三阶段：体验优化（1–2 周）
- [ ] SSE 流式输出
- [ ] 探索节点（Volatile）+ 合并/丢弃
- [ ] 多模型切换（DeepSeek / Claude / OpenAI）
- [ ] 对话树导入/导出（JSON / Markdown）

### 第四阶段：进阶（可选）
- [ ] 向量召回优化（元数据过大时，方案 B）
- [ ] 手动调整上下文并重生成
- [ ] 轻量树可视化面板
- [ ] 全局搜索（跨树搜 CE）
- [ ] 节点标签手动编辑

---

## 九、关键风险与应对（继承方案2）

| 风险 | 应对 |
|------|------|
| 阶段一增加延迟 | 用便宜/快速模型；SSE 先推阶段二结果；阶段一可并行预取 |
| 阶段一选错上下文 | **祖先路径强制选中兜底**；透明度面板展示引用分支，用户可手动调整 |
| 元数据摘要质量差 | summary 用较强模型；tags 控 3–5 个；后期加向量召回补充 |
| 跨分支上下文致「精神分裂」 | prompt 明确区分【直接上下文】与【相关上下文】，相关上下文仅供参考 |
| token 消耗翻倍 | 阶段一用 mini 模型（成本约 1/10）；元数据极短；祖先路径超长用摘要替代 |

---

## 十、与远期架构的衔接

本 MVP 把检索/生成/元数据逻辑封装为独立 service，远期可平滑演进到方案1 的理想态，而**不推翻现有数据结构**：

1. **检索升级**：阶段一从「发全表给 LLM」升级为方案1 的「向量 + 标签 + 结构 + 时间衰减」多路召回 + 小模型精排（`embedding` 字段已预留）。
2. **存储升级**：SQLite → PostgreSQL + pgvector；如需缓存/队列再加 Redis / MQ（当前不需要）。
3. **服务拆分**：Express 单进程 → Chat / Context / Metadata 三个服务（service 边界已清晰）。
4. **前端增强**：线程视图之外补方案1 的树形图谱视图（React Flow），与现有 `MessageNode` 递归渲染并存。

> 数据结构（CE + MetadataEntry）在 MVP 与远期保持一致，升级只换「检索实现」与「存储后端」，不迁移业务模型。

---

> **文档版本**: v1.0（合并版）
> **基线**: 方案2 骨架 + 方案1 两点融合（完整数据模型、提前的透明度面板）
> **编写日期**: 2026-08-12
