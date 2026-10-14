"""端到端集成测试（需要运行中的 sidecar + 模拟 LLM）。

启动方式：
    # 终端 1：模拟 LLM（OpenAI 兼容）
    python tests/mock_llm.py
    # 终端 2：sidecar
    .venv/bin/python run.py
    # 运行测试
    pytest tests/test_e2e.py -v

覆盖：课程 CRUD → 模型注册/连通性 → 教材导入（结构识别+切分+索引）
→ 全文检索 → 章节总结 → 习题生成 → 组卷判分 → 答疑 RAG 流式引用。
"""
import http.client
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import pytest

_SIDECAR = Path.home() / "Library" / "Application Support" / "lumen" / "sidecar.json"


@pytest.fixture(scope="module")
def api():
    if not _SIDECAR.exists():
        pytest.skip("sidecar 未运行（先启动 run.py）")
    info = json.loads(_SIDECAR.read_text())
    base = f"http://127.0.0.1:{info['port']}/api/v1"
    token = info["token"]

    def call(method, path, body=None):
        url = base + path + ("&" if "?" in path else "?") + "token=" + token
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        if data:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.status, json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"null")

    return call


def _wait_task(call, task_id, timeout=90):
    t0 = time.time()
    while time.time() - t0 < timeout:
        _, task = call("GET", f"/tasks/{task_id}")
        if task.get("status") in ("completed", "failed", "canceled"):
            return task
        time.sleep(0.5)
    raise TimeoutError(f"task {task_id} timeout")


def test_full_workflow(api):
    passed = []

    def check(name, cond, detail=""):
        passed.append((name, cond, detail))
        assert cond, f"{name}: {detail}"

    # 1. 课程
    st, course = api("POST", "/courses", {"name": "E2E 测试课程", "subject": "数学"})
    check("创建课程", st == 201 and course.get("id"), str(course))
    course_id = course["id"]

    # 2. 模型（指向模拟 LLM）
    st, model = api("POST", "/models", {
        "name": "Mock-Model", "provider": "测试模拟",
        "base_url": "http://127.0.0.1:18100/v1", "api_key": "test-key",
        "capabilities": ["text", "embedding"], "context_length": 8192,
    })
    check("注册模型", st == 201 and model.get("id"))
    model_id = model["id"]
    st, test = api("POST", f"/models/{model_id}/test")
    check("模型连通性测试", st == 200 and test.get("ok"), json.dumps(test, ensure_ascii=False))

    # 3. 教材导入（MD）
    st, task = api("POST", "/textbooks/import", {
        "course_id": course_id,
        "file_path": str(Path(__file__).parent / "test-book.md"),
        "title": "测试教材",
    })
    check("提交教材导入", st == 202 and task.get("id"))
    task = _wait_task(api, task["id"])
    check("教材导入完成", task["status"] == "completed", task.get("error", ""))
    textbook_id = task["result_ref"]

    # 4. 章节树
    st, chapters = api("GET", f"/textbooks/{textbook_id}/chapters")
    check("章节树生成（5 节）", st == 200 and len(chapters) == 5, f"got {len(chapters)}")
    check("章节来源为文档结构", chapters and chapters[0]["structure"] == "doc")

    # 5. 章节详情 + 段落块
    st, detail = api("GET", f"/chapters/{chapters[2]['id']}")
    check("章节段落块", st == 200 and len(detail.get("chunks", [])) >= 2)
    check("段落含段号", detail["chunks"] and detail["chunks"][0]["para_no"] >= 1)

    # 6. 全文检索（中文逐字匹配）
    st, hits = api("GET", "/search?" + urllib.parse.urlencode({"q": "ε-δ 定义"}))
    check("全文检索命中", st == 200 and len(hits) >= 1, f"hits={len(hits)}")
    check("检索结果带来源", hits and hits[0]["chapter_title"] and hits[0]["textbook_title"])
    st, hits2 = api("GET", "/search?" + urllib.parse.urlencode({"q": "什么是极限"}))
    check("自然语言问句检索（召回优先）", st == 200 and len(hits2) >= 1)

    # 7. 章节总结
    st, task = api("POST", "/summaries/generate",
                   {"chapter_id": chapters[2]["id"], "model_id": model_id})
    task = _wait_task(api, task["id"])
    check("章节总结任务完成", task["status"] == "completed", task.get("error", ""))
    st, sums = api("GET", f"/chapters/{chapters[2]['id']}/summaries")
    check("总结已保存", st == 200 and len(sums) == 1 and "知识框架" in sums[0]["content"])
    check("总结记录 token 用量", task["tokens_in"] > 0 and task["tokens_out"] > 0)

    # 8. 习题生成
    st, task = api("POST", "/exercises/generate", {
        "course_id": course_id, "chapter_ids": [chapters[2]["id"]],
        "types": {"single": 1, "judge": 1}, "difficulty": 2, "model_id": model_id,
    })
    task = _wait_task(api, task["id"])
    check("出题任务完成", task["status"] == "completed", task.get("error", ""))
    st, exercises = api("GET", f"/exercises?course_id={course_id}&status=draft")
    check("生成 2 题草稿", st == 200 and len(exercises) == 2, f"got {len(exercises)}")
    check("题目含选项与解析", exercises and exercises[0]["options"] and exercises[0]["explanation"])
    check("题目带来源引用", exercises and exercises[0]["source_refs"])

    # 发布 → 组卷 → 作答 → 判分
    for q in exercises:
        api("PATCH", f"/exercises/{q['id']}", {"status": "published"})
    st, paper = api("POST", "/papers", {
        "course_id": course_id, "title": "E2E 测验",
        "exercise_ids": [q["id"] for q in exercises], "duration_min": 5,
    })
    check("组卷", st == 201 and paper["count"] == 2)
    st, attempt = api("POST", f"/papers/{paper['id']}/attempts")
    check("开始作答", st == 201 and attempt["id"])
    answers = {q["id"]: q["answer"] for q in exercises}  # 全部答对
    st, result = api("POST", f"/attempts/{attempt['id']}/submit", answers)
    check("提交判分（满分）", st == 200 and result["score"] == result["total_score"],
          f"score={result.get('score')}/{result.get('total_score')}")
    st, report = api("GET", f"/attempts/{attempt['id']}/report")
    check("成绩单含逐题判分", st == 200 and all(i["is_correct"] for i in report["items"]))

    st, attempt2 = api("POST", f"/papers/{paper['id']}/attempts")
    st, result2 = api("POST", f"/attempts/{attempt2['id']}/submit",
                      {exercises[0]["id"]: "A. 0"})
    check("客观题判分（答错扣分）", st == 200 and result2["score"] == 0)

    # 9. 答疑（RAG 流式 SSE）
    st, session = api("POST", "/sessions", {
        "course_id": course_id, "title": "E2E 答疑",
        "scope": {"chapter_ids": [chapters[2]["id"]]}, "mode": "direct",
    })
    check("创建答疑会话", st == 201 and session["id"])

    info = json.loads(_SIDECAR.read_text())
    conn = http.client.HTTPConnection("127.0.0.1", info["port"], timeout=60)
    conn.request("POST",
                 f"/api/v1/sessions/{session['id']}/messages?token={info['token']}",
                 json.dumps({"content": "什么是极限的 ε-δ 定义？"}),
                 {"Content-Type": "application/json"})
    resp = conn.getresponse()
    check("答疑 SSE 连接", resp.status == 200)
    events = []
    buf = ""
    decoder = __import__("codecs").getincrementaldecoder("utf-8")()
    while True:
        chunk = resp.read(4096)
        if not chunk:
            break
        buf += decoder.decode(chunk)
        while "\n\n" in buf:
            raw, buf = buf.split("\n\n", 1)
            if raw.startswith("event: "):
                ev = raw.split("\n")[0][7:]
                data = raw.split("data: ", 1)[1] if "data: " in raw else ""
                events.append((ev, json.loads(data) if data else None))
    conn.close()
    deltas = [d for e, d in events if e == "delta" and d]
    cites = [d for e, d in events if e == "citation" and d]
    done = [d for e, d in events if e == "done" and d]
    check("答疑流式输出", len(deltas) > 0, f"deltas={len(deltas)}")
    check("答疑带引用", len(cites) >= 1, f"citations={len(cites)}")
    check("引用含章节与段落", cites and cites[0].get("chapter") and cites[0].get("para_no"))
    check("done 事件含 token 统计", done and done[0].get("tokens_out", 0) > 0)

    st, msgs = api("GET", f"/sessions/{session['id']}/messages")
    check("答疑消息持久化", st == 200 and len(msgs) == 2, f"msgs={len(msgs)}")

    # 10. 任务中心
    st, tasks = api("GET", "/tasks?limit=100")
    check("任务中心记录全部任务", st == 200 and len(tasks) >= 3, f"tasks={len(tasks)}")


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
