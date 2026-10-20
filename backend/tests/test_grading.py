"""客观题判分归一化：兼容选项键、完整选项文本与判断题写法。"""
from app.api.routes import _choice_key, _choice_keys, _norm_text


def test_single_choice_key_and_text():
    assert _choice_key("C. 2") == "C"
    assert _choice_key("C") == "C"
    assert _choice_key("c") == "C"
    assert _norm_text("C. 2") == "2"
    assert _norm_text("C") == "c"


def test_judge_choice_key():
    assert _choice_key("√ 正确") == "√"
    assert _choice_key("正确") == "√"
    assert _choice_key("× 错误") == "×"
    assert _choice_key("错误") == "×"


def test_multi_choice_keys():
    assert _choice_keys("A. 甲,C. 丙") == {"A", "C"}
    assert _choice_keys("A,C") == {"A", "C"}
    assert _choice_keys("AC") == {"A", "C"}
