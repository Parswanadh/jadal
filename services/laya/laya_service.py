#!/usr/bin/env python3
"""Local Laya System-1 decision service for Jadal.

A single-process HTTP service the Jadal Worker can call for a System-1 decision when it has no
Jev key, or when it wants an offline tier. Stdlib ``http.server`` only -- the sole third-party
dependency is ``laya`` itself (plus the torch/transformers it needs).

    GET  /health  -> {"ok": bool, "model": str, "device": "cpu"|"cuda", ...}
    POST /decide  -> {"intent", "urgency", "is_release_time", "source", "latency_ms", ...}

Honesty rules this file implements (brief SS3):

* The checkpoint is loaded **once**, in ``ModelHolder.load``, before any request is served.
* If it cannot load, ``/health`` reports ``ok: false`` with the error text, and ``/decide``
  returns HTTP 503 with an ``error`` field and **no** ``intent``/``urgency`` keys at all. The
  Worker falls back to its rules; a fabricated decision would make that fallback invisible.
* Every failure path (bad JSON, missing text, over-long input, model error, mapping error)
  returns an error body and never a decision.
* ``urgency`` and ``is_release_time`` are returned as ``null`` by default: the independent
  evaluation in ``docs/research/laya-verdict.md`` showed this checkpoint's values for those two
  fields are not trustworthy, so they are kept out of the decision path and the Worker falls
  back to rules for them. The raw model output is preserved under ``unvalidated``. See
  ``jadal_decision.py`` for the full argument and the opt-in switch.

Environment:
    LAYA_MODEL      checkpoint dir or hub id   (default: the verified local dir, else the hub)
    LAYA_SUBFOLDER  subfolder inside the repo  (default: unset for a local dir)
    LAYA_DEVICE     auto|cpu|cuda              (default auto -> cuda when available)
    LAYA_HOST       bind address               (default 127.0.0.1)
    LAYA_PORT       port                       (default 8099)
    LAYA_MAX_LEN    token budget per request   (default: checkpoint config, 1024)
    LAYA_LANG       language hint, e.g. te     (default: unset -> checkpoint default)
    LAYA_TRUST_UNVALIDATED_FIELDS
                    "1" to emit the model's urgency/is_release_time in the decision path
                    (default 0: they are returned as null; only for a validated checkpoint)
    LAYA_TORCH_THREADS  CPU thread cap         (default 4, keeps the laptop usable)
    LAYA_SKIP_LOAD  if "1", serve with no model (exercises the honest-failure path)
"""

from __future__ import annotations

import json
import os
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from jadal_decision import (
    JADAL_QUESTIONS,
    MAX_STATE_TOKENS,
    REQUIRED_QUESTION_IDS,
    DecisionMappingError,
    InputTooLongError,
    assert_input_length,
    build_decision,
    count_state_tokens,
    result_usage,
    unwrap_answers,
)

#: The verified multilingual checkpoint, already on this machine (mmBERT-base, 643,835,514-byte
#: model.safetensors). Pinned as a local directory so the service never hits the network, and
#: pointed at the bundle repo's `multilingual/` subfolder -- the artifact the evaluation lane
#: validated -- rather than a separately published repo.
VERIFIED_LOCAL_MODEL = "/home/parshu/projects/contri/laya-lab/models/multilingual"
HUB_MODEL = "convaiinnovations/laya"
HUB_SUBFOLDER = "multilingual"

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8099

#: The exact questions this service evaluates unless the caller supplies its own.
DEFAULT_QUESTIONS: dict[str, Any] = JADAL_QUESTIONS

SERVICE_VERSION = "0.2.0"


def default_model() -> tuple[str, str | None]:
    """The verified local checkpoint when it is present, else the pinned hub repo + subfolder."""
    if os.path.isdir(VERIFIED_LOCAL_MODEL):
        return VERIFIED_LOCAL_MODEL, None
    return HUB_MODEL, HUB_SUBFOLDER


class ModelHolder:
    """Owns the one and only loaded Laya agent.

    ``state`` is one of ``loading`` / ``ready`` / ``failed``. Inference is serialised behind a
    lock: a torch module is not reliably re-entrant, and serialising also bounds peak VRAM when
    several requests arrive at once.
    """

    def __init__(self, model_id: str, device: str, subfolder: str | None = None) -> None:
        self.model_id = model_id
        self.subfolder = subfolder
        self.requested_device = device
        self.agent: Any = None
        self.resolved_device: str = "cpu"
        self.state = "loading"
        self.error: str | None = None
        self.load_seconds: float | None = None
        self.loaded_at: float | None = None
        self.inferences = 0
        self._lock = threading.Lock()

    # -- lifecycle ---------------------------------------------------------------------------
    def load(self) -> None:
        """Load the checkpoint exactly once. Never raises: failure is recorded, not thrown."""
        started = time.monotonic()
        try:
            import torch

            threads = int(os.environ.get("LAYA_TORCH_THREADS", "4"))
            if threads > 0:
                torch.set_num_threads(threads)

            import laya

            device = None if self.requested_device == "auto" else self.requested_device
            kwargs: dict[str, Any] = {}
            if self.subfolder:
                kwargs["subfolder"] = self.subfolder
            agent = laya.load(self.model_id, device=device, **kwargs)

            self.agent = agent
            self.resolved_device = str(getattr(agent, "device", "cpu")).split(":")[0]
            self.state = "ready"
            self.loaded_at = time.time()
        except BaseException as exc:  # noqa: BLE001 - recorded and surfaced, never swallowed
            self.state = "failed"
            self.error = "%s: %s" % (type(exc).__name__, exc)
            self.error_traceback = traceback.format_exc()
        finally:
            self.load_seconds = round(time.monotonic() - started, 3)

    # -- inference ---------------------------------------------------------------------------
    def decide(self, text: str, questions: dict[str, Any]) -> tuple[dict[str, Any], float, int]:
        """One decision. Returns ``(envelope, latency_ms, state_tokens)``.

        Raises :class:`InputTooLongError` before inference when the state is outside the
        validated window -- never truncates silently, because the evaluation showed truncation
        drops the tail of the message, which is where the ask is.
        """
        if self.state != "ready" or self.agent is None:
            raise RuntimeError(
                "model is not loaded (state=%s, error=%s)" % (self.state, self.error)
            )
        with self._lock:
            state_tokens = count_state_tokens(self.agent.tok, text)
            assert_input_length(state_tokens)

            started = time.perf_counter()
            result = self.agent.system_one({"text": text}, questions, **self._call_kwargs())
            latency_ms = (time.perf_counter() - started) * 1000.0
            self.inferences += 1
        return result, latency_ms, state_tokens

    def _call_kwargs(self) -> dict[str, Any]:
        kwargs: dict[str, Any] = {}
        max_len = os.environ.get("LAYA_MAX_LEN")
        if max_len:
            kwargs["max_len"] = int(max_len)
        lang = os.environ.get("LAYA_LANG")
        if lang:
            kwargs["lang"] = lang
        return kwargs

    # -- reporting ---------------------------------------------------------------------------
    def health(self) -> dict[str, Any]:
        return {
            "ok": self.state == "ready",
            "model": self.model_id,
            "subfolder": self.subfolder,
            "device": self.resolved_device if self.state == "ready" else self.requested_device,
            "state": self.state,
            "error": self.error,
            "load_seconds": self.load_seconds,
            "inferences": self.inferences,
            "max_state_tokens": MAX_STATE_TOKENS,
            "service_version": SERVICE_VERSION,
        }


def _validate_questions(raw: Any) -> dict[str, Any]:
    """Accept the Worker's frozen four ids (or any set containing ``intent``)."""
    if raw is None:
        return DEFAULT_QUESTIONS
    if not isinstance(raw, dict) or not raw:
        raise ValueError("'questions' must be a non-empty object")
    missing = [qid for qid in REQUIRED_QUESTION_IDS if qid not in raw]
    if missing:
        raise ValueError(
            "'questions' is missing the question id(s) a Jadal decision needs: %s"
            % ", ".join(missing)
        )
    return raw


def _trust_unvalidated() -> bool:
    return os.environ.get("LAYA_TRUST_UNVALIDATED_FIELDS") == "1"


class Handler(BaseHTTPRequestHandler):
    server_version = "jadal-laya/" + SERVICE_VERSION
    protocol_version = "HTTP/1.1"

    # `holder` is set on the server instance in `make_server`.
    @property
    def holder(self) -> ModelHolder:
        return self.server.holder  # type: ignore[attr-defined]

    # -- plumbing ----------------------------------------------------------------------------
    def _send(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args: Any) -> None:  # noqa: A003
        print("[laya] %s - %s" % (self.address_string(), fmt % args), flush=True)

    def _read_json(self) -> Any:
        length = int(self.headers.get("content-length") or 0)
        if length <= 0:
            raise ValueError("request body is empty; expected a JSON object")
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("request body is not valid UTF-8 JSON: %s" % exc) from None

    # -- routes ------------------------------------------------------------------------------
    def do_GET(self) -> None:  # noqa: N802
        if self.path.split("?")[0] == "/health":
            health = self.holder.health()
            self._send(200 if health["ok"] else 503, health)
        else:
            self._send(404, {"error": "not_found", "detail": "only GET /health is served"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.split("?")[0] != "/decide":
            self._send(404, {"error": "not_found", "detail": "only POST /decide is served"})
            return

        # 1. Parse + validate the request. A bad request is the caller's problem, not a decision.
        try:
            body = self._read_json()
            if not isinstance(body, dict):
                raise ValueError("request body must be a JSON object")
            text = body.get("text")
            if not isinstance(text, str) or not text.strip():
                raise ValueError("'text' must be a non-empty string")
            questions = _validate_questions(body.get("questions"))
        except ValueError as exc:
            self._send(400, {"error": "bad_request", "detail": str(exc), "source": None})
            return

        # 2. Refuse honestly when the model is not up. No intent, no urgency, no guessing.
        if self.holder.state != "ready":
            self._send(
                503,
                {
                    "error": "laya_unavailable",
                    "detail": "Laya did not run: model state is %r (%s). Fall back to rules."
                    % (self.holder.state, self.holder.error),
                    "source": None,
                    "model": self.holder.model_id,
                    "device": self.holder.requested_device,
                },
            )
            return

        # 3. Infer, then map. Every failure below returns an error body, never a decision.
        try:
            result, latency_ms, state_tokens = self.holder.decide(text, questions)
        except InputTooLongError as exc:
            self._send(
                422,
                {
                    "error": "input_too_long",
                    "detail": str(exc),
                    "source": None,
                    "model": self.holder.model_id,
                },
            )
            return
        except Exception as exc:  # noqa: BLE001
            self._send(
                500,
                {
                    "error": "laya_inference_failed",
                    "detail": "%s: %s" % (type(exc).__name__, exc),
                    "source": None,
                    "model": self.holder.model_id,
                },
            )
            return

        try:
            # `system_one` returns the {"model","answers","usage"} envelope; build_decision
            # wants the inner answers map. Unwrapping here is what the 502 regression fixed.
            answers = unwrap_answers(result)
            decision = build_decision(
                answers,
                latency_ms=int(round(latency_ms)),
                model=self.holder.model_id,
                device=self.holder.resolved_device,
                trust_unvalidated=_trust_unvalidated(),
                usage=result_usage(result),
                state_tokens=state_tokens,
            )
        except DecisionMappingError as exc:
            self._send(
                502,
                {
                    "error": "laya_answer_not_mapable",
                    "detail": str(exc),
                    "source": None,
                    "model": self.holder.model_id,
                },
            )
            return

        self._send(200, decision)


def make_server(holder: ModelHolder, host: str, port: int) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    server.holder = holder  # type: ignore[attr-defined]
    return server


def main() -> int:
    default_id, default_sub = default_model()
    model_id = os.environ.get("LAYA_MODEL", default_id)
    subfolder = os.environ.get("LAYA_SUBFOLDER", default_sub)
    device = os.environ.get("LAYA_DEVICE", "auto").lower()
    host = os.environ.get("LAYA_HOST", DEFAULT_HOST)
    port = int(os.environ.get("LAYA_PORT", str(DEFAULT_PORT)))
    skip_load = os.environ.get("LAYA_SKIP_LOAD") == "1"

    holder = ModelHolder(model_id, device, subfolder)
    server = make_server(holder, host, port)

    # Serve first so /health answers while the checkpoint is still loading; /decide returns 503
    # with state="loading" until it is ready. Still exactly one load.
    thread = threading.Thread(target=server.serve_forever, name="laya-http", daemon=True)
    thread.start()
    print("[laya] listening on http://%s:%d" % (host, port), flush=True)

    if skip_load:
        holder.state = "failed"
        holder.error = "LAYA_SKIP_LOAD=1: no model was loaded (degraded mode for testing)"
        holder.load_seconds = 0.0
        print("[laya] LAYA_SKIP_LOAD=1 - serving without a model", flush=True)
    else:
        print(
            "[laya] loading %s%s (device=%s) ..."
            % (model_id, "::" + subfolder if subfolder else "", device),
            flush=True,
        )
        holder.load()
        if holder.state == "ready":
            print(
                "[laya] ready: device=%s load=%.1fs"
                % (holder.resolved_device, holder.load_seconds or 0.0),
                flush=True,
            )
        else:
            print("[laya] LOAD FAILED: %s" % holder.error, flush=True)

    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        print("[laya] shutting down", flush=True)
    finally:
        server.shutdown()
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
