"""LLM 网关：统一 OpenAI 兼容协议。

所有模型（云端 API 或用户自建 Ollama/LM Studio）都通过 base_url 接入，
能力：流式输出（SSE）、结构化输出（JSON）、嵌入、连通性测试、token 统计。
"""
import json
import logging
import re
import time

import httpx

from app.core.security import decrypt

logger = logging.getLogger("app.llm")


class LLMError(Exception):
    pass


def _headers(model) -> dict:
    h = {"Content-Type": "application/json"}
    try:
        key = decrypt(model.api_key_enc) if model.api_key_enc else ""
    except Exception:
        key = ""
    if key:
        h["Authorization"] = f"Bearer {key}"
    return h


def _timeout(model) -> float:
    # 长上下文模型给更长超时
    return max(60.0, min(600.0, model.context_length / 100))


async def chat(model, messages: list[dict], *,
               temperature: float = 0.7,
               max_tokens: int | None = None,
               response_json: bool = False,
               stream: bool = False):
    """调用 /chat/completions。

    stream=False → 返回 (content, usage_dict)
    stream=True  → 返回 async generator，产出文本增量；usage 通过 .usage 属性带回（最后一条）
    """
    url = model.base_url.rstrip("/") + "/chat/completions"
    payload = {
        "model": model.name,
        "messages": messages,
        "temperature": temperature,
    }
    if max_tokens:
        payload["max_tokens"] = max_tokens
    else:
        payload["max_tokens"] = getattr(model, "max_output", None) or 4096
    if response_json:
        payload["response_format"] = {"type": "json_object"}
    if stream:
        payload["stream"] = True

    if stream:
        # 直接返回 async generator（调用方 await chat(...) 后即可 async for）
        return _stream_gen(model, url, payload)

    async with httpx.AsyncClient(timeout=_timeout(model)) as client:
        r = await client.post(url, json=payload, headers=_headers(model))
    if r.status_code != 200:
        raise LLMError(f"模型 {model.name} 返回 {r.status_code}: {r.text[:300]}")
    data = r.json()
    content = _extract_content(data)
    usage = data.get("usage") or {}
    return content, usage


async def _stream_gen(model, url, payload):
    usage = {}
    async with httpx.AsyncClient(timeout=_timeout(model)) as client:
        async with client.stream("POST", url, json=payload, headers=_headers(model)) as r:
            if r.status_code != 200:
                body = (await r.aread()).decode("utf-8", errors="replace")
                raise LLMError(f"模型 {model.name} 返回 {r.status_code}: {body[:300]}")
            async for line in r.aiter_lines():
                line = line.strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    obj = json.loads(data)
                except json.JSONDecodeError:
                    continue
                delta = (obj.get("choices") or [{}])[0].get("delta") or {}
                if "content" in delta and delta["content"]:
                    yield delta["content"]
                if obj.get("usage"):
                    usage = obj["usage"]
    # 生成器结束时无法直接返回 usage；调用方通过 usage_hook 获取（见 answer_with_citations）
    _stream_gen.last_usage = usage  # type: ignore[attr-defined]


def _extract_content(data: dict) -> str:
    choices = data.get("choices") or []
    if not choices:
        raise LLMError(f"模型响应无 choices: {json.dumps(data)[:300]}")
    msg = choices[0].get("message") or {}
    content = msg.get("content")
    if content is None:
        raise LLMError(f"模型响应无 content: {json.dumps(data)[:300]}")
    return content


async def embeddings(model, texts: list[str]) -> list[list[float]]:
    """调用 /embeddings。返回向量列表。"""
    url = model.base_url.rstrip("/") + "/embeddings"
    async with httpx.AsyncClient(timeout=120.0) as client:
        r = await client.post(url, json={"model": model.name, "input": texts}, headers=_headers(model))
    if r.status_code != 200:
        raise LLMError(f"嵌入接口 {model.name} 返回 {r.status_code}: {r.text[:300]}")
    data = r.json()
    # 按 index 排序保证与输入顺序一致
    items = sorted(data.get("data") or [], key=lambda x: x.get("index", 0))
    return [item["embedding"] for item in items]


async def test_connectivity(model) -> tuple[bool, str, int]:
    """连通性测试：优先 GET /models，失败则发一条最小 chat。"""
    t0 = time.monotonic()
    headers = _headers(model)
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            r = await client.get(model.base_url.rstrip("/") + "/models", headers=headers)
            ms = int((time.monotonic() - t0) * 1000)
            if r.status_code == 200:
                models = [m.get("id") for m in (r.json().get("data") or [])]
                return True, f"可用模型 {len(models)} 个", ms
            if r.status_code == 401:
                return False, "认证失败（401），请检查 API Key", ms
        except Exception as e:
            ms = int((time.monotonic() - t0) * 1000)
        # 兜底：最小 chat 请求
        try:
            r = await client.post(
                model.base_url.rstrip("/") + "/chat/completions",
                json={"model": model.name, "messages": [{"role": "user", "content": "hi"}],
                      "max_tokens": 4},
                headers=headers)
            ms = int((time.monotonic() - t0) * 1000)
            if r.status_code == 200:
                return True, "连通正常", ms
            return False, f"返回 {r.status_code}: {r.text[:200]}", ms
        except Exception as e:
            ms = int((time.monotonic() - t0) * 1000)
            return False, f"连接失败：{type(e).__name__}: {e}", ms


def extract_json(text: str) -> dict | list:
    """从模型输出中提取 JSON（兼容数组、代码块包裹与前后噪声）。"""
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    candidate = m.group(1) if m else text
    # 优先匹配最外层的数组（出题等场景输出数组）
    start_arr = candidate.find("[")
    start_obj = candidate.find("{")
    if start_arr != -1 and (start_obj == -1 or start_arr < start_obj):
        end = candidate.rfind("]")
        if start_arr < end:
            return json.loads(candidate[start_arr:end + 1])
    start = candidate.find("{")
    end = candidate.rfind("}")
    if start < 0 or end < 0:
        raise LLMError("模型输出中未找到 JSON")
    return json.loads(candidate[start:end + 1])


def count_tokens_approx(text: str) -> int:
    return max(1, len(text) // 2)
