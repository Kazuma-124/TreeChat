# 树形对话 AI 应用设计方案

> 一个支持对话分支、子提问嵌套与智能上下文感知的下一代 AI 对话系统

---

## 目录

1. [市场调研与竞品分析](#1-市场调研与竞品分析)
2. [产品愿景与核心差异](#2-产品愿景与核心差异)
3. [对话树数据模型](#3-对话树数据模型)
4. [智能上下文管理系统（核心创新）](#4-智能上下文管理系统核心创新)
5. [前端 UI/UX 设计](#5-前端-uiux-设计)
6. [后端系统架构](#6-后端系统架构)
7. [技术选型](#7-技术选型)
8. [实现路线图](#8-实现路线图)

---

## 1. 市场调研与竞品分析

### 1.1 现有产品的共同缺陷

当前几乎所有主流 AI 对话产品（ChatGPT、Claude、Gemini、Kimi、DeepSeek 等）都采用**线性对话模型**：用户与 AI 的消息按时间顺序堆叠，所有回答地位平等。当你想对某个具体回答深入追问时，新消息只能追加到列表末尾——这迫使你将一棵思维树压扁成一条线。

### 1.2 树形对话的先行者

| 产品 | 核心机制 | 优势 | 不足 |
|------|----------|------|------|
| **Baobab** | 树节点 + React Flow 可视化图谱 + parentId 链回溯上下文 | 开源、多模型、合并/摘要分支 | 上下文管理仍是简单的线性回溯，无智能选择 |
| **TreeGPT** | DAG（有向无环图）结构，每个节点可生成多分支 | 可视化清晰、节点拓扑布局 | 仅限单一模型、上下文仅沿路径回溯 |
| **KnowTree** | 对话图谱 + 多模型并行对比 + 知识地图 | 多模型并排对比、免费起步 | 上下文管理简单、无元数据索引 |
| **Prompt Tree** | DAG 结构，自由分支 | 轻量、专注 | 功能较基础 |
| **ChatGPT 分支功能** | 从任意历史节点分叉新对话 | 巨头加持、无缝集成 | 分支被复制到独立线性对话，上下文不共享 |

### 1.3 关键洞察：所有现有产品的上下文管理都是"回溯式"的

所有上述产品在构建上下文时，都采用**从当前节点沿 parentId 向根节点回溯**的方式，将路径上的所有消息打包发送给 AI。这种方式的根本问题是：

- **盲打包**：不判断路径上的每条消息是否与当前问题相关
- **无跨分支感知**：无法引用兄弟分支或远端分支的讨论
- **线性膨胀**：随着对话树增长，无关内容也在膨胀，白白消耗 token

**这正是本方案要解决的核心问题。**

---

## 2. 产品愿景与核心差异

### 2.1 一句话定位

**"让 AI 对话像思维一样自然分叉——且 AI 真正理解每一片叶子的来龙去脉。"**

### 2.2 三大核心差异化能力

```
┌──────────────────────────────────────────────────────────────┐
│                      传统线性对话                              │
│                                                              │
│  U1 → A1 → U2 → A2 → U3 → A3 → U4 → A4  （一条线）            │
│                                                              │
│  问题：U4 的上下文被迫包含 A1~A3，即使 A1 完全无关              │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                      本方案：树形对话                            │
│                                                              │
│                   U1（根问题）                                  │
│                  /    |    \                                  │
│               A1.1  A1.2  A1.3  ← 同层多回答                  │
│                |     |                                        │
│               U2    U3                                        │
│              /  \    |                                        │
│            A2.1 A2.2 A3.1                                     │
│             |        |                                        │
│            U4       U5    ← 子提问挂载在具体回答下               │
│                                                              │
│  特点：                                                        │
│  · U4 的上下文可以是 A1.1 + A2.1（仅相关路径）                   │
│  · U4 还可以引用 A1.2 或 A3.1 的内容（跨分支感知）               │
│  · 上下文选择由 AI 根据元数据智能决定，而非简单回溯               │
└──────────────────────────────────────────────────────────────┘
```

| 能力 | 传统线性对话 | 现有树形产品 | **本方案** |
|------|:---------:|:---------:|:------:|
| 对话分支 | ❌ | ✅ | ✅ |
| 子提问挂载 | ❌ | ✅ | ✅ |
| 上下文回溯 | ✅ 线性 | ✅ 路径回溯 | ✅ **智能选择** |
| 跨分支上下文感知 | ❌ | ❌ | ✅ **核心创新** |
| 元数据索引与标签 | ❌ | 部分 | ✅ **核心创新** |
| AI 参与上下文决策 | ❌ | ❌ | ✅ **核心创新** |

---

## 3. 对话树数据模型

### 3.1 核心实体：对话节点（Conversation Node）

每个节点代表一次"一问一答"的基本交互单元。

```typescript
interface ConversationNode {
  // ===== 基础标识 =====
  id: string                    // 唯一 ID（UUID v7，按时间排序）
  
  // ===== 对话内容 =====
  userMessage: UserMessage      // 用户提问
  assistantMessage: AssistantMessage | null  // AI 回答（生成中可为 null）
  status: 'pending' | 'streaming' | 'completed' | 'error'
  
  // ===== 树结构关系 =====
  parentId: string | null       // 父节点 ID（null = 根节点）
  childrenIds: string[]         // 子节点 ID 列表（按创建时间排序）
  siblingIndex: number          // 在兄弟节点中的序号（0-based）
  rootTreeId: string            // 所属对话树的根节点 ID
  depth: number                 // 在树中的深度（根节点 = 0）
  
  // ===== 时间 =====
  createdAt: Date
  updatedAt: Date
  
  // ===== 元数据（用于智能上下文选择） =====
  tags: string[]                // 自动 + 手动标签，如 ["技术方案", "性能优化", "数据库"]
  summary: string               // 一句话摘要（由 AI 自动生成）
  keywords: string[]            // 关键词提取
  embedding: number[] | null    // 内容向量（用于语义相似度检索）
  tokenCount: number            // token 消耗统计
  
  // ===== 模型信息 =====
  modelId: string               // 使用的模型
  modelConfig: ModelConfig      // 模型配置（温度等）
}
```

### 3.2 核心实体：对话树（Conversation Tree）

```typescript
interface ConversationTree {
  id: string                    // 树 ID
  title: string                 // 树标题（自动生成）
  rootNodeId: string            // 根节点 ID
  createdAt: Date
  updatedAt: Date
  
  // 快捷属性（冗余计算，用于快速展示）
  totalNodes: number
  maxDepth: number
  activeLeafCount: number       // 活跃叶子节点数
}
```

### 3.3 核心实体：上下文元数据索引表（Context Index）

这是整个系统的**关键创新**——一张全局的上下文元数据索引表。

```typescript
interface ContextElementMeta {
  // ===== 索引标识 =====
  nodeId: string                // 对应的对话节点 ID
  treeId: string                // 所属对话树 ID
  
  // ===== 时间 =====
  createdAt: Date
  
  // ===== 标签（多维度分类） =====
  tags: string[]                // 自动标签，如 ["前端", "React", "状态管理"]
  autoTags: string[]            // AI 自动生成的精细标签
  userTags: string[]            // 用户手动添加的标签
  
  // ===== 树结构关系 =====
  parentId: string | null       // 父节点
  childrenIds: string[]         // 子节点
  siblingIds: string[]          // 兄弟节点（同级其他回答）
  rootTreeId: string            // 根树
  depth: number                 // 深度
  branchPath: string[]          // 从根到当前节点的完整路径（ID 列表）
  
  // ===== 内容摘要 =====
  summary: string               // 一句话摘要（AI 生成，<100 字）
  userQuestionBrief: string     // 用户提问的简短概括
  assistantAnswerBrief: string  // AI 回答的简短概括
  
  // ===== 语义索引 =====
  keywords: string[]            // 关键词
  embedding: number[]           // 内容向量（如 1536 维 OpenAI embedding）
  
  // ===== 关系元数据 =====
  relationshipToParent: string  // 与父节点的关系描述，如 "追问细节"、"反驳观点"、"切换话题"
  isResolution: boolean         // 是否是一个讨论的"结论/收束"节点
  isDeadEnd: boolean            // 是否标记为"死胡同"（探索失败的分支）
}
```

### 3.4 数据存储策略

```
┌──────────────────────────────────────────────────────────┐
│                     存储层设计                             │
│                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐  │
│  │ PostgreSQL  │  │   Redis     │  │  Vector DB       │  │
│  │             │  │             │  │  (pgvector/      │  │
│  │ · 对话树    │  │ · 会话缓存  │  │   Milvus)        │  │
│  │ · 节点      │  │ · 流式状态  │  │                  │  │
│  │ · 元数据表  │  │ · 热度统计  │  │ · embedding      │  │
│  │ · 用户      │  │             │  │ · 语义相似搜索   │  │
│  └─────────────┘  └─────────────┘  └──────────────────┘  │
│                                                          │
│  前端缓存：IndexedDB（离线 + 快速本地查询）                  │
└──────────────────────────────────────────────────────────┘
```

**为什么用扁平存储而非嵌套存储？**

业界最佳实践（Baobab、CSDN 方案）一致采用**扁平 Map 存储 + parentId 关联**：

- 扁平存储：`Map<string, ConversationNode>` → O(1) 节点查询
- 通过 `parentId` 和 `childrenIds` 按需构建树形结构
- 避免了深层嵌套 JSON 带来的序列化/反序列化开销

---

## 4. 智能上下文管理系统（核心创新）

### 4.1 设计哲学

传统方案的问题：

```
传统方案：当前节点 → 沿 parentId 回溯 → 所有祖先节点 → 打包发给 AI
                           ↑
                    盲打包，不做选择
```

本方案的核心思路：

```
本方案：
  Step 1: 用户提问 → 提取所在节点 → 获取元数据索引表 → 
          将 [用户提问 + 父节点元数据 + 全局元数据表] 发给 AI →
          AI 从全局元数据表中选出与本次提问相关的上下文节点
          
  Step 2: 将 [用户提问 + AI 选中的上下文内容] 发给 AI →
          AI 基于精选上下文生成回答
```

这是**两阶段 AI 调用**：先用小模型做上下文筛选，再用大模型做实际回答。

### 4.2 两阶段上下文选择流程（详细设计）

```
═══════════════════════════════════════════════════════════════════
                    阶段一：上下文筛选（Context Selection）
═══════════════════════════════════════════════════════════════════

输入：
  1. 当前用户提问文本
  2. 当前节点的父节点元数据（relationship、tags、summary）
  3. 当前对话树的完整元数据索引表（所有节点的 ContextElementMeta）
  4. （可选）跨树的全局元数据表

┌─────────────────────────────────────────────────────────────┐
│ Prompt 设计（发送给 AI 的元数据筛选指令）                       │
│                                                             │
│ 你是一个上下文筛选器。                                        │
│                                                             │
│ 【用户当前提问】                                              │
│ {userQuestion}                                              │
│                                                             │
│ 【当前对话节点所在分支的父节点信息】                             │
│ {parentNodeMeta}                                            │
│                                                             │
│ 【全局对话节点元数据表】                                       │
│ | ID | 标签 | 深度 | 关系 | 摘要 |                           │
│ |----|------|------|------|------|                          │
│ | n1 | AI,LLM | 0 | root | 讨论LLM架构选型                   │
│ | n2 | React | 1 | 追问 | React vs Vue对比                  │
│ | n3 | 后端 | 1 | 新分支 | Go语言微服务框架                    │
│ | n4 | DB | 2 | 追问 | PostgreSQL性能优化                    │
│ | ...                                                       │
│                                                             │
│ 【任务】                                                     │
│ 从元数据表中选出与用户当前提问最相关的节点 ID。                  │
│ 选择规则：                                                   │
│ 1. 优先考虑与当前节点在同一分支路径上的节点                      │
│ 2. 考虑标签匹配度高的节点（即使不在同一分支）                    │
│ 3. 考虑语义相似度高的节点                                      │
│ 4. 排除明确标记为 deadEnd 的节点                              │
│ 5. 最多选择 5 个节点，按相关度排序                             │
│                                                             │
│ 返回格式：JSON                                               │
│ {"selectedNodeIds": ["id1","id2",...], "reasoning": "..."}   │
└─────────────────────────────────────────────────────────────┘

输出：
  → selectedNodeIds: 被选中的上下文节点 ID 列表
  → reasoning: 选择理由（可记录用于调试/优化）

═══════════════════════════════════════════════════════════════
                    阶段二：实际对话（Actual Conversation）
═══════════════════════════════════════════════════════════════

输入：
  1. 用户提问文本
  2. 阶段一选中的上下文节点的完整内容
  3. 系统提示词

┌─────────────────────────────────────────────────────────────┐
│ Prompt 设计（发送给 AI 的实际对话指令）                         │
│                                                             │
│ 【系统指令】                                                 │
│ 你是一个专业助手。以下是经过智能筛选的对话上下文。              │
│ 这些上下文来自当前对话树中与用户问题相关的节点，                  │
│ 以及跨分支的相关讨论。请在回答时充分利用这些信息。                │
│                                                             │
│ 【相关上下文】                                               │
│ --- 上下文节点 1 (标签: AI架构, 深度: 0) ---                   │
│ 用户: 我们应该选择哪种LLM部署架构？                             │
│ 助手: 建议考虑以下方案：1. 自建GPU集群 2. 云API...             │
│                                                             │
│ --- 上下文节点 2 (标签: 成本, 深度: 1) ---                     │
│ 用户: 云API的成本大概多少？                                    │
│ 助手: 以GPT-4为例，每百万token约...                            │
│                                                             │
│ --- 上下文节点 4 (标签: 后端, 深度: 1) ---                     │
│ 用户: 后端用什么语言比较好？                                    │
│ 助手: 推荐Go或Python，各有优势...                              │
│                                                             │
│ 【当前提问】                                                 │
│ {userQuestion}                                              │
└─────────────────────────────────────────────────────────────┘

输出：
  → AI 的实际回答
```

### 4.3 上下文选择的优化策略

```
                    ┌──────────────┐
                    │  用户提问     │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
         ┌────▼────┐ ┌────▼────┐ ┌────▼────┐
         │ 向量搜索  │ │ 标签匹配  │ │ 结构遍历  │
         │ (语义)   │ │ (分类)   │ │ (关系)   │
         └────┬────┘ └────┬────┘ └────┬────┘
              │            │            │
              └────────────┼────────────┘
                           │
                    ┌──────▼──────┐
                    │  候选节点集   │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  AI 精排     │  ← 小模型做最终决策
                    │  (GPT-4o-mini│
                    │   或本地模型) │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  最终上下文   │
                    │  (≤ 5 节点)  │
                    └─────────────┘
```

**多路召回 + AI 精排**策略：

| 召回路径 | 方法 | 适用场景 |
|---------|------|---------|
| **向量语义召回** | 用 embedding 计算用户提问与所有节点摘要的余弦相似度 | 跨分支、语义相关但标签不同的节点 |
| **标签匹配召回** | 精确匹配 + 模糊匹配标签 | 同一主题领域的节点 |
| **结构遍历召回** | 沿父链回溯 + 兄弟节点遍历 + 子节点前瞻 | 同一讨论脉络的节点 |
| **时间衰减召回** | 近期节点加权 | 时间相关性 |

三路召回的结果合并去重后，交给一个小模型（如 GPT-4o-mini 或本地部署的轻量模型）做最终精排，选出 3~5 个最相关的上下文节点。

### 4.4 元数据自动生成机制

每个对话节点完成后，**异步触发**元数据生成流水线：

```
节点完成（status = 'completed'）
       │
       ▼
┌──────────────────┐
│ 1. 摘要生成       │  AI 用约 100 字总结此节点的一问一答
└──────┬───────────┘
       ▼
┌──────────────────┐
│ 2. 标签提取       │  AI 提取 3~5 个标签（领域、主题、动作类型）
└──────┬───────────┘
       ▼
┌──────────────────┐
│ 3. 关系判定       │  AI 判定与父节点的关系：
│                  │  "追问细节" / "反驳观点" / "切换话题" /
│                  │  "举例说明" / "总结收束"
└──────┬───────────┘
       ▼
┌──────────────────┐
│ 4. 向量化         │  将摘要用 embedding 模型向量化
└──────┬───────────┘
       ▼
┌──────────────────┐
│ 5. 写入索引表      │  更新 ContextElementMeta 表
└──────────────────┘
```

### 4.5 上下文 Token 预算管理

```typescript
interface ContextBudget {
  maxTotalTokens: number       // 上下文总 token 上限（如 8000）
  maxNodes: number             // 最多包含的上下文节点数（如 5）
  reservedForResponse: number   // 为回答预留的 token（如 4000）
  currentUsage: number         // 当前已用 token
}
```

选择上下文节点时，按优先级排序后逐个加入，直到达到 token 预算上限。

---

## 5. 前端 UI/UX 设计

### 5.1 双视图模式

```
┌─────────────────────────────────────────────────────────────┐
│  [ 树形图谱视图 ]              [ 线程视图 ]     🔍 搜索  ⚙️  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                     ┌──────┐                                │
│                     │ 根问题 │                               │
│                     └──┬───┘                                │
│          ┌─────────────┼─────────────┐                      │
│     ┌────▼────┐   ┌────▼────┐   ┌────▼────┐                 │
│     │ 回答 A  │   │ 回答 B  │   │ 回答 C  │  ← 同级多回答    │
│     └────┬────┘   └────┬────┘   └─────────┘                 │
│    ┌─────┼─────┐       │                                    │
│ ┌──▼──┐ ┌──▼──┐   ┌──▼──┐                                  │
│ │追问1│ │追问2│   │追问3│     ← 子提问挂载                   │
│ └──┬──┘ └──┬──┘   └─────┘                                   │
│ ┌──▼──┐ ┌──▼──┐                                              │
│ │回答 │ │回答 │                                              │
│ └─────┘ └─────┘                                              │
│                                                             │
│  🟢 = 活跃分支    🔴 = 死胡同    ⭐ = 收藏                    │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  缩放: ──○──  |  平移拖拽  |  右键菜单: 分支/追问/标记        │
└─────────────────────────────────────────────────────────────┘
```

**视图一：树形图谱视图（Tree Map View）**

- 使用 React Flow / Cytoscape.js 渲染交互式节点图谱
- 支持缩放（滚轮）、平移（拖拽空白区）、折叠/展开子树
- 节点用颜色区分：用户消息（蓝）、AI 回答（绿）、活跃分支（亮）、死胡同（灰）
- 右键节点弹出操作菜单：追问、查看上下文来源、标记为死胡同、收藏
- 点击节点高亮其上下文路径（哪些节点被用于当前回答）

**视图二：线程视图（Thread View）**

- 沿当前激活路径展示线性对话
- 侧边显示"上下文来源面板"：列出当前回答使用了哪些节点作为上下文
- 分支切换器：在兄弟节点间前后切换（← → 按钮）
- 每个 AI 回答下方显示"在此追问"输入框（突出子提问能力）

### 5.2 核心交互：子提问

这是与传统对话最关键的交互差异：

```
┌─────────────────────────────────────────┐
│  🤖 AI 回答：                              │
│                                          │
│  "建议使用 React Server Components       │
│   来实现这个功能，具体步骤如下：            │
│   1. 创建 Server Component...             │
│   2. 使用 Suspense 包裹...                │
│   3. ..."                                 │
│                                          │
│  ┌──────────────────────────────────┐    │
│  │ 💬 对此回答提出子问题...           │    │  ← 嵌入式追问框
│  └──────────────────────────────────┘    │
│                                          │
│  [📌 标记] [⭐ 收藏] [🔀 重新生成] [🔗 复制链接] │
└─────────────────────────────────────────┘
            │
            │ 用户在此输入子提问
            ▼
┌─────────────────────────────────────────┐
│  🤖 AI 回答：                              │
│  "建议使用 React Server Components..."    │
│       │                                  │
│       ├── 🙋 子提问: "RSC和传统的SSR       │
│       │   有什么区别？"                    │
│       │   └── 🤖 "RSC与SSR的核心区别在于   │
│       │       RSC只在服务端运行..."        │
│       │       ┌──────────────────────┐    │
│       │       │ 💬 继续追问...         │    │  ← 可以无限嵌套
│       │       └──────────────────────┘    │
│       │                                  │
│  ┌──────────────────────────────────┐    │
│  │ 💬 对此回答提出子问题...           │    │  ← 也可以从顶级回答继续
│  └──────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

### 5.3 上下文透明度面板

这是本方案的差异化 UI 组件——让用户看到 AI "使用了哪些记忆"：

```
┌─────────────────────────────────────────┐
│  📋 本次回答的上下文来源                    │
│                                          │
│  ✅ 直接父路径 (自动包含):                  │
│  · 根讨论: "LLM部署架构选型" - 深度0       │
│  · 云API方案对比 - 深度1                  │
│                                          │
│  🔍 智能选择的相关上下文:                   │
│  · "Go语言微服务框架" - 深度2 [标签: 后端]  │  ← 跨分支引用
│  · "PostgreSQL性能优化" - 深度3 [相似度:92%]│
│                                          │
│  ❌ 排除的节点:                            │
│  · "前端动画库选择" [标记: 死胡同]         │
│  · "UI框架对比" [相似度低: 15%]            │
│                                          │
│  📊 上下文统计: 5 节点 | 3200 tokens      │
│                                          │
│  [🔄 重新选择上下文] [✏️ 手动调整]         │
└─────────────────────────────────────────┘
```

### 5.4 组件树（前端架构）

```
src/
├── components/
│   ├── layout/
│   │   ├── AppShell.tsx              # 应用外壳（侧边栏 + 主区域）
│   │   ├── Sidebar.tsx               # 对话树列表
│   │   └── TopBar.tsx                # 顶部工具栏
│   │
│   ├── tree-view/                    # 树形图谱视图
│   │   ├── TreeCanvas.tsx            # 图谱画布（React Flow）
│   │   ├── TreeNodeCard.tsx          # 节点卡片
│   │   ├── TreeEdge.tsx              # 连线组件
│   │   ├── TreeControls.tsx          # 缩放/平移控制
│   │   ├── MiniMap.tsx               # 小地图
│   │   └── NodeContextMenu.tsx       # 右键菜单
│   │
│   ├── thread-view/                  # 线程视图
│   │   ├── ThreadPanel.tsx           # 线程对话面板
│   │   ├── MessageBubble.tsx         # 消息气泡
│   │   ├── BranchIndicator.tsx       # 分支切换指示器
│   │   ├── SubQuestionInput.tsx      # 子提问输入框（嵌入在回答下方）
│   │   └── ContextSourcePanel.tsx    # 上下文来源面板（侧边）
│   │
│   ├── context-panel/                # 上下文透明度面板
│   │   ├── ContextSourcesList.tsx     # 上下文节点列表
│   │   ├── ContextNodeDetail.tsx     # 单个上下文节点详情
│   │   └── ContextAdjustDialog.tsx   # 手动调整上下文对话框
│   │
│   ├── shared/                       # 共享组件
│   │   ├── ChatInput.tsx             # 全局输入框
│   │   ├── ModelSelector.tsx         # 模型选择器
│   │   ├── TagBadge.tsx              # 标签徽章
│   │   ├── MarkdownRenderer.tsx      # Markdown 渲染
│   │   └── TokenCounter.tsx          # Token 计数显示
│   │
│   └── search/                       # 搜索
│       ├── GlobalSearch.tsx          # 全局搜索（跨树搜索节点）
│       └── SearchResults.tsx         # 搜索结果
│
├── hooks/
│   ├── useConversationTree.ts        # 对话树状态 Hook
│   ├── useActivePath.ts              # 当前激活路径 Hook
│   ├── useContextSelection.ts        # 上下文选择 Hook
│   ├── useStreamingResponse.ts       # 流式响应 Hook
│   └── useTreeLayout.ts              # 树布局计算 Hook
│
├── store/
│   ├── treeStore.ts                  # Zustand 树状态
│   ├── contextIndexStore.ts          # 上下文索引表状态
│   └── uiStore.ts                    # UI 状态（视图模式、缩放等）
│
├── services/
│   ├── api/
│   │   ├── chat.ts                   # 对话 API（两阶段调用）
│   │   ├── context.ts                # 上下文索引 API
│   │   └── tree.ts                   # 树结构 API
│   └── context/
│       ├── contextSelector.ts        # 上下文选择器（客户端逻辑）
│       └── metadataGenerator.ts     # 元数据生成触发（客户端）
│
└── utils/
    ├── treeTraversal.ts              # 树遍历算法（回溯、BFS、DFS）
    ├── pathBuilder.ts                # activePath 构建
    ├── similarity.ts                 # 余弦相似度计算
    └── tokenCounter.ts               # Token 估算
```

---

## 6. 后端系统架构

### 6.1 整体架构图

```
                              ┌──────────────┐
                              │   用户浏览器   │
                              │  (React SPA) │
                              └──────┬───────┘
                                     │ WebSocket + HTTP
                                     │
                              ┌──────▼───────┐
                              │  API Gateway │  (Nginx / Kong)
                              └──────┬───────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
     ┌────────▼────────┐   ┌────────▼────────┐   ┌────────▼────────┐
     │  Chat Service   │   │ Context Service │   │ Metadata Service│
     │  (对话服务)      │   │ (上下文服务)     │   │ (元数据服务)     │
     │                 │   │                 │   │                 │
     │ · 流式对话      │   │ · 上下文选择     │   │ · 摘要生成      │
     │ · 两阶段调用    │   │ · Token预算管理  │   │ · 标签提取      │
     │ · 模型路由      │   │ · 缓存管理       │   │ · 关系判定      │
     └────────┬────────┘   └────────┬────────┘   │ · 向量化        │
              │                      │            └────────┬────────┘
              │                      │                      │
              └──────────────────────┼──────────────────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
     ┌────────▼────────┐   ┌────────▼────────┐   ┌────────▼────────┐
     │   PostgreSQL    │   │     Redis       │   │   pgvector      │
     │                 │   │                 │   │   (Vector DB)   │
     │ · 对话树 CRUD   │   │ · 会话缓存      │   │                 │
     │ · 节点数据      │   │ · 流式状态      │   │ · Embedding     │
     │ · 上下文索引表  │   │ · 速率限制      │   │ · 语义搜索      │
     │ · 用户数据      │   │                 │   │                 │
     └─────────────────┘   └─────────────────┘   └─────────────────┘
```

### 6.2 服务职责详解

#### Chat Service（对话服务）

```
API:
  POST /api/chat/send
    → 接收用户消息 + 当前节点 parentId
    → 调用 Context Service 获取精选上下文
    → 调用 LLM API 流式返回
    → 完成后触发 Metadata Service 生成元数据

  POST /api/chat/regenerate
    → 为同一父节点重新生成回答（创建兄弟节点）
  
  POST /api/chat/sub-question
    → 为指定回答节点创建子提问
```

#### Context Service（上下文服务）

```
API:
  POST /api/context/select
    → 输入：用户提问 + 当前节点 ID + 对话树 ID
    → 处理：
        1. 从 DB 加载该树的所有 ContextElementMeta
        2. 多路召回（向量 + 标签 + 结构）
        3. 合并去重
        4. 发送给小模型做精排
    → 输出：selectedNodeIds[] + reasoning

  GET /api/context/index/:treeId
    → 返回指定对话树的完整上下文索引表（给前端展示）
```

#### Metadata Service（元数据服务）

```
异步任务（通过消息队列触发）:
  
  Task: generate-node-metadata
    → 输入：nodeId
    → 处理：
        1. 生成摘要（调用 LLM）
        2. 提取标签（调用 LLM）
        3. 判定与父节点的关系（调用 LLM）
        4. 生成 embedding（调用 embedding 模型）
        5. 写入 ContextElementMeta 表
    
  优化：可合并多个节点的元数据生成请求，批量调用 LLM 降低成本
```

### 6.3 数据库 Schema 设计

```sql
-- 对话树表
CREATE TABLE conversation_trees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(500) NOT NULL,
    root_node_id UUID NOT NULL,
    user_id UUID NOT NULL,
    total_nodes INT DEFAULT 1,
    max_depth INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 对话节点表（扁平存储）
CREATE TABLE conversation_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tree_id UUID NOT NULL REFERENCES conversation_trees(id),
    parent_id UUID,  -- NULL = 根节点
    user_message JSONB NOT NULL,   -- { content, role, timestamp }
    assistant_message JSONB,       -- { content, role, timestamp, model }
    status VARCHAR(20) DEFAULT 'pending',
    sibling_index INT DEFAULT 0,
    depth INT DEFAULT 0,
    model_id VARCHAR(100),
    model_config JSONB,
    token_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 上下文元数据索引表
CREATE TABLE context_metadata (
    node_id UUID PRIMARY KEY REFERENCES conversation_nodes(id),
    tree_id UUID NOT NULL,
    
    -- 标签
    tags TEXT[] DEFAULT '{}',
    auto_tags TEXT[] DEFAULT '{}',
    user_tags TEXT[] DEFAULT '{}',
    
    -- 关系
    parent_id UUID,
    children_ids UUID[] DEFAULT '{}',
    sibling_ids UUID[] DEFAULT '{}',
    branch_path UUID[] DEFAULT '{}',
    relationship_to_parent VARCHAR(50),
    is_resolution BOOLEAN DEFAULT FALSE,
    is_dead_end BOOLEAN DEFAULT FALSE,
    
    -- 摘要
    summary TEXT,
    user_question_brief TEXT,
    assistant_answer_brief TEXT,
    
    -- 关键词
    keywords TEXT[] DEFAULT '{}',
    
    -- 语义向量
    embedding vector(1536),  -- pgvector 扩展
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_nodes_tree_id ON conversation_nodes(tree_id);
CREATE INDEX idx_nodes_parent_id ON conversation_nodes(parent_id);
CREATE INDEX idx_meta_tree_id ON context_metadata(tree_id);
CREATE INDEX idx_meta_tags ON context_metadata USING GIN(tags);
CREATE INDEX idx_meta_embedding ON context_metadata 
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

---

## 7. 技术选型

| 层级 | 技术 | 选型理由 |
|------|------|---------|
| **前端框架** | React 19 + TypeScript | 生态成熟、类型安全、社区活跃 |
| **构建工具** | Vite 6 | 极快的 HMR、ESM 原生支持 |
| **图谱渲染** | React Flow (@xyflow/react v12) | Baobab 同款、成熟稳定、交互丰富 |
| **状态管理** | Zustand v5 | 轻量、TypeScript 友好、无 boilerplate |
| **前端持久化** | Dexie.js (IndexedDB) | 离线能力、大数据量本地缓存 |
| **后端框架** | FastAPI (Python) / Hono (Node.js) | 高性能异步、流式支持好 |
| **数据库** | PostgreSQL 16 + pgvector | 关系 + 向量一体，运维简单 |
| **缓存** | Redis 7 | 会话缓存、流式状态、速率限制 |
| **LLM 调用** | 统一 SDK 抽象层 | 支持 OpenAI / Anthropic / 国产模型 |
| **Embedding** | text-embedding-3-small (OpenAI) 或 bge-large-zh | 1536 维、中文效果好 |
| **实时通信** | WebSocket (ws / Socket.IO) | 流式响应推送、状态同步 |
| **部署** | Docker Compose → K8s | 开发到生产平滑过渡 |

### 7.1 LLM 提供商抽象层

```typescript
interface LLMProvider {
  // 基础能力
  chat(messages: Message[], options: ChatOptions): AsyncGenerator<ChatChunk>
  chatSync(messages: Message[], options: ChatOptions): Promise<ChatResponse>
  
  // 元数据生成能力（可能使用更便宜的模型）
  generateSummary(node: ConversationNode): Promise<string>
  extractTags(node: ConversationNode): Promise<string[]>
  classifyRelationship(parent: ConversationNode, child: ConversationNode): Promise<string>
  
  // 上下文选择能力（使用轻量模型）
  selectContext(query: string, metaTable: ContextElementMeta[]): Promise<string[]>
  
  // 能力声明
  supportsStreaming: boolean
  supportsToolUse: boolean
  maxContextTokens: number
}
```

---

## 8. 实现路线图

### Phase 1：MVP（2~3 周）

```
目标：跑通核心流程，验证可行性

□ 基础对话树数据结构（扁平存储 + parentId 关联）
□ 线程视图（Thread View）基础UI
□ 子提问功能（在回答下方嵌入追问框）
□ 简单上下文管理（沿 parentId 回溯）
□ 单模型接入（OpenAI 兼容 API）
□ 本地持久化（IndexedDB，纯前端版）
```

### Phase 2：树形可视化（2~3 周）

```
□ 树形图谱视图（React Flow 渲染）
□ 节点交互（点击、缩放、平移、右键菜单）
□ 分支切换器（兄弟节点间前后跳转）
□ 死胡同标记、收藏标记
□ 最小化树（折叠不活跃分支）
```

### Phase 3：智能上下文（3~4 周）

```
□ 后端服务搭建（FastAPI + PostgreSQL + Redis）
□ 上下文元数据表设计与实现
□ 元数据自动生成流水线（摘要 + 标签 + 关系 + 向量化）
□ 多路召回实现（向量 + 标签 + 结构）
□ 两阶段 AI 调用（小模型筛选 → 大模型回答）
□ 上下文来源透明度面板
```

### Phase 4：高级功能（3~4 周）

```
□ 跨对话树的全局上下文感知
□ 手动上下文调整（用户增减上下文节点）
□ 上下文 Token 预算可视化管理
□ 多模型支持与对比
□ 对话树导入/导出（JSON、Markdown）
□ 全文搜索（跨树搜索节点内容）
□ 分支合并（将子分支结论合并回父分支）
□ 分支摘要（自动总结分支讨论要点）
```

### Phase 5：打磨与发布（2~3 周）

```
□ 性能优化（虚拟化大列表、图谱增量渲染）
□ 移动端适配
□ 暗色/亮色主题
□ 用户系统与云端同步
□ 协作功能（分享对话树链接）
□ 自动化测试与 CI/CD
```

---

## 附录 A：与其他产品的架构对比

```
                    ┌──────────────┬──────────────┬──────────────┐
                    │   传统线性     │   现有树形     │   本方案       │
                    │   (ChatGPT)   │   (Baobab)    │              │
├───────────────────┼──────────────┼──────────────┼──────────────┤
│ 数据结构           │ 数组          │ 扁平Map+树    │ 扁平Map+树    │
│ 上下文构建         │ 全量回溯      │ 路径回溯      │ 智能选择      │
│ 跨分支感知         │ ❌           │ ❌           │ ✅           │
│ 元数据索引         │ ❌           │ 部分          │ ✅           │
│ 上下文透明度       │ ❌           │ ❌           │ ✅           │
│ 两阶段AI调用       │ ❌           │ ❌           │ ✅ 核心创新   │
│ 子提问嵌套         │ ❌           │ ✅           │ ✅           │
│ 标签系统           │ ❌           │ ✅           │ ✅           │
│ 向量语义搜索       │ ❌           │ ❌           │ ✅           │
└──────────────────┴──────────────┴──────────────┴──────────────┘
```

## 附录 B：关键设计决策记录

1. **为什么上下文选择用 AI 而非纯算法？**
   纯算法（向量相似度 + 标签匹配）无法理解对话的细微语义关系。例如："刚才那个方案的替代方案是什么？"——纯算法很难将"刚才那个方案"与具体的上下文节点关联。AI 做上下文选择可以利用其对自然语言的理解能力，做出更精准的判断。

2. **上下文选择阶段的成本和延迟如何控制？**
   - 使用最便宜的模型（如 GPT-4o-mini 或本地部署的 Qwen2.5-7B）
   - 元数据表已经做了摘要压缩，传入的数据量很小（每条约 100 tokens）
   - 元数据选择通常在 500ms 内完成

3. **为什么不直接拼一个大 context 让大模型自己筛选？**
   - Token 成本：一个大型对话树可能有上百个节点
   - 注意力稀释：无关内容过多会降低大模型的回答质量
   - 两阶段架构将"筛选"和"生成"解耦，每个阶段用最合适的模型

---

> **文档版本**: v1.0  
> **编写日期**: 2026-08-12  
> **设计目标**: 实现一个真正理解对话树结构、具有智能上下文感知能力的下一代 AI 对话应用
