# lumen 本地开发与调试入口
# 用法：make help 查看全部目标

BACKEND_DIR := backend
FRONTEND_DIR := frontend
ELECTRON_DIR := electron
VENV := $(BACKEND_DIR)/.venv
# 在 $(BACKEND_DIR) 内使用的相对解释器路径
VPY := .venv/bin/python

.DEFAULT_GOAL := help

.PHONY: help install install-backend install-frontend install-electron \
	start-sidecar mock dev-frontend build-frontend dev stop \
	test e2e start-electron clean

help: ## 显示帮助
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ---------- 依赖 ----------
install-backend: ## 安装后端依赖（创建 .venv）
	python3 -m venv $(VENV)
	$(VENV)/bin/pip install -r $(BACKEND_DIR)/requirements.txt

install-frontend: ## 安装前端依赖
	cd $(FRONTEND_DIR) && npm install

install-electron: ## 安装桌面外壳依赖
	cd $(ELECTRON_DIR) && npm install

install: install-backend install-frontend install-electron ## 安装全部依赖

# ---------- 运行 ----------
start-sidecar: ## 启动 sidecar（后端服务；stdout 打印端口与令牌）
	cd $(BACKEND_DIR) && $(VPY) run.py

mock: ## 启动模拟 LLM（OpenAI 兼容，测试用，端口 18100）
	python3 $(BACKEND_DIR)/tests/mock_llm.py

dev-frontend: ## 启动前端开发服务器（Vite，/api 代理到 sidecar）
	cd $(FRONTEND_DIR) && npm run dev

build-frontend: ## 构建前端（产出 frontend/dist，sidecar 生产模式托管）
	cd $(FRONTEND_DIR) && npm run build

dev: ## 开发模式：一键启动 mock LLM + sidecar + 前端
	python3 $(BACKEND_DIR)/tests/mock_llm.py & echo $$! > /tmp/lumen-mock.pid
	cd $(BACKEND_DIR) && $(VPY) run.py > /tmp/lumen-sidecar.log 2>&1 & echo $$! > /tmp/lumen-sidecar.pid
	@sleep 2
	@echo "sidecar 日志：tail -f /tmp/lumen-sidecar.log"
	cd $(FRONTEND_DIR) && npm run dev

stop: ## 停止 make dev 启动的进程
	@for f in /tmp/lumen-mock.pid /tmp/lumen-sidecar.pid; do \
		if [ -f $$f ]; then \
			kill `cat $$f` 2>/dev/null || true; rm -f $$f; \
		fi; \
	done
	@pkill -f "mock_llm.py" 2>/dev/null || true

start-electron: build-frontend ## 启动桌面应用（自动先构建前端）
	cd $(ELECTRON_DIR) && npm start

# ---------- 测试 ----------
test: ## 后端测试
	cd $(BACKEND_DIR) && $(VPY) -m pytest tests/ -v

e2e: ## E2E 集成测试（需先运行：make mock 与 make start-sidecar）
	cd $(BACKEND_DIR) && $(VPY) -m pytest tests/test_e2e.py -v

# ---------- 清理 ----------
clean: ## 清理构建产物与缓存
	rm -rf $(FRONTEND_DIR)/dist $(FRONTEND_DIR)/node_modules \
		$(ELECTRON_DIR)/node_modules $(ELECTRON_DIR)/dist \
		$(BACKEND_DIR)/.pytest_cache $(BACKEND_DIR)/**/__pycache__ \
		$(FRONTEND_DIR)/tsconfig.tsbuildinfo
	rm -f /tmp/lumen-sidecar.log /tmp/lumen-mock.pid /tmp/lumen-sidecar.pid
