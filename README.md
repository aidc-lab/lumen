# lumen

English | [简体中文](./README.zh-CN.md)

**lumen** is a local-first AI study & teaching companion. It turns your course materials into a private knowledge base you can **search, practice, assess, and get explained** — entirely on your own machine.

## Highlights

- **Local first**: all data, indexes, and files stay on your computer (`~/Library/Application Support/lumen/`). No account, no telemetry, no remote server.
- **Bring your own model**: one OpenAI-compatible gateway for cloud APIs (your own key) or self-hosted local models (Ollama / LM Studio).
- **Hybrid retrieval**: FTS5 full-text search (CJK character-level, BM25) for recall first; upgrade to vector search + RRF fusion once an embedding model is configured.
- **Course-centric**: a course is the top-level boundary (like a "project"). Materials, exercises, quizzes, grades, mistakes, and Q&A all belong to the current course.
- **Keys stay safe**: API keys are encrypted with AES-256-GCM, with the master key stored in the OS keychain.

## What you can do

| Area | Description |
| --- | --- |
| Import materials | PDF (bookmark structure) / DOCX / MD / TXT / EPUB, multi-select; auto-chunking when there is no structure |
| Browse chapters | Paragraph blocks (page + paragraph number), one-click citation copy, chapter tree |
| Hybrid search | Full-text + vector (RRF fusion) across your materials, with cited sources |
| Chapter summary | LLM-generated Markdown summary; regenerate replaces the previous version |
| Exercise wizard | Schema-constrained question generation with a draft box for review |
| Question bank / Quiz | Build papers, take them, auto-grade objective questions |
| Subjective grading | Async AI grading after submission (score points / deductions / suggestions), manual re-grade supported |
| Grades / Mistakes | Per-course grade report; mistakes sorted by error count |
| Q&A | RAG with citation provenance, streaming output, scoped by course and chapter |
| Lesson plans | Markdown lesson plans generated per course and chapter |
| Export | Export papers as Markdown (PDF requires Typst: `brew install typst`) |
| Model management | CRUD, connectivity test, per-task default models, locally encrypted keys |
| Task center | Async jobs with SSE progress, cancellable, history survives restarts |

## Quick start

### Prerequisites

- macOS / Linux / Windows
- Python **3.10+**
- Node.js **18+** and `make`
- (optional) A local model runtime: [Ollama](https://ollama.com) or [LM Studio](https://lmstudio.ai)
- (optional) [Typst](https://typst.app) for PDF export: `brew install typst`

### Install and run (development)

```bash
git clone <your-repo-url> lumen
cd lumen

make install   # all dependencies: backend venv + frontend + electron
make dev       # one command: mock LLM + sidecar + frontend dev server
```

Open the URL printed by the terminal. Stop everything with `make stop`.

> The mock LLM bundled in `make dev` is for testing only. For real usage, configure a cloud API (your own key) or a self-hosted Ollama / LM Studio endpoint under **Model management**.

### Run step by step (equivalent to `make dev`)

```bash
make mock            # terminal 1: mock LLM (port 18100, testing only)
make start-sidecar   # terminal 2: backend sidecar (prints port and token on stdout)
make dev-frontend    # terminal 3: frontend dev server (/api proxied to the sidecar)
```

### Launch the desktop app (Electron)

```bash
make start-electron  # builds the frontend first, then starts the desktop shell
```

In production mode the sidecar serves `frontend/dist` and Electron loads it directly — no dev server needed.

### Configure a model

1. Open **Model management** in the sidebar → **Add model**.
2. Fill in an OpenAI-compatible Base URL, API key, and model name (any key works for local models).
3. Run **Connectivity test** to verify.
4. Under **Settings**, pick the default model per task (Q&A / summary / exercises / grading / lesson plan / embedding).

## How to use it

1. **Create a course** (the top-level boundary, similar to a "project").
2. **Import materials**: native file dialog (multi-select) on desktop, multipart upload in the browser.
3. Open the course workspace and switch tabs: **Materials / Exercise wizard / Question bank / Quiz / Grades / Mistakes / Q&A**.
4. Long-running jobs appear in the **Task center**, where you can watch progress or cancel them.

The sidebar has exactly five items: **Overview / My courses / Task center / Model management / Settings**.

## Commands

| Command | Description |
| --- | --- |
| `make help` | List all targets |
| `make install` | Install all dependencies (backend venv + frontend + electron) |
| `make dev` | One-shot dev mode (mock LLM + sidecar + frontend), `Ctrl+C` stops all |
| `make stop` | Stop processes started by `make dev` |
| `make test` | Backend tests |
| `make e2e` | E2E integration tests (run `make mock` and `make start-sidecar` first) |
| `make build-frontend` | Build the frontend (outputs `frontend/dist`) |
| `make start-electron` | Start the desktop app |
| `make clean` | Remove build artifacts and caches |

## Architecture

```
Electron shell (window / menu / process management)
      │ spawns and supervises
      ▼
Python sidecar (FastAPI, bound to 127.0.0.1:random port, token auth)
      │
      ├── SQLite (WAL): courses / chapters / questions / tasks / settings
      ├── FTS5: full-text search (BM25, CJK character-level)
      ├── sqlite-vec (optional): vector search (cosine, RRF fusion)
      └── LLM gateway: unified OpenAI-compatible protocol
            ├── cloud APIs (user-provided keys)
            └── local models (Ollama / LM Studio)
```

Frontend: React 18 + TypeScript + Vite.

## Project layout

```
lumen/
├── docs/            # design docs and design drafts
├── prototype/       # interaction prototype (single-file HTML)
├── backend/         # Python sidecar (FastAPI + SQLite)
│   ├── app/
│   │   ├── api/     # REST routes
│   │   ├── core/    # config / database / encryption / logging
│   │   └── services/# job queue / parsing / indexing / LLM gateway / AI generation
│   ├── run.py       # sidecar launcher
│   └── requirements.txt
├── frontend/        # React SPA
├── electron/        # desktop shell
├── LICENSE
└── README.md
```

## Data & privacy

- Everything lives locally — on macOS: `~/Library/Application Support/lumen/`
- API keys are encrypted with AES-256-GCM; the master key is stored in the OS keychain
- No accounts, no telemetry, no remote servers; LLM requests only go to the endpoint you configured

Full design details: [`docs/设计文档.md`](./docs/设计文档.md) (Chinese).

## License

Released under the [MIT License](./LICENSE).
