"""解析层单元测试：加密 PDF 口令校验。"""
import pytest

from app.services.parsing import ParseError, extract

pymupdf = pytest.importorskip("pymupdf")


def _make_encrypted_pdf(path, password: str = "pass123") -> None:
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Secret chapter content about limits.")
    doc.save(str(path), encryption=pymupdf.PDF_ENCRYPT_AES_256,
             owner_pw="owner", user_pw=password)
    doc.close()


def test_encrypted_pdf_requires_passphrase(tmp_path):
    path = tmp_path / "enc.pdf"
    _make_encrypted_pdf(path)
    with pytest.raises(ParseError, match="口令"):
        extract(str(path), "pdf")


def test_encrypted_pdf_wrong_passphrase(tmp_path):
    path = tmp_path / "enc.pdf"
    _make_encrypted_pdf(path)
    with pytest.raises(ParseError, match="口令错误"):
        extract(str(path), "pdf", "wrong")


def test_encrypted_pdf_with_passphrase(tmp_path):
    path = tmp_path / "enc.pdf"
    _make_encrypted_pdf(path)
    result = extract(str(path), "pdf", "pass123")
    assert "limits" in result.pages[0][1]
    assert result.word_count > 0
