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
make install        # 安装全部依赖（后端 venv + 前端 + electron）
make dev            # 一键启动：mock LLM + sidecar + 前端（开发模式）
make stop           # 停止 make dev 启动的进程
make test           # 后端测试
make e2e            # E2E 集成测试（需 make mock + make start-sidecar）
make build-frontend # 构建前端（生产）
make start-electron # 启动桌面应用（自动先构建前端）
```

> `make dev` 中的 mock LLM 仅用于测试；真实环境请在「模型管理」中配置
> 云端 API（自带 Key）或自建 Ollama/LM Studio。

```bash
# 手动分步（等价于 make dev）：
make mock           # 终端 1：模拟 LLM（端口 18100）
make start-sidecar  # 终端 2：sidecar（stdout 打印端口与令牌）
make dev-frontend   # 终端 3：前端开发服务器（/api 代理到 sidecar）
```

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

## P2 已实现

- 主观题 AI 阅卷：提交答卷后异步批改（得分点 / 扣分 / 建议），支持手动重评
- 教案生成：多版本管理
- 试卷导出：Markdown（PDF 需安装 Typst：`brew install typst`）
- 任务级默认模型：设置页为每个任务指定默认模型（答疑/总结/出题/阅卷/教案/向量化）
- 错题本雏形：按课程聚合判错题目，按错误次数排序

## 验证状态

- 后端 E2E 集成测试全部通过（`backend/tests/test_e2e.py`，含模拟 LLM 服务 `tests/mock_llm.py`）
- 前端 `tsc -b && vite build` 通过
- 生产模式静态托管验证通过（GET / 返回 SPA、/api/v1 路由优先）
- Makefile 全部目标验证通过（`make help` / `test` / `e2e` / `build-frontend`）

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
