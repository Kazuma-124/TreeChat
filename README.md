# TreeChat · 树形 AI 对话

一个把 AI 对话组织成**树**而不是线性列表的应用。每一次提问都可以从任意已有回答**分叉出新的子对话**，于是同一段上下文能长出多条探索路径；配合「跨分支上下文检索」，问新问题时模型会自动带上来自其它分支的相关历史，而不只是当前这一条线。

---

## 它解决什么问题

普通聊天工具是一条时间线：你只能往下接着聊，想回到某个中间结论换一条路走，就得开新窗口或滚动到天荒地老。TreeChat 把每个「用户问题 + AI 回答」作为一个**节点**，节点之间用父子关系连成树：

- 在任意节点上「追问」，会生成它的子节点 —— 分支自然长出来。
- 每个页面只展示**同一层、且父节点相同**的节点，可滚动浏览；用「上一层 / 下一层」在层级间穿梭。
- 树视图只做轻量跳转：每个节点只显示简介，点一下即可跳到该节点的完整展示页。
- 问新问题时，系统做**两阶段上下文组装**：先检索全树里相关的其它分支（跨分支召回），再叠加上当前祖先路径，把拼好的上下文连同「为什么选了这些」一起喂给模型。

---

## 核心功能

- **树形对话**：从任意节点分叉子对话，构建可无限生长的对话树。
- **层级分页导航**：当前层完整展示、上一层/下一层用单行简介，面包屑快速回跳，树视图负责跨树跳转。
- **两阶段上下文引擎**：
  - 阶段一 `contextRetriever`：LLM 跨分支检索，挑出与当前问题相关的历史节点（best-effort，失败自动回退到祖先路径）。
  - 阶段二 `contextBuilder`：把「直接上下文（祖先路径）」与「跨分支召回」按 token 预算组装成提示词。
- **手动上下文覆盖**：每个回答下可勾选/追加任意节点作为上下文，点「用所选上下文重生成」，完全绕开自动检索。
- **透明度面板**：每张卡片展示本次回答的上下文来源（直接 / 跨分支）、选择理由，以及可编辑的标签。
- **Markdown 渲染 + 一键复制**：AI 回答按 Markdown 渲染（代码块带语法高亮），消息体与用户问题各有复制按钮。
- **全局跨树搜索**：按关键词搜全库节点（问题 / 回答 / 摘要 / 标签），点结果直接跳转到对应节点页。
- **对话树管理**：新建、导入 / 导出（JSON 与 Markdown）、**重命名**、**整树删除（级联清库）**。
- **探索模式（volatile）**：临时分叉，不影响主路径，可单独删除。

---

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 18 + TypeScript + Vite，原生 CSS（`src/index.css`） |
| 后端 | Node.js + Express，SSE 流式接口 |
| 数据库 | better-sqlite3（单文件 `server/data/treechat.db`） |
| LLM | OpenAI 兼容接口（DeepSeek / Claude / OpenAI 同格式），支持离线 mock |

```
TreeChat/
├── src/                 # 前端
│   ├── api.ts            # 与后端交互的封装
│   ├── App.tsx           # 顶层：侧边栏 + 主区
│   ├── components/
│   │   ├── ChatWindow.tsx       # 层级分页导航的核心
│   │   ├── ConversationCard.tsx  # 单个节点的完整展示
│   │   ├── ContextSourcePanel.tsx# 上下文来源 / 手动重生成
│   │   ├── TreeView.tsx          # 轻量树视图（跳转用）
│   │   ├── TreeSidebar.tsx        # 侧边栏：树列表 / 搜索 / 导入导出
│   │   └── ...
│   └── index.css
└── server/              # 后端
    ├── index.js
    ├── db.js            # 建表 / 迁移
    ├── routes/          # trees / chat / search
    └── services/        # messageProcessor / contextRetriever / contextBuilder / metadataGenerator / chatGenerator
```

---

## 快速启动

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

### 3. 启动（两个终端）

```bash
# 终端一：后端（默认 http://localhost:3001）
cd server && npm run dev

# 终端二：前端（默认 http://localhost:5173，/api 已代理到 3001）
npm run dev
```

打开浏览器访问 **http://localhost:5173** 即可。

### 4. （可选）用 concurrently 一条命令起前后端

在根目录安装 `concurrently` 并加一个脚本，省去开两个终端：

```bash
npm install -D concurrently
```

`package.json` 的 `scripts` 里加：

```json
"dev:all": "concurrently \"npm:dev\" \"npm:dev --prefix server\""
```

然后 `npm run dev:all` 即可。

### 5. 一键关闭开发服务

跑完想收尾，在根目录执行一条命令即可同时关掉前端（5173）与后端（3001），且**只针对这两个端口，不误伤其它进程**：

```bash
npm run stop
```

跨平台：Windows 走 PowerShell `Get-NetTCPConnection`，其它走 `lsof`；脚本在 `scripts/stop-dev.js`。

---

## 常用操作速查

| 想做 | 怎么做 |
| --- | --- |
| 开新对话树 | 侧边栏右上角 `+` |
| 在节点下追问 | 卡片上的「💬 追问」 |
| 跳到子/父层 | 页面顶/底的「上一层 / 下一层」条，或点面包屑 |
| 在树里跳转 | 工具栏「🌳 树视图」，点任意节点 |
| 看回答上下文来源 | 卡片底部的「📋 本次回答的上下文来源」 |
| 手动选上下文重生成 | 勾选节点 →「🔄 用所选上下文重生成」 |
| 跨树搜索 | 侧边栏搜索框 |
| 重命名树 | 侧边栏 hover 树 → ✏️ |
| 删除整棵树 | 侧边栏 hover 树 → 🗑（级联删除其全部节点与元数据） |
| 导入 / 导出 | 侧边栏 hover 树 → JSON / MD |
| 一键关掉所有开发服务 | 根目录 `npm run stop`（只杀 3001 / 5173，影响其它应用） |

---

## 数据说明

- 所有数据落在单文件 SQLite：`server/data/treechat.db`。
- 删除整棵树会在一个事务里级联删除该树的全部节点（含 `tags` / `summary` / `embedding` / `context_trace` 等元数据列）与树记录本身，不可恢复，请谨慎。
- 导入会把整棵树重建为新 id（父节点映射重排），不会与原树冲突。

## 许可证

本项目为演示 / 学习用途，许可证请按需自定。
