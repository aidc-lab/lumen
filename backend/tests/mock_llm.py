"""模拟 OpenAI 兼容服务（测试用）：chat / embeddings / models。"""
import json
import random
import re
from http.server import BaseHTTPRequestHandler, HTTPServer

DIM = 1024


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/v1/models"):
            self._send(200, {"data": [{"id": "mock-model"}]})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        if self.path.startswith("/v1/embeddings"):
            vecs = [[random.uniform(-1, 1) for _ in range(DIM)] for _ in body["input"]]
            self._send(200, {"data": [{"index": i, "embedding": v} for i, v in enumerate(vecs)]})
        elif self.path.startswith("/v1/chat/completions"):
            messages = body.get("messages", [])
            all_text = "\n".join(m.get("content", "") for m in messages)
            user_text = messages[-1]["content"] if messages else ""
            is_stream = bool(body.get("stream"))
            if "JSON 数组" in all_text or "出题" in all_text:
                content = json.dumps([
                    {"type": "single", "stem": "设 f(x) = x²，则 f′(1) = ?",
                     "options": ["A. 0", "B. 1", "C. 2", "D. 不存在"],
                     "answer": "C. 2", "explanation": "由导数定义计算。",
                     "difficulty": 2, "source_refs": [{"chapter": "测试章节", "page": 1, "para": 1}]},
                    {"type": "judge", "stem": "可导函数必连续。",
                     "answer": "√ 正确", "explanation": "可导必连续。",
                     "difficulty": 1, "source_refs": [{"chapter": "测试章节", "page": 1, "para": 1}]},
                ], ensure_ascii=False)
            elif "知识总结" in all_text or "总结" in all_text:
                content = "## 知识框架\n- 极限\n- 连续\n\n## 核心概念\n- ε-δ 定义\n\n## 易错点\n- 极限存在与定义无关"
            else:
                content = "根据教材片段【cite:1】，极限的 ε-δ 定义是：对于任意给定的正数 ε，总存在正数 δ。【cite:2】连续性的判定依据是 lim f(x) = f(x₀)。"
            usage = {"prompt_tokens": len(user_text) // 2, "completion_tokens": len(content) // 2}
            if is_stream:
                # SSE 流式：分段输出，末段带 usage
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()
                step = max(1, len(content) // 6)
                for i in range(0, len(content), step):
                    piece = content[i:i + step]
                    obj = {"choices": [{"delta": {"content": piece}}]}
                    self.wfile.write(f"data: {json.dumps(obj, ensure_ascii=False)}\n\n".encode())
                    self.wfile.flush()
                self.wfile.write(f"data: {json.dumps({'choices': [], 'usage': usage})}\n\n".encode())
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
                return
            self._send(200, {"choices": [{"message": {"role": "assistant", "content": content}}], "usage": usage})
        else:
            self._send(404, {"error": "not found"})


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", 18100), Handler).serve_forever()
