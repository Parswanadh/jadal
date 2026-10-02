#!/usr/bin/env python3
"""HTTP-level tests for the service, with a stubbed Laya agent.

No model, no network, no torch: a fake agent returns the real envelope shape, so this pins the
end-to-end behaviour of ``/decide`` -- including the 502 regression where the envelope was
passed to ``build_decision`` instead of its inner ``answers`` map.

    python -m unittest -v test_service_http
"""

from __future__ import annotations

import json
import threading
import unittest
import urllib.error
import urllib.request

from jadal_decision import URGENCY_BANDS
from laya_service import ModelHolder, make_server


class FakeTokenizer:
    def __call__(self, text, add_special_tokens=False):
        return {"input_ids": text.split()}


class FakeAgent:
    """Stands in for `laya.Agent`: same `system_one` envelope, same `tok`."""

    def __init__(self, answers=None):
        self.device = "cpu"
        self.tok = FakeTokenizer()
        self.answers = answers if answers is not None else self._default_answers()
        self.calls = []

    def _default_answers(self):
        return {
            "intent": {
                "type": "choice",
                "choice": "urgent_request",
                "probabilities": {"urgent_request": 0.91, "other": 0.09},
                "confidence": 0.7,
                "answer_confidence": 0.86,
            },
            "urgency": {
                "type": "score",
                "score": 4.0,
                "legend": {str(i): t for i, t in enumerate(URGENCY_BANDS)},
                "probabilities": {"0": 0.0, "1": 0.0, "2": 0.0, "3": 0.05, "4": 0.95},
            },
            "mentions_crop_stress": {"type": "noul", "noul": 0.97, "confidence": 0.97},
            "is_release_time": {"type": "noul", "noul": 0.814, "confidence": 0.814},
        }

    def system_one(self, state, questions, **kwargs):
        self.calls.append({"state": state, "questions": list(questions), "kwargs": kwargs})
        return {
            "model": "laya-rl-agent",
            "answers": self.answers,
            "usage": {"input_tokens": 41, "output_tokens": 8, "truncated": False},
        }


def start(holder):
    server = make_server(holder, "127.0.0.1", 0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, "http://127.0.0.1:%d" % server.server_address[1]


def call(url, payload=None, timeout=10):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"content-type": "application/json"} if data else {},
        method="POST" if data else "GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read().decode("utf-8"))


TELUGU = "నా వరి పంట ఎండిపోతుంది, కాలువలో నీళ్లు లేవు. వెంటనే నీరు పంపండి."


class TestHttp(unittest.TestCase):
    def setUp(self):
        self.agent = FakeAgent()
        self.holder = ModelHolder("fake-checkpoint", "cpu")
        self.holder.agent = self.agent
        self.holder.state = "ready"
        self.holder.resolved_device = "cpu"
        self.server, self.base = start(self.holder)
        self.addCleanup(self.server.shutdown)
        self.addCleanup(self.server.server_close)

    def test_health(self):
        status, body = call(self.base + "/health")
        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        self.assertEqual(body["model"], "fake-checkpoint")
        self.assertEqual(body["device"], "cpu")
        self.assertEqual(body["state"], "ready")

    def test_decide_returns_200_not_502(self):
        """The regression: an envelope-shaped agent result must still produce a decision."""
        status, body = call(self.base + "/decide", {"text": TELUGU})
        self.assertEqual(status, 200, body)
        self.assertEqual(body["source"], "laya")
        self.assertEqual(body["intent"], "urgent_request")
        self.assertIsInstance(body["latency_ms"], int)

    def test_decide_keeps_untrusted_fields_out_of_the_decision_path(self):
        _, body = call(self.base + "/decide", {"text": TELUGU})
        self.assertIsNone(body["urgency"])
        self.assertIsNone(body["is_release_time"])
        self.assertEqual(set(body["untrusted_fields"]), {"urgency", "is_release_time"})
        self.assertIs(body["mentions_crop_stress"], True)
        # ...but the raw model output is not hidden.
        self.assertEqual(body["unvalidated"]["is_release_time_probability"], 0.814)

    def test_decide_accepts_the_frozen_four_question_ids(self):
        questions = {
            "intent": {"type": "choice", "instructions": "What does the farmer want in `text`?",
                       "criteria": {"urgent_request": "needs water now", "other": "none"}},
            "urgency": {"type": "score", "instructions": "How urgent is `text`?",
                        "criteria": ["a", "b"]},
            "mentions_crop_stress": {"type": "noul", "instructions": "Is the crop suffering in `text`?"},
            "is_release_time": {"type": "noul", "instructions": "Does `text` ask about release timing?"},
        }
        status, body = call(self.base + "/decide", {"text": TELUGU, "questions": questions})
        self.assertEqual(status, 200, body)
        self.assertEqual(self.agent.calls[-1]["questions"], list(questions))

    def test_decide_rejects_questions_without_intent(self):
        status, body = call(self.base + "/decide", {"text": TELUGU, "questions": {"urgency": {}}})
        self.assertEqual(status, 400)
        self.assertEqual(body["error"], "bad_request")
        self.assertNotIn("intent", body)

    def test_decide_rejects_empty_text(self):
        status, body = call(self.base + "/decide", {"text": "   "})
        self.assertEqual(status, 400)
        self.assertEqual(body["error"], "bad_request")

    def test_decide_rejects_bad_json(self):
        request = urllib.request.Request(
            self.base + "/decide", data=b"not json",
            headers={"content-type": "application/json"}, method="POST",
        )
        try:
            urllib.request.urlopen(request, timeout=10)
            self.fail("expected HTTPError")
        except urllib.error.HTTPError as exc:
            self.assertEqual(exc.code, 400)

    def test_over_long_input_is_refused_not_truncated(self):
        status, body = call(self.base + "/decide", {"text": "word " * 900})
        self.assertEqual(status, 422)
        self.assertEqual(body["error"], "input_too_long")
        self.assertNotIn("intent", body)
        self.assertEqual(self.agent.calls, [])  # never reached the model


class TestDegraded(unittest.TestCase):
    def test_unloaded_service_refuses_without_a_decision(self):
        holder = ModelHolder("fake-checkpoint", "cpu")
        holder.state = "failed"
        holder.error = "RuntimeError: boom"
        server, base = start(holder)
        self.addCleanup(server.shutdown)
        self.addCleanup(server.server_close)

        status, health = call(base + "/health")
        self.assertEqual(status, 503)
        self.assertFalse(health["ok"])
        self.assertIn("boom", health["error"])

        status, body = call(base + "/decide", {"text": TELUGU})
        self.assertEqual(status, 503)
        self.assertEqual(body["error"], "laya_unavailable")
        for key in ("intent", "urgency", "is_release_time"):
            self.assertNotIn(key, body)
        self.assertIsNone(body["source"])

    def test_inference_failure_returns_no_decision(self):
        class ExplodingAgent(FakeAgent):
            def system_one(self, state, questions, **kwargs):
                raise RuntimeError("cuda oom")

        holder = ModelHolder("fake-checkpoint", "cpu")
        holder.agent = ExplodingAgent()
        holder.state = "ready"
        server, base = start(holder)
        self.addCleanup(server.shutdown)
        self.addCleanup(server.server_close)

        status, body = call(base + "/decide", {"text": TELUGU})
        self.assertEqual(status, 500)
        self.assertEqual(body["error"], "laya_inference_failed")
        self.assertNotIn("intent", body)

    def test_unmapable_intent_returns_no_decision(self):
        holder = ModelHolder("fake-checkpoint", "cpu")
        holder.agent = FakeAgent({"intent": {"type": "choice", "choice": "refund"}})
        holder.state = "ready"
        server, base = start(holder)
        self.addCleanup(server.shutdown)
        self.addCleanup(server.server_close)

        status, body = call(base + "/decide", {"text": TELUGU})
        self.assertEqual(status, 502)
        self.assertEqual(body["error"], "laya_answer_not_mapable")
        self.assertNotIn("intent", body)


if __name__ == "__main__":
    unittest.main(verbosity=2)
