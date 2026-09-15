from __future__ import annotations

import hashlib
import http.client
import json
import mimetypes
import re
import socket
import time
import unicodedata
import uuid
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urlsplit
from urllib.request import Request, urlopen


class InferFlowError(RuntimeError):
    def __init__(self, status_code: int, code: str, message: str, payload: dict | None = None):
        super().__init__(f"InferFlow API error {status_code} {code}: {message}")
        self.status_code = status_code
        self.code = code
        self.message = message
        self.payload = payload or {}

    def detail_lines(self) -> list[str]:
        error = self.payload.get("error") if isinstance(self.payload.get("error"), dict) else {}
        lines: list[str] = []
        violations = error.get("violations") if isinstance(error.get("violations"), list) else []
        warnings = error.get("warnings") if isinstance(error.get("warnings"), list) else []
        if violations:
            lines.append("具体违规项：")
            lines.extend(f"- {item}" for item in violations)
        if warnings:
            lines.append("质检警告：")
            lines.extend(f"- {item}" for item in warnings)
        report_url = str(error.get("report_download_url") or "")
        if report_url:
            lines.append(f"服务端报告：{report_url}")
        return lines


def parse_error_payload(payload: dict, fallback_message: str) -> tuple[str, str]:
    error = payload.get("error") if isinstance(payload.get("error"), dict) else {}
    code = error.get("code") or payload.get("code") or "api_error"
    message = error.get("message") or payload.get("message") or payload.get("detail") or fallback_message
    return str(code), str(message)


AMBIGUOUS_UPLOAD_STATUS_CODES = {502, 503, 504}
UPLOAD_RETRY_DELAYS_SECONDS = (2, 5, 10)
_UNSAFE_TTS_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_SCHEMA_ASSET_ENDPOINT_RE = re.compile(
    r"^/openapi/v1/assets/(?P<asset_kind>[a-z0-9][a-z0-9_-]{0,63})$"
)


def validate_schema_upload_endpoint(endpoint: Any, upload_to: Any) -> str:
    raw = str(endpoint or "").strip()
    expected_kind = str(upload_to or "").strip()
    parsed = urlsplit(raw)
    if (
        not raw
        or parsed.scheme
        or parsed.netloc
        or parsed.query
        or parsed.fragment
        or "\\" in raw
        or "%" in raw
        or unquote(raw) != raw
    ):
        raise InferFlowError(400, "invalid_upload_contract", "The public file upload contract is invalid.")
    matched = _SCHEMA_ASSET_ENDPOINT_RE.fullmatch(parsed.path)
    if not matched or matched.group("asset_kind") != expected_kind:
        raise InferFlowError(400, "invalid_upload_contract", "The public file upload contract is invalid.")
    return parsed.path


def normalize_tts_script_text(value: str | None) -> str:
    text = unicodedata.normalize("NFC", str(value or ""))
    text = text.replace("\\r\\n", "\n").replace("\\n", "\n").replace("\\r", "\n").replace("\\t", " ")
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\t", " ")
    text = _UNSAFE_TTS_CONTROL_RE.sub("", text)
    text = re.sub(r"[ ]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def file_sha256(file_path: Path) -> str:
    digest = hashlib.sha256()
    with file_path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def is_ambiguous_upload_error(exc: Exception) -> bool:
    if isinstance(exc, InferFlowError):
        return exc.status_code in AMBIGUOUS_UPLOAD_STATUS_CODES
    if isinstance(
        exc,
        (
            TimeoutError,
            socket.timeout,
            ConnectionResetError,
            ConnectionAbortedError,
            BrokenPipeError,
            EOFError,
            http.client.RemoteDisconnected,
            http.client.IncompleteRead,
        ),
    ):
        return True
    if isinstance(exc, URLError):
        reason = exc.reason
        if isinstance(reason, Exception) and reason is not exc:
            return is_ambiguous_upload_error(reason)
    message = str(exc).lower()
    return any(
        marker in message
        for marker in (
            "unexpected eof",
            "remote end closed connection",
            "connection reset",
            "connection aborted",
            "timed out",
            "timeout",
        )
    )


class InferFlowClient:
    def __init__(self, api_key: str, base_url: str):
        self.api_key = api_key.strip()
        self.base_url = base_url.rstrip("/")
        if not self.api_key:
            raise ValueError("api_key is required")

    def _url(self, path: str) -> str:
        if path.startswith("http://") or path.startswith("https://"):
            return path
        normalized = f"/{path.lstrip('/')}"
        api_prefix = "/openapi/v1"
        if self.base_url.endswith(api_prefix) and normalized.startswith(f"{api_prefix}/"):
            normalized = normalized[len(api_prefix) :]
        return f"{self.base_url}{normalized}"

    def _headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        headers = {"X-API-Key": self.api_key}
        if extra:
            headers.update(extra)
        return headers

    def _decode_response(self, response) -> Any:
        content_type = response.headers.get("Content-Type", "")
        body = response.read()
        if "application/json" in content_type:
            return json.loads(body.decode("utf-8"))
        return body

    def _request_json(
        self,
        method: str,
        path: str,
        payload: dict | None = None,
        headers: dict[str, str] | None = None,
        expected_type: type = dict,
    ) -> Any:
        body = None
        request_headers = self._headers(headers)
        if payload is not None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            request_headers["Content-Type"] = "application/json"
        request = Request(self._url(path), data=body, headers=request_headers, method=method)
        try:
            with urlopen(request, timeout=120) as response:
                data = self._decode_response(response)
        except HTTPError as exc:
            raw = exc.read()
            try:
                error_payload = json.loads(raw.decode("utf-8"))
            except Exception:
                error_payload = {"message": raw.decode("utf-8", errors="replace")}
            code, message = parse_error_payload(error_payload, "Request failed.")
            raise InferFlowError(
                exc.code,
                code,
                message,
                error_payload,
            ) from exc
        if not isinstance(data, expected_type):
            expected_label = "object" if expected_type is dict else "array"
            raise InferFlowError(502, "invalid_response", f"InferFlow returned an invalid JSON {expected_label} response.")
        return data

    def _multipart(
        self,
        path: str,
        file_path: Path,
        fields: dict[str, str | bool],
        headers: dict[str, str] | None = None,
    ) -> dict:
        boundary = f"inferflow-{uuid.uuid4().hex}"
        filename = file_path.name
        content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        chunks: list[bytes] = []
        for key, value in fields.items():
            chunks.append(f"--{boundary}\r\n".encode("utf-8"))
            chunks.append(f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode("utf-8"))
            chunks.append(str(value).lower().encode("utf-8") if isinstance(value, bool) else str(value).encode("utf-8"))
            chunks.append(b"\r\n")
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(
            (
                f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
                f"Content-Type: {content_type}\r\n\r\n"
            ).encode("utf-8")
        )
        chunks.append(file_path.read_bytes())
        chunks.append(b"\r\n")
        chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
        body = b"".join(chunks)
        request_headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
        if headers:
            request_headers.update(headers)
        request = Request(
            self._url(path),
            data=body,
            headers=self._headers(request_headers),
            method="POST",
        )
        try:
            with urlopen(request, timeout=300) as response:
                data = self._decode_response(response)
        except HTTPError as exc:
            raw = exc.read()
            try:
                error_payload = json.loads(raw.decode("utf-8"))
            except Exception:
                error_payload = {"message": raw.decode("utf-8", errors="replace")}
            code, message = parse_error_payload(error_payload, "Upload failed.")
            raise InferFlowError(
                exc.code,
                code,
                message,
                error_payload,
            ) from exc
        if not isinstance(data, dict):
            raise InferFlowError(502, "invalid_response", "InferFlow returned a non-JSON response.")
        return data

    @staticmethod
    def _asset_with_sha256(assets: list[dict], content_sha256: str, id_field: str) -> dict | None:
        expected = content_sha256.lower()
        for item in assets:
            if str(item.get("content_sha256") or "").lower() != expected:
                continue
            if not item.get(id_field):
                continue
            recovered = dict(item)
            recovered["reused_existing"] = True
            recovered["recovered_after_ambiguous_failure"] = True
            return recovered
        return None

    def _upload_material_with_recovery(
        self,
        *,
        endpoint: str,
        file_path: Path,
        fields: dict[str, str | bool],
        list_assets,
        id_field: str,
        idempotency_prefix: str,
    ) -> dict:
        content_sha256 = file_sha256(file_path)
        idempotency_key = f"{idempotency_prefix}-{uuid.uuid4().hex}"
        attempts = 1 + len(UPLOAD_RETRY_DELAYS_SECONDS)
        for attempt in range(attempts):
            try:
                result = self._multipart(
                    endpoint,
                    file_path,
                    fields,
                    {"Idempotency-Key": idempotency_key},
                )
                result.setdefault("content_sha256", content_sha256)
                return result
            except Exception as exc:
                if not is_ambiguous_upload_error(exc):
                    raise
                try:
                    recovered = self._asset_with_sha256(list_assets(), content_sha256, id_field)
                except Exception:
                    recovered = None
                if recovered:
                    return recovered
                if attempt >= len(UPLOAD_RETRY_DELAYS_SECONDS):
                    raise
                time.sleep(UPLOAD_RETRY_DELAYS_SECONDS[attempt])
        raise RuntimeError("Upload retry loop ended unexpectedly.")

    def upload_avatar(self, file_path: str | Path, name: str | None = None) -> dict:
        path = Path(file_path).expanduser().resolve()
        if not path.exists():
            raise FileNotFoundError(path)
        return self._upload_material_with_recovery(
            endpoint="/digital-human/avatars",
            file_path=path,
            fields={"name": name or path.stem, "authorization_confirmed": True},
            list_assets=self.list_avatars,
            id_field="avatar_id",
            idempotency_prefix="avatar-upload",
        )

    def upload_voice(self, file_path: str | Path, name: str | None = None) -> dict:
        path = Path(file_path).expanduser().resolve()
        if not path.exists():
            raise FileNotFoundError(path)
        return self._upload_material_with_recovery(
            endpoint="/digital-human/voices",
            file_path=path,
            fields={"name": name or path.stem, "authorization_confirmed": True},
            list_assets=self.list_voices,
            id_field="voice_id",
            idempotency_prefix="voice-upload",
        )

    def list_avatars(self) -> list[dict]:
        return self._request_json("GET", "/digital-human/avatars", expected_type=list)

    def list_voices(self) -> list[dict]:
        return self._request_json("GET", "/digital-human/voices", expected_type=list)

    def delete_avatar(self, avatar_id: str) -> dict:
        return self._request_json("DELETE", f"/digital-human/avatars/{quote(avatar_id)}")

    def delete_voice(self, voice_id: str) -> dict:
        return self._request_json("DELETE", f"/digital-human/voices/{quote(voice_id)}")

    def upload_temp_asset(self, file_path: str | Path, ttl_days: int = 7) -> dict:
        path = Path(file_path).expanduser().resolve()
        if not path.exists():
            raise FileNotFoundError(path)
        return self._multipart(
            "/temp-assets",
            path,
            {"ttl_days": ttl_days},
        )

    def upload_schema_asset(
        self,
        file_path: str | Path,
        *,
        upload_endpoint: str,
        upload_to: str,
        name: str | None = None,
    ) -> dict:
        path = Path(file_path).expanduser().resolve()
        if not path.is_file():
            raise FileNotFoundError(path)
        endpoint = validate_schema_upload_endpoint(upload_endpoint, upload_to)
        content_sha256 = file_sha256(path)
        idempotency_key = f"asset-upload-{uuid.uuid4().hex}"
        attempts = 1 + len(UPLOAD_RETRY_DELAYS_SECONDS)
        for attempt in range(attempts):
            try:
                result = self._multipart(
                    endpoint,
                    path,
                    {"name": name or path.stem, "authorization_confirmed": True},
                    {"Idempotency-Key": idempotency_key},
                )
                asset_id = str(result.get("asset_id") or "").strip()
                if not asset_id:
                    raise InferFlowError(
                        502,
                        "invalid_response",
                        "The file upload response is invalid.",
                    )
                result.setdefault("content_sha256", content_sha256)
                return result
            except Exception as exc:
                if not is_ambiguous_upload_error(exc) or attempt >= len(UPLOAD_RETRY_DELAYS_SECONDS):
                    raise
                time.sleep(UPLOAD_RETRY_DELAYS_SECONDS[attempt])
        raise RuntimeError("Upload retry loop ended unexpectedly.")

    def create_digital_human_video(
        self,
        *,
        title: str,
        script_text: str,
        voice_id: str,
        avatar_id: str,
        emotion_text: str | None = None,
        segmentation_mode: str = "fast_segments",
        workflow_code: str | None = "digital_human_standard",
        idempotency_key: str | None = None,
    ) -> dict:
        payload = {
            "title": title,
            "script_text": normalize_tts_script_text(script_text),
            "voice_id": voice_id,
            "avatar_id": avatar_id,
            "segmentation_mode": segmentation_mode,
        }
        if emotion_text:
            payload["emotion_text"] = emotion_text
        if workflow_code:
            payload["workflow_code"] = workflow_code
        return self._request_json(
            "POST",
            "/digital-human/videos",
            payload,
            {"Idempotency-Key": idempotency_key or str(uuid.uuid4())},
        )

    def get_skill(self, skill_code: str) -> dict:
        return self._request_json("GET", f"/skills/{quote(skill_code)}")

    def get_credits(self) -> dict:
        return self._request_json("GET", "/credits")

    def list_skills(self) -> dict:
        return self._request_json("GET", "/skills")

    def get_client_skill_update(self) -> dict:
        return self._request_json("GET", "/client-skills/inferflow-codex/manifest")

    def create_skill_run(
        self,
        skill_code: str,
        inputs: dict,
        *,
        idempotency_key: str | None = None,
    ) -> dict:
        return self._request_json(
            "POST",
            f"/skills/{quote(skill_code)}/runs",
            {"inputs": inputs},
            {"Idempotency-Key": idempotency_key or str(uuid.uuid4())},
        )

    def get_run(self, run_id: str) -> dict:
        return self._request_json("GET", f"/runs/{quote(run_id)}")

    def cancel_run(self, run_id: str) -> dict:
        return self._request_json("POST", f"/runs/{quote(run_id)}/cancel", {})

    def list_outputs(self, run_id: str) -> dict:
        return self._request_json("GET", f"/runs/{quote(run_id)}/outputs")

    def create_ngg_v4_edit_package(self, run_id: str, *, canvas_mode: str = "source") -> dict:
        if canvas_mode not in {"source", "standard"}:
            raise ValueError("canvas_mode must be source or standard")
        return self._request_json(
            "POST",
            f"/runs/{quote(run_id)}/edit-packages/ngg-v4",
            {"canvas_mode": canvas_mode},
        )

    def download_output(self, download_url: str, output_path: str | Path) -> Path:
        path = Path(output_path).expanduser().resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        request = Request(self._url(download_url), headers=self._headers(), method="GET")
        try:
            with urlopen(request, timeout=600) as response:
                path.write_bytes(response.read())
        except HTTPError as exc:
            raw = exc.read()
            try:
                error_payload = json.loads(raw.decode("utf-8"))
            except Exception:
                error_payload = {"message": raw.decode("utf-8", errors="replace")}
            code, message = parse_error_payload(error_payload, "Download failed.")
            raise InferFlowError(
                exc.code,
                code if code != "api_error" else "download_error",
                message,
                error_payload,
            ) from exc
        return path

    def poll_run(self, run_id: str, *, interval_seconds: int = 8, timeout_seconds: int = 7200) -> dict:
        deadline = time.time() + timeout_seconds
        while time.time() < deadline:
            status = self.get_run(run_id)
            if status.get("status") in {"completed", "failed", "canceled"}:
                return status
            time.sleep(max(1, interval_seconds))
        raise TimeoutError(f"InferFlow run did not finish within {timeout_seconds} seconds: {run_id}")
