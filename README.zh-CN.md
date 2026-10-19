# lumen

[English](./README.md) | 简体中文

本地优先（local-first）的 AI 学习 / 教学辅助桌面工具。把教材变成**可查询、可练习、可测评、可讲解**的私有知识库——所有数据留在你自己的电脑上。

## 为什么选择 lumen

- **本地优先**：数据、索引与文件全部存放在本地（`~/Library/Application Support/lumen/`），无账号、无遥测、不依赖远程服务器。
- **自带模型（BYOK）**：统一的 OpenAI 兼容网关，可接云端 API（自备 Key），也可接入自建的 Ollama / LM Studio 本地模型。
- **混合检索**：FTS5 全文检索（CJK 逐字匹配，BM25）优先召回；配置嵌入模型后自动升级为向量检索 + RRF 融合。
- **课程中心化**：课程是一级边界，教材、出题、测验、成绩单、错题本、答疑等数据全部归属当前课程。
- **隐私安全**：API Key 用 AES-256-GCM 加密，主密钥保存在系统钥匙串。

## 功能一览

| 模块 | 说明 |
| --- | --- |
| 教材导入 | PDF（书签结构）/ DOCX / MD / TXT / EPUB，多选上传；无结构时自动切分 |
| 章节浏览 | 段落块（页码 + 段号）、引用一键复制、章节目录树 |
| 混合检索 | 全文 + 向量（RRF 融合），跨教材查询并给出引用来源 |
| 章节总结 | LLM 生成 Markdown 总结，重新生成即替换 |
| 出题向导 | JSON Schema 约束生成习题，草稿箱审校后入库 |
| 题库 / 测验 | 组卷、作答、客观题自动判分 |
| 主观题阅卷 | 提交后异步 AI 批改（得分点 / 扣分 / 建议），支持手动重评 |
| 成绩单 / 错题本 | 按课程聚合成绩，错题按错误次数排序 |
| 答疑 | RAG + 引用溯源，流式输出，可限定课程与章节范围 |
| 教案生成 | 按课程与章节生成 Markdown 教案 |
| 试卷导出 | 导出 Markdown（PDF 需安装 Typst：`brew install typst`） |
| 模型管理 | 增删改、连通性测试、任务级默认模型、Key 本地加密 |
| 任务中心 | 异步任务、进度 SSE、可取消，重启后历史可见 |

## 快速开始

### 环境要求

- macOS / Linux / Windows
- Python **3.10+**
- Node.js **18+** 与 `make`
- （可选）本地模型运行时：[Ollama](https://ollama.com) 或 [LM Studio](https://lmstudio.ai)
- （可选）[Typst](https://typst.app) 用于导出 PDF：`brew install typst`

### 一键安装并启动（开发模式）

```bash
git clone <your-repo-url> lumen
cd lumen

make install   # 安装全部依赖：后端 venv + 前端 + electron
make dev       # 一键启动：mock LLM + sidecar + 前端开发服务器
```

浏览器打开终端打印的地址即可使用。停止：`make stop`。

> `make dev` 内置的 mock LLM 仅用于测试。真实使用请在「**模型管理**」中配置云端 API（自备 Key）或自建 Ollama / LM Studio。

### 分步启动（等价于 `make dev`）

```bash
make mock            # 终端 1：模拟 LLM（端口 18100，测试用）
make start-sidecar   # 终端 2：后端 sidecar（stdout 打印端口与令牌）
make dev-frontend    # 终端 3：前端开发服务器（/api 代理到 sidecar）
```

### 启动桌面应用（Electron）

```bash
make start-electron  # 自动先构建前端，再启动桌面外壳
```

生产模式下由 sidecar 托管 `frontend/dist`，Electron 直接加载，无需开发服务器。

### 配置模型

1. 进入侧边栏「**模型管理**」→ 新增模型；
2. 填入 OpenAI 兼容的 Base URL、API Key、模型名（本地模型的 Key 可任意填写）；
3. 点击「连通性测试」确认可用；
4. 在「设置」中为各任务（答疑 / 总结 / 出题 / 阅卷 / 教案 / 向量化）指定默认模型。

## 使用流程

1. **创建课程**（课程是一级边界，类似"项目"）；
2. **导入教材**：桌面版通过文件对话框多选，浏览器版 multipart 上传；
3. 进入课程工作区，通过 tab 切换 **教材 / 出题向导 / 题库 / 测验 / 成绩单 / 错题本 / 答疑**；
4. 需要跑批的任务会进入「**任务中心**」，可查看进度或取消。

侧边栏固定五项：**概览 / 我的课程 / 任务中心 / 模型管理 / 设置**。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `make help` | 查看全部目标 |
| `make install` | 安装全部依赖（后端 venv + 前端 + electron） |
| `make dev` | 一键开发模式（mock LLM + sidecar + 前端），`Ctrl+C` 停止 |
| `make stop` | 停止 `make dev` 启动的进程 |
| `make test` | 后端测试 |
| `make e2e` | E2E 集成测试（需先 `make mock` 与 `make start-sidecar`） |
| `make build-frontend` | 构建前端（产出 `frontend/dist`） |
| `make start-electron` | 启动桌面应用 |
| `make clean` | 清理构建产物与缓存 |

## 架构

```
Electron 外壳（窗口 / 菜单 / 进程管理）
      │ 启动并守护
      ▼
Python sidecar（FastAPI，仅监听 127.0.0.1:随机端口，令牌认证）
      │
      ├── SQLite（WAL）：课程 / 章节 / 题目 / 任务 / 设置
      ├── FTS5：全文检索（BM25，CJK 逐字匹配）
      ├── sqlite-vec（可选）：向量检索（余弦，RRF 混合）
      └── LLM 网关：统一 OpenAI 兼容协议
            ├── 云端 API（用户自带 Key）
            └── 本地模型（Ollama / LM Studio）
```

前端：React 18 + TypeScript + Vite。

## 目录结构

```
lumen/
├── docs/            # 设计文档、设计稿
├── prototype/       # 交互原型（单文件 HTML）
├── backend/         # Python sidecar（FastAPI + SQLite）
│   ├── app/
│   │   ├── api/     # REST 路由
│   │   ├── core/    # 配置 / 数据库 / 加密 / 日志
│   │   └── services/# 任务队列 / 解析 / 索引 / LLM 网关 / AI 生成
│   ├── run.py       # sidecar 启动器
│   └── requirements.txt
├── frontend/        # React SPA
├── electron/        # 桌面外壳
├── LICENSE
└── README.md
```

## 数据与隐私

- 数据全部在本地，macOS 下位于 `~/Library/Application Support/lumen/`
- API Key 经 AES-256-GCM 加密，主密钥存系统钥匙串
- 无账号、无遥测、无远程服务器；LLM 请求仅在你配置的模型端点产生

详细设计见 [`docs/设计文档.md`](./docs/设计文档.md)。

## 许可证

本项目采用 [MIT License](./LICENSE) 开源。
