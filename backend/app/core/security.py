"""API Key 加密：AES-256-GCM；主密钥优先存 OS 钥匙串，降级为本地加密文件。"""
import base64
import logging
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .config import APP_DIR

logger = logging.getLogger(__name__)

_MASTER_KEY_FILE = APP_DIR / "master.key"


def _master_key() -> bytes:
    # 1) 优先 OS 钥匙串（macOS Keychain / Windows 凭据管理器 / Linux Secret Service）
    try:
        import keyring

        k = keyring.get_password("lumen", "master-key")
        if k:
            return base64.b64decode(k)
    except Exception as e:  # pragma: no cover
        logger.debug(f"keyring 不可用: {e}")
    # 2) 降级：本地文件（仅本机可读），并给出警告
    if _MASTER_KEY_FILE.exists():
        return _MASTER_KEY_FILE.read_bytes()
    k = AESGCM.generate_key(bit_length=256)
    _MASTER_KEY_FILE.write_bytes(k)
    try:
        _MASTER_KEY_FILE.chmod(0o600)
    except OSError:
        pass
    logger.warning("OS 钥匙串不可用，主密钥已写入本地文件（安全性降级）")
    return k


def encrypt(plain: str) -> str:
    if not plain:
        return ""
    aes = AESGCM(_master_key())
    nonce = os.urandom(12)
    ct = aes.encrypt(nonce, plain.encode(), None)
    return base64.b64encode(nonce + ct).decode()


def decrypt(token: str) -> str:
    if not token:
        return ""
    raw = base64.b64decode(token)
    aes = AESGCM(_master_key())
    return aes.decrypt(raw[:12], raw[12:], None).decode()
