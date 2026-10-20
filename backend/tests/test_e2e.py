"""端到端集成测试（需要运行中的 sidecar + 模拟 LLM）。

⚠️ 会写入 sidecar 所在的真实数据库（创建测试课程/模型），因此默认跳过，
   显式设置 LUMEN_E2E=1 才运行，避免污染用户本机知识库。

启动方式：
    # 终端 1：模拟 LLM（OpenAI 兼容）
    python tests/mock_llm.py
    # 终端 2：sidecar
    .venv/bin/python run.py
    # 运行测试
    LUMEN_E2E=1 pytest tests/test_e2e.py -v

覆盖：课程 CRUD → 模型注册/连通性 → 教材导入（结构识别+切分+索引）
→ 全文检索 → 章节总结 → 习题生成 → 组卷判分 → 答疑 RAG 流式引用。
"""
import http.client
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import pytest

# 数据目录可由 LUMEN_DATA_DIR 重定向（隔离测试，避免写入本机知识库），
# 与 sidecar 启动时保持一致即可。
_DATA_DIR = Path(os.environ.get("LUMEN_DATA_DIR") or "").expanduser() or (
    Path.home() / "Library" / "Application Support" / "lumen")
_SIDECAR = _DATA_DIR / "sidecar.json"

pytestmark = pytest.mark.skipif(
    os.environ.get("LUMEN_E2E") != "1",
    reason="集成测试会写入运行中的 sidecar 数据，需 LUMEN_E2E=1 显式开启",
)


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

    def upload(path, course_id, file_path, title=None):
        """multipart/form-data 上传（浏览器模式导入教材）。"""
        boundary = "----lumen" + "0" * 24
        def field(name, value):
            return (f'--{boundary}\r\nContent-Disposition: form-data; '
                    f'name="{name}"\r\n\r\n{value}\r\n').encode()
        body_parts = [field("course_id", course_id)]
        if title:
            body_parts.append(field("title", title))
        content = Path(file_path).read_bytes()
        fname = Path(file_path).name
        body_parts.append(
            (f'--{boundary}\r\nContent-Disposition: form-data; '
             f'name="file"; filename="{fname}"\r\n'
             f'Content-Type: application/octet-stream\r\n\r\n').encode()
            + content + b"\r\n")
        body_parts.append(f'--{boundary}--\r\n'.encode())
        req = urllib.request.Request(
            base + path + "?token=" + token,
            data=b"".join(body_parts), method="POST")
        req.add_header("Content-Type",
                       f"multipart/form-data; boundary={boundary}")
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.status, json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"null")

    call.upload = upload
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
    import_task_id = task["id"]
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
    st, scoped = api("GET", "/search?" + urllib.parse.urlencode(
        {"q": "ε-δ 定义", "course_id": course_id}))
    check("按课程过滤检索", st == 200 and scoped and
          all(h.get("course_id") == course_id for h in scoped))
    check("检索结果含课程/教材 id", scoped and scoped[0].get("textbook_id"))

    # 7. 章节总结
    st, task = api("POST", "/summaries/generate",
                   {"chapter_id": chapters[2]["id"], "model_id": model_id})
    summary_task_id = task["id"]
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
    check("成绩单返回满分口径", st == 200 and report.get("total_score") == result["total_score"])

    # 重复提交必须幂等：不能重复插入 Answer 或重复计分
    st, result_again = api("POST", f"/attempts/{attempt['id']}/submit", answers)
    st, report_again = api("GET", f"/attempts/{attempt['id']}/report")
    check("重复提交分数不变", st == 200 and result_again["score"] == result["score"],
          f"{result['score']} -> {result_again.get('score')}")
    check("重复提交不重复生成答卷", len(report_again["items"]) == len(report["items"]),
          f"{len(report['items'])} -> {len(report_again['items'])}")

    # 作答自动保存（刷新/重进后可恢复）
    st, draft_attempt = api("POST", f"/papers/{paper['id']}/attempts")
    check("创建自动保存用作答", st == 201 and draft_attempt.get("id"))
    partial = {exercises[0]["id"]: exercises[0]["answer"]}
    st, _ = api("PATCH", f"/attempts/{draft_attempt['id']}/answers", partial)
    check("自动保存作答", st == 200)
    st, saved = api("GET", f"/attempts/{draft_attempt['id']}/answers")
    check("读取已保存作答", st == 200 and
          saved["answers"].get(exercises[0]["id"]) == exercises[0]["answer"],
          json.dumps(saved, ensure_ascii=False))

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

    # 11. 主观题 AI 阅卷（P2）
    st, task = api("POST", "/exercises/generate", {
        "course_id": course_id, "chapter_ids": [chapters[2]["id"]],
        "types": {"short": 1}, "difficulty": 3, "model_id": model_id,
    })
    task = _wait_task(api, task["id"])
    check("简答题生成", task["status"] == "completed", task.get("error", ""))
    st, shorts = api("GET", f"/exercises?course_id={course_id}&status=draft&type=short")
    check("生成 1 道简答题", st == 200 and len(shorts) == 1, f"got {len(shorts)}")
    short_q = shorts[0]
    check("简答题无预设选项", short_q["options"] in (None, []))
    api("PATCH", f"/exercises/{short_q['id']}", {"status": "published"})
    st, paper2 = api("POST", "/papers", {
        "course_id": course_id, "title": "E2E 主观卷",
        "exercise_ids": [short_q["id"]], "duration_min": 5,
    })
    check("主观卷组卷", st == 201 and paper2["count"] == 1)
    st, attempt3 = api("POST", f"/papers/{paper2['id']}/attempts")
    check("主观卷作答", st == 201 and attempt3["id"])
    st, sub = api("POST", f"/attempts/{attempt3['id']}/submit",
                    {short_q["id"]: "极限就是无限接近的意思。"})
    check("主观题提交返回阅卷任务", st == 200 and sub.get("grading_task_id"),
          json.dumps(sub, ensure_ascii=False))
    gtask = _wait_task(api, sub["grading_task_id"])
    check("AI 阅卷任务完成", gtask["status"] == "completed", gtask.get("error", ""))
    check("阅卷记录 token 用量", gtask["tokens_in"] > 0 and gtask["tokens_out"] > 0)
    st, report3 = api("GET", f"/attempts/{attempt3['id']}/report")
    item = report3["items"][0]
    check("主观题已评分（5/10）", item["ai_score"] == 5, f"score={item['ai_score']}")
    check("主观题判为错误（<60%）", item["is_correct"] is False)
    check("阅卷反馈含得分点", item["ai_feedback"] and item["ai_feedback"]["points"])
    # 手动重评（P2）
    st, regraded = api("PATCH", f"/answers/{item['answer_id']}/regrade")
    check("手动重评接口", st == 200 and regraded.get("score") == 5,
          json.dumps(regraded, ensure_ascii=False))

    # 11.1 混合卷总分口径：客观题 + 主观题不能重复计分
    st, paper_mix = api("POST", "/papers", {
        "course_id": course_id, "title": "E2E 混合卷",
        "exercise_ids": [exercises[0]["id"], short_q["id"]], "duration_min": 10,
    })
    check("混合卷组卷", st == 201 and paper_mix["count"] == 2)
    st, attempt_mix = api("POST", f"/papers/{paper_mix['id']}/attempts")
    st, sub_mix = api("POST", f"/attempts/{attempt_mix['id']}/submit", {
        exercises[0]["id"]: exercises[0]["answer"],
        short_q["id"]: "极限就是无限接近的意思。",
    })
    gtask_mix = _wait_task(api, sub_mix["grading_task_id"])
    check("混合卷阅卷完成", gtask_mix["status"] == "completed", gtask_mix.get("error", ""))
    st, report_mix = api("GET", f"/attempts/{attempt_mix['id']}/report")
    check("混合卷总分=客观10+主观5", st == 200 and report_mix["score"] == 15,
          f"score={report_mix.get('score')}")

    # 12. 教案生成（P2）
    st, task = api("POST", "/lesson-plans/generate",
                   {"chapter_id": chapters[2]["id"], "model_id": model_id})
    task = _wait_task(api, task["id"])
    check("教案生成任务完成", task["status"] == "completed", task.get("error", ""))
    st, plans = api("GET", f"/chapters/{chapters[2]['id']}/lesson-plans")
    check("教案已保存（1 版本）", st == 200 and len(plans) == 1
          and "教学目标" in plans[0]["content"])

    # 13. 试卷导出（P2）
    st, export = api("GET", f"/papers/{paper['id']}/export?format=md")
    check("试卷导出 Markdown", st == 200 and export.get("content", "").startswith("# "))
    check("导出内容含题目", "设 f(x)" in export.get("content", ""))
    st, export_a = api("GET",
                       f"/papers/{paper['id']}/export?format=md&include_answers=true")
    check("导出含参考答案", "参考答案" in export_a.get("content", ""))

    # 14. 错题本（P2 雏形）
    st, wrong = api("GET", f"/courses/{course_id}/wrong-questions")
    check("错题本聚合判错题目", st == 200 and len(wrong["items"]) >= 1,
          f"items={len(wrong.get('items', []))}")
    check("错题带来源与解析", wrong["items"] and wrong["items"][0]["explanation"] is not None)

    # 15. 教材上传（浏览器模式 multipart）
    st, task = api.upload("/textbooks/upload", course_id,
                          Path(__file__).parent / "test-book.md")
    check("提交教材上传（multipart）", st == 202 and task.get("id"))
    task2 = _wait_task(api, task["id"])
    check("教材上传完成", task2["status"] == "completed", task2.get("error", ""))
    tb2 = task2["result_ref"]
    st, tb_info = api("GET", f"/textbooks/{tb2}")
    check("上传教材名为原文件名", st == 200 and tb_info["title"] == "test-book",
          tb_info.get("title", ""))

    # 课程下应有多本教材（多教材展示）
    st, tbs = api("GET", f"/textbooks?course_id={course_id}")
    check("课程含多本教材", st == 200 and len(tbs) >= 2, f"got {len(tbs)}")

    # 16. 删除教材（含章节/索引清理）
    st, _ = api("DELETE", f"/textbooks/{tb2}")
    check("删除教材", st == 204)
    st, tbs_after = api("GET", f"/textbooks?course_id={course_id}")
    check("删除后教材数减少", len(tbs_after) == len(tbs) - 1,
          f"{len(tbs)} -> {len(tbs_after)}")
    st, ch2 = api("GET", f"/textbooks/{tb2}/chapters")
    check("章节随教材删除", st == 200 and len(ch2) == 0)

    # 17. 删除试卷（级联清理作答/答卷，题库题目保留）
    st, papers_before = api("GET", f"/papers?course_id={course_id}")
    check("删除前试卷列表", st == 200 and len(papers_before) >= 2,
          f"got {len(papers_before)}")
    st, _ = api("DELETE", f"/papers/{paper['id']}")
    check("删除试卷", st == 204, f"status={st}")
    st, papers_after = api("GET", f"/papers?course_id={course_id}")
    check("试卷数减少 1", len(papers_after) == len(papers_before) - 1,
          f"{len(papers_before)} -> {len(papers_after)}")
    st, _ = api("GET", f"/papers/{paper['id']}")
    check("已删除试卷返回 404", st == 404, f"status={st}")
    st, _ = api("DELETE", f"/papers/{paper['id']}")
    check("重复删除返回 404", st == 404, f"status={st}")
    st, attempts_after = api("GET", f"/attempts?course_id={course_id}")
    check("试卷的作答记录一并删除", st == 200 and all(
        a["paper_id"] != paper["id"] for a in attempts_after),
        f"attempts={len(attempts_after)}")
    st, pub = api("GET", f"/exercises?course_id={course_id}&status=published")
    check("题库题目保留", st == 200 and len(pub) >= 3, f"got {len(pub)}")

    # 18. 历史任务重试（按 task_type + params 重建）
    st, retried = api("POST", f"/tasks/{summary_task_id}/retry")
    check("重试任务返回 202", st == 202 and retried.get("id"), json.dumps(retried, ensure_ascii=False))
    retried = _wait_task(api, retried["id"])
    check("重试任务完成", retried["status"] == "completed", retried.get("error", ""))

    # 19. 提示词模板（读取内置默认 → 保存自定义 → 读回）
    st, prompt = api("GET", "/prompt-templates/summary")
    check("读取内置提示词", st == 200 and prompt.get("builtin") is True and prompt.get("content"))
    st, saved_prompt = api("PUT", "/prompt-templates/summary", {
        "content": "你是测试用总结助手。请输出知识框架。", "name": "E2E 总结",
    })
    check("保存提示词模板", st == 200 and saved_prompt.get("version") == 1,
          json.dumps(saved_prompt, ensure_ascii=False))
    st, prompt2 = api("GET", "/prompt-templates/summary")
    check("读回自定义提示词", st == 200 and prompt2.get("builtin") is False
          and "测试用总结助手" in prompt2.get("content", ""))

    # 20. 用量概览
    st, usage = api("GET", "/usage/summary")
    check("用量概览", st == 200 and usage.get("tasks", 0) >= 1
          and usage.get("tokens_in", 0) > 0, json.dumps(usage, ensure_ascii=False))

    # 20.5 重试教材导入：应先清理旧章节/索引再解析，不能重复生成章节
    st, reimport = api("POST", f"/tasks/{import_task_id}/retry")
    check("重试教材导入返回 202", st == 202 and reimport.get("id"))
    reimport = _wait_task(api, reimport["id"])
    check("重试教材导入完成", reimport["status"] == "completed", reimport.get("error", ""))
    st, chapters_again = api("GET", f"/textbooks/{textbook_id}/chapters")
    check("重试导入不重复生成章节", st == 200 and len(chapters_again) == 5,
          f"got {len(chapters_again) if isinstance(chapters_again, list) else chapters_again}")

    # 20.6 删除题库题目：应从引用试卷移除，并重算满分/成绩单总分
    st, _ = api("DELETE", f"/exercises/{short_q['id']}")
    check("删除题库题目", st == 204, f"status={st}")
    st, mix_after = api("GET", f"/papers/{paper_mix['id']}")
    check("删除题目后试卷满分重算", st == 200 and mix_after["total_score"] == 10,
          f"total={mix_after.get('total_score')}")
    st, mix_report = api("GET", f"/attempts/{attempt_mix['id']}/report")
    check("删除题目后成绩单总分重算", st == 200 and mix_report["score"] == 10
          and len(mix_report["items"]) == 1, f"score={mix_report.get('score')}")

    # 20.7 嵌入维度变更：重建向量表（旧向量清空）且全文检索仍可用
    st, dim_res = api("PUT", "/settings", {"embedding_dim": "768"})
    check("更新嵌入维度", st == 200 and dim_res.get("reindex_required") is True,
          json.dumps(dim_res, ensure_ascii=False))
    st, stg = api("GET", "/settings")
    check("嵌入维度已保存", st == 200 and stg["settings"].get("embedding_dim") == "768")
    st, dim_hits = api("GET", "/search?" + urllib.parse.urlencode(
        {"q": "ε-δ 定义", "course_id": course_id}))
    check("维度变更后全文检索仍可用", st == 200 and len(dim_hits) >= 1)

    # 21. 删除课程应清理 FTS/向量索引（不能留下可检索的孤儿内容）
    st, _ = api("DELETE", f"/courses/{course_id}")
    check("删除课程", st == 204)
    st, orphan_hits = api("GET", "/search?" + urllib.parse.urlencode(
        {"q": "ε-δ 定义", "course_id": course_id}))
    check("删除课程后无残留检索结果", st == 200 and len(orphan_hits) == 0,
          f"hits={len(orphan_hits)}")


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
