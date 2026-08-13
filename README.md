# TreeChat · 树形 AI 对话

一个把 AI 对话组织成**树**而不是线性列表的应用：你可以配置自己的 AI API，对任意一条「回答」继续追问，追问与回复会作为**子节点**挂在这条回答之下，从而让同一个话题长出多条可独立浏览的分支；同时每个节点会自动整理成「上下文元素」，并用两阶段机制为每次提问挑选相关上下文。

> 本项目源自一份原始需求（见仓库内 `树形对话AI应用原始需求.md`）：解决传统线性对话「新提问总是与当前对话平级、把之前的对话顶上去，想返回某个回答只能往前翻」的痛点。本 README 以该需求文本为基础，结合当前已落地的功能重新整理。

**创作说明**：本项目的**技术实现**（前端 / 后端 / 数据库 / 上下文引擎等全部代码）由 AI（CodeBuddy）辅助生成；**产品构想与需求**由本人提出——包括对「为什么用树形而非线性对话」「子提问挂为子节点」「上下文元素总表 + 每节点上下文子集」「两阶段选上下文」等核心机制的设想，并整理为原始需求文档（见 `树形对话AI应用原始需求.md`）。本人负责定义「要做什么、为何这么做」，AI 负责把它落地为可运行的代码。

---

## 一、原始需求与产品定位

原始需求的核心设想：

1. **可配置自己的 AI API**：不绑定某家模型，用 OpenAI 兼容接口接入自有 Key。
2. **对某个具体回答做子提问**：子提问与对应回答（即子对话）作为「当前对话」的**子节点**附加在它之下；而非像线性应用那样新对话总与当前对话平级、跟在后面。
3. **为什么是树，不是线**：线性应用里，对某个回答的提问会把之前的对话顶上去，看完新提问想返回之前的回答只能往前翻，很麻烦；树形结构让「从任意回答分叉」成为自然操作。
4. **节点 = 一问一答**：节点之间可以是**父子**的树形关系、**同父的平级**关系，也可以**没有关系**。对某回答的子提问 + 其回复 = 子节点；该回答 + 其提问 = 父节点。
5. **上下文元素机制**：实时整理每个节点的上下文——把「一对用户提问与对应回答」映射为上下文元素，为之生成描述内容的大致文本（摘要）、打标签、记录产生时间、记录与其它元素的关系（父节点 / 子节点 / 所属树）；所有上下文元素加标识 ID 形成**上下文元素总表**；每个问答节点再记录「本次提问用了哪些上下文元素」，它是总表的**子集**。
6. **两阶段选上下文**：每次提问时，先把「该提问所属节点的父节点的上下文元数据 + 全部上下文元素元数据 + 用户提问」发给 API，让 API 从总表中选出与本次提问相关的上下文；应用再据此决定本次应包含哪些上下文元素，把提问与所选上下文一并发给 API 进行实际问答。

---

## 二、核心概念

- **节点 / 上下文元素（CE）**：一条「用户提问 + AI 回答」即一个节点，也是一张上下文元素表里的记录。
- **树**：节点通过 `parent_id`（父节点）、`depth`（深度）、`sibling_index`（同层顺序）构成树；一棵对话树（`conversation_trees`）由若干节点组成。
- **上下文元素总表**：数据库 `context_elements` 表，存放全树所有节点及其元数据（摘要、标签、时间、关系）。
- **每节点上下文子集**：每个节点有一个 `context_element_ids` 字段，记录它生成时所使用的上下文元素 ID，是总表的子集。

---

## 三、需求实现对照

| 原始需求 | 实现情况 |
| --- | --- |
| 可配置自己的 AI API | ✅ `.env` 配置 `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL`，兼容 OpenAI / DeepSeek / Claude；另支持 `MOCK_LLM` 离线假数据 |
| 对某回答子提问 → 子节点 | ✅ 每张卡片「💬 追问」生成 `parent_id` 指向该回答节点的子节点；提问后自动跳转到下一层 |
| 树形（父子 / 平级 / 无关） | ✅ `parent_id / depth / sibling_index` 表达树结构；层级分页导航在层间穿梭 |
| 节点 = 一问一答 | ✅ `context_elements` 每行即一个 CE 节点 |
| 实时整理上下文：摘要 / 标签 / 时间 / 关系 | ✅ 回答完成后由 `metadataGenerator` 生成 `summary` 与 `tags`；`created_at` 记录时间；`parent_id` / `tree_id` 表达关系 |
| 上下文元素总表（所有 CE + ID） | ✅ `context_elements` 表即总表 |
| 每节点上下文子集 | ✅ 每个节点 `context_element_ids` 记录本次所用 CE 子集 |
| 两阶段选上下文（先让 API 从总表选相关，再组装实际提问） | ✅ 阶段一 `contextRetriever`：把祖先路径 + 全树元数据索引 + 提问发给 API 选相关元素；阶段二 `contextBuilder`：组装「直接祖先路径 + 跨分支召回」并按 token 预算裁剪，再发给 API 实际问答 |

---

## 四、已实现功能

### 来自原始需求（核心）

- **可配置 AI API**：OpenAI 兼容接口，支持离线 `MOCK_LLM` 模式（`MOCK_LLM=1` 不发起真实请求，直接返回假回答，便于先体验交互）。
- **树形对话**：在任意节点「追问」，生成其子节点，构建可无限生长的对话树。
- **上下文元素自动整理**：每个回答完成后自动生成**摘要**与**标签**，并保留时间、父子/所属树等关系元数据。
- **上下文元素总表 + 每节点子集**：全树节点即总表；每个节点记录自身生成时所用的上下文元素子集。
- **两阶段上下文引擎**：
  - 阶段一 `contextRetriever`：LLM 跨分支检索，从全树元数据里挑选与当前提问相关的历史节点（best-effort，失败自动回退到祖先路径）。
  - 阶段二 `contextBuilder`：把「直接上下文（祖先路径，强制包含）」与「跨分支召回」按 token 预算组装成提示词（祖先超预算时自动降级为摘要）。

### 原始需求之外的增强

- **层级分页导航**：当前层完整展示；上一层 / 下一层用单行简介条（`↑ 返回上一层` / `↓ 下一层`）；面包屑快速回跳；树视图负责跨树跳转。
- **树视图（🌳）**：轻量树结构视图，点任意节点即跳到该节点所在层。
- **Markdown 渲染 + 代码高亮 + 复制**：AI 回答按 Markdown 渲染，代码块带语法高亮，每个代码块右上角有「复制」按钮；消息体与用户问题也各有复制按钮。
- **全局跨树搜索**：按关键词搜全库节点（问题 / 回答 / 摘要 / 标签），点结果直接跳转到对应节点页。
- **对话树管理**：新建、导入 / 导出（JSON 与 Markdown）、**重命名**、**整树删除（级联清库）**。
- **探索模式（volatile）**：临时分叉，不影响主路径，可单独删除。
- **手动上下文覆盖**：每张卡片可勾选 / 追加任意节点作为上下文，点「用所选上下文重生成」，完全绕开自动检索。
- **上下文来源透明度面板**：展示本次回答的上下文来源（直接 / 跨分支）、选择理由，以及可编辑的标签。
- **开发便利脚本**：`npm run dev:all` 一条命令起前后端；`npm run stop` 快速关闭（见下方）。

---

## 五、技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 18 + TypeScript + Vite，原生 CSS（`src/index.css`） |
| 后端 | Node.js + Express，SSE 流式接口 |
| 数据库 | better-sqlite3（单文件 `server/data/treechat.db`） |
| LLM | OpenAI 兼容接口（DeepSeek / OpenAI / Claude 同格式），支持离线 mock |
| 后端热重载 | nodemon（仅监听源码目录，忽略 `data/`） |

```
TreeChat/
├── src/                       # 前端
│   ├── api.ts                 # 与后端交互的封装
│   ├── App.tsx                # 顶层：侧边栏 + 主区
│   ├── components/
│   │   ├── ChatWindow.tsx            # 层级分页导航的核心
│   │   ├── ConversationCard.tsx      # 单个节点的完整展示（含代码块复制）
│   │   ├── CodeBlock.tsx             # 代码块复制按钮（ReactMarkdown pre 覆写）
│   │   ├── ContextSourcePanel.tsx    # 上下文来源 / 手动重生成
│   │   ├── TreeView.tsx              # 轻量树视图（跳转用）
│   │   ├── TreeSidebar.tsx           # 侧边栏：树列表 / 搜索 / 导入导出 / 重命名 / 删除
│   │   └── ...
│   └── index.css
└── server/                    # 后端
    ├── index.js
    ├── db.js                   # 建表 / 迁移（conversation_trees + context_elements）
    ├── routes/                 # trees / chat / search
    ├── services/               # messageProcessor / contextRetriever / contextBuilder / metadataGenerator / chatGenerator / treeTraversal
    └── prompts/                # retrieve.txt / metadata.txt / generate.txt（各阶段提示词）
```

---

## 六、快速启动

### 前置条件
- Node.js 18+ 与 npm
- 一个 OpenAI 兼容的 API Key（DeepSeek / OpenAI / Claude 均可）

### 1. 安装依赖（前端 + 后端两个目录都要装）

```bash
# 终端一：后端
cd server
npm install

# 终端二：前端
cd ..          # 回到 TreeChat 根目录
npm install
```

### 2. 配置后端环境变量

```bash
cd server
cp .env.example .env
```

编辑 `.env`：

```ini
# 真实调用（需要可用 key）
OPENAI_API_KEY=sk-xxxx
OPENAI_BASE_URL=https://api.deepseek.com/v1   # 必须以 /v1 结尾
OPENAI_MODEL=deepseek-chat
PORT=3001
MOCK_LLM=0
```

> **没有 Key 也能跑**：把 `MOCK_LLM` 设为 `1`，后端不发起真实请求，直接返回假回答，适合先体验界面与交互。

### 3. 启动（两个终端，或用一条命令）

```bash
# 终端一：后端（默认 http://localhost:3001）
cd server && npm run dev

# 终端二：前端（默认 http://localhost:5173，/api 已代理到 3001）
npm run dev
```

打开浏览器访问 **http://localhost:5173** 即可。

### 4.（可选）一条命令起前后端

根目录装好 `concurrently` 后，`npm run dev:all` 同时拉起前后端。

### 5. 一键关闭开发服务

在根目录执行一条命令即可同时关掉前端（5173）与后端（3001），且**只针对这两个端口，不误伤其它进程**：

```bash
npm run stop
```

跨平台：Windows 走 `netstat` + `taskkill`；其它走 `lsof`。脚本在 `scripts/stop-dev.js`。

---

## 七、常用操作速查

| 想做 | 怎么做 |
| --- | --- |
| 开新对话树 | 侧边栏右上角 `+` |
| 在节点下追问（生成子节点） | 卡片上的「💬 追问」；提交后自动跳到下一层 |
| 跳到子 / 父层 | 页面顶 / 底的「上一层 / 下一层」条，或点面包屑 |
| 在树里跳转 | 工具栏「🌳 树视图」，点任意节点 |
| 看回答上下文来源 | 卡片底部的「📋 本次回答的上下文来源」 |
| 手动选上下文重生成 | 勾选节点 →「🔄 用所选上下文重生成」 |
| 跨树搜索 | 侧边栏搜索框 |
| 重命名树 | 侧边栏 hover 树 → ✏️ |
| 删除整棵树 | 侧边栏 hover 树 → 🗑（级联删除其全部节点与元数据） |
| 导入 / 导出 | 侧边栏 hover 树 → JSON / MD |
| 一键关掉所有开发服务 | 根目录 `npm run stop`（只杀 3001 / 5173） |

---

## 八、数据说明

- 所有数据落在单文件 SQLite：`server/data/treechat.db`（`conversation_trees` 树表 + `context_elements` 上下文元素总表）。
- `context_elements` 一行即一个节点 / 上下文元素，含：`id`、`tree_id`、`parent_id`、`depth`、`sibling_index`、`user_message`、`ai_message`、`summary`、`tags`、`context_element_ids`（本节点所用上下文子集）、`created_at` 等。
- 删除整棵树会在一个事务里级联删除该树的全部节点（含 `tags` / `summary` / `embedding` / `context_trace` 等元数据列）与树记录本身，不可恢复，请谨慎。
- 导入会把整棵树重建为新 id（父节点映射重排），不会与原树冲突。
- **密钥与本地数据不入库也不进版本库**：`.env`、`server/.env`、`server/data/`、依赖与构建产物均已写入 `.gitignore`；提交到仓库的只有 `.env.example` 模板。

## 九、许可证

本项目为演示 / 学习用途，许可证请按需自定。
