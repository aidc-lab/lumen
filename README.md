# lumen

本地优先（local-first）的 AI 学习 / 教学辅助桌面工具。把教材变成**可查询、可练习、可测评、可讲解**的私有知识库。

## 架构

```
Electron 外壳（窗口 / 菜单 / 进程管理）
      │ 启动并守护
      ▼
Python sidecar（FastAPI，仅监听 127.0.0.1:随机端口，令牌认证）
      │
      ├── SQLite（WAL）：课程 / 章节 / 题目 / 任务 / 设置
      ├── FTS5：全文检索（BM25）
      ├── sqlite-vec（可选）：向量检索（余弦，RRF 混合）
      └── LLM 网关：统一 OpenAI 兼容协议
            ├── 云端 API（用户自带 Key）
            └── 用户自建本地模型（Ollama / LM Studio，同方式接入）
```

前端：React 18 + TypeScript + Vite（开发模式 `npm run dev`，生产由 sidecar 托管 `frontend/dist`）。

## 快速开始（开发）

```bash
# 1. 后端
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# 2. 前端
cd ../frontend
npm install

# 3a. 方式一：Electron 桌面应用（推荐）
cd ../electron
npm install
npm start          # 自动拉起 sidecar + 加载前端构建产物

# 3b. 方式二：纯 Web 开发模式
cd ../backend && .venv/bin/python run.py     # 记下 stdout 的端口与令牌
cd ../frontend
VITE_LUMEN_PORT=<端口> VITE_LUMEN_TOKEN=<令牌> npm run dev
```

> 注意： Electron 方式需先构建前端：`cd frontend && npm run build`。
> sidecar 端口与令牌写入 `~/Library/Application Support/lumen/sidecar.json`（macOS）。

## P0 已实现

- 课程 CRUD / 归档
- 教材导入：PDF（书签结构）/ DOCX（标题样式）/ MD / TXT / EPUB；无结构时自动切分
- 章节浏览、段落块（页码 + 段号）、引用复制
- 全局混合检索（FTS5：CJK 逐字匹配，召回优先；配置嵌入模型后升级为 向量 + RRF 融合）
- 章节总结（LLM，多版本）
- 习题生成（JSON Schema 约束，草稿箱审校）
- 模型管理：增删改、连通性测试、Key 本地加密（AES-256-GCM + 系统钥匙串）
- 任务中心：异步任务、进度 SSE、取消、重启后历史可见
- 答疑（RAG + 引用溯源，流式 SSE）
- 测验：组卷、作答、客观题自动判分（主观题 AI 阅卷为 P2）
- 生产模式：sidecar 托管 `frontend/dist`，Electron 直接加载

## 验证状态

- 后端 E2E 集成测试 31 项全部通过（`backend/tests/test_e2e.py`，含模拟 LLM 服务 `tests/mock_llm.py`）
- 前端 `tsc -b && vite build` 通过
- 生产模式静态托管验证通过（GET / 返回 SPA、/api/v1 路由优先）

## 目录结构

```
lumen/
├── docs/            # 设计文档、设计稿
├── prototype/       # 交互原型（单文件 HTML）
├── backend/         # Python sidecar
│   ├── app/
│   │   ├── api/     # REST 路由
│   │   ├── core/    # 配置 / 数据库 / 加密 / 日志
│   │   ├── models.py
│   │   ├── schemas.py
│   │   └── services/  # 任务队列 / 解析 / 索引 / LLM 网关 / AI 生成
│   ├── run.py       # sidecar 启动器
│   └── requirements.txt
├── frontend/        # React SPA
├── electron/        # 桌面外壳
└── README.md
```

## 隐私

- 数据全部在本地（`~/Library/Application Support/lumen/`）
- API Key 经 AES-256-GCM 加密，主密钥存系统钥匙串
- 无账号、无遥测、无远程服务器

详细设计见 `docs/设计文档.md`。
