#!/usr/bin/env python3
"""Unit tests for the Jadal decision mapping. No model, no network, no torch.

    python -m unittest -v test_jadal_decision
"""

from __future__ import annotations

import unittest

from jadal_decision import (
    FIELD_TRUST,
    INTENTS,
    JADAL_QUESTIONS,
    MAX_STATE_TOKENS,
    URGENCY_BANDS,
    WORKER_QUESTION_IDS,
    DecisionMappingError,
    InputTooLongError,
    assert_input_length,
    build_decision,
    count_state_tokens,
    result_usage,
    unwrap_answers,
    urgency_band,
)


def inner_answers(intent="urgent_request", level=4, levels=5, release=0.9, stress=0.95, conf=0.88):
    """The inner answers map, as `system_one` puts it under the envelope's "answers" key."""
    return {
        "intent": {
            "type": "choice",
            "choice": intent,
            "probabilities": {intent: 0.7, "other": 0.3},
            "confidence": 0.5,
            "answer_confidence": conf,
        },
        "urgency": {
            "type": "score",
            "score": float(level),
            "legend": {str(i): text for i, text in enumerate(URGENCY_BANDS[:levels])},
            "probabilities": {str(i): (1.0 if i == level else 0.0) for i in range(levels)},
        },
        "is_release_time": {"type": "noul", "noul": release, "confidence": 0.9},
        "mentions_crop_stress": {"type": "noul", "noul": stress, "confidence": 0.9},
    }


def envelope(answers=None, **kwargs):
    """Exactly what `agent.system_one` returns: laya/agent.py line 1697."""
    return {
        "model": "laya-rl-agent",
        "answers": inner_answers(**kwargs) if answers is None else answers,
        "usage": {"input_tokens": 42, "output_tokens": 7, "truncated": False},
    }


def decide(answers=None, *, intent="urgent_request", level=4, levels=5, release=0.9,
           stress=0.95, conf=0.88, **kwargs):
    """`decide(level=0)` shapes the model's answer; other keywords go to `build_decision`."""
    kwargs.setdefault("latency_ms", 42)
    kwargs.setdefault("model", "convaiinnovations/laya-multilingual")
    kwargs.setdefault("device", "cuda")
    if answers is None:
        answers = inner_answers(intent=intent, level=level, levels=levels, release=release,
                                stress=stress, conf=conf)
    return build_decision(answers, **kwargs)


class TestEnvelope(unittest.TestCase):
    """The 502 regression: build_decision must receive the inner map, not the envelope."""

    def test_unwrap_answers_pulls_the_inner_map(self):
        env = envelope()
        self.assertIs(unwrap_answers(env), env["answers"])

    def test_unwrap_answers_accepts_a_bare_map(self):
        bare = inner_answers()
        self.assertIs(unwrap_answers(bare), bare)

    def test_unwrap_answers_rejects_a_non_mapping(self):
        with self.assertRaises(DecisionMappingError):
            unwrap_answers(["not", "an", "envelope"])

    def test_unwrap_answers_rejects_a_non_object_answers_field(self):
        with self.assertRaises(DecisionMappingError):
            unwrap_answers({"model": "m", "answers": ["nope"], "usage": {}})

    def test_passing_the_raw_envelope_to_build_decision_would_fail(self):
        # This is what the bug looked like: the envelope has no "intent" key, so the
        # required-question check missed and /decide answered 502 for every request.
        with self.assertRaises(DecisionMappingError):
            build_decision(envelope(), latency_ms=1, model="m", device="cpu")

    def test_result_usage_reads_the_envelope(self):
        self.assertEqual(result_usage(envelope())["input_tokens"], 42)
        self.assertEqual(result_usage({"answers": {}}), {})

    def test_full_path_envelope_to_decision(self):
        env = envelope()
        decision = build_decision(
            unwrap_answers(env),
            latency_ms=42,
            model="m",
            device="cuda",
            usage=result_usage(env),
            state_tokens=17,
        )
        self.assertEqual(decision["intent"], "urgent_request")
        self.assertEqual(decision["state_tokens"], 17)
        self.assertIs(decision["truncated"], False)


class TestContract(unittest.TestCase):
    def test_contract_labels_match_the_contract_file(self):
        # packages/contracts/src/agents.ts line 33.
        self.assertEqual(
            INTENTS,
            (
                "urgent_request",
                "buffer_request",
                "not_needed_this_week",
                "harvested",
                "schedule_question",
                "acknowledge",
                "other",
            ),
        )

    def test_frozen_worker_question_ids_are_exactly_the_four(self):
        self.assertEqual(
            set(WORKER_QUESTION_IDS),
            {"intent", "urgency", "mentions_crop_stress", "is_release_time"},
        )

    def test_default_questions_carry_all_four_frozen_ids(self):
        for qid in WORKER_QUESTION_IDS:
            self.assertIn(qid, JADAL_QUESTIONS)
        self.assertEqual(JADAL_QUESTIONS["intent"]["type"], "choice")
        self.assertEqual(JADAL_QUESTIONS["urgency"]["type"], "score")
        self.assertEqual(JADAL_QUESTIONS["is_release_time"]["type"], "noul")
        self.assertEqual(JADAL_QUESTIONS["mentions_crop_stress"]["type"], "noul")
        self.assertEqual(len(JADAL_QUESTIONS["urgency"]["criteria"]), len(URGENCY_BANDS))

    def test_required_ids_are_a_subset_of_the_frozen_four(self):
        from jadal_decision import REQUIRED_QUESTION_IDS

        self.assertTrue(set(REQUIRED_QUESTION_IDS) <= set(WORKER_QUESTION_IDS))


class TestDecision(unittest.TestCase):
    def test_intent_and_stress_are_trusted(self):
        d = decide()
        self.assertEqual(d["intent"], "urgent_request")
        self.assertIs(d["mentions_crop_stress"], True)
        self.assertEqual(d["source"], "laya")
        self.assertEqual(d["latency_ms"], 42)
        self.assertEqual(d["intent_confidence"], 0.88)
        self.assertIn("intent", d["trusted_fields"])
        self.assertIn("mentions_crop_stress", d["trusted_fields"])

    def test_untrusted_fields_are_null_by_default(self):
        d = decide()
        self.assertIsNone(d["urgency"])
        self.assertIsNone(d["is_release_time"])
        self.assertEqual(set(d["untrusted_fields"]), {"urgency", "is_release_time"})
        self.assertEqual(len(d["warnings"]), 2)
        self.assertEqual(FIELD_TRUST["urgency"]["trusted"], False)
        self.assertEqual(FIELD_TRUST["is_release_time"]["trusted"], False)

    def test_untrusted_fields_are_preserved_under_unvalidated(self):
        d = decide()
        self.assertEqual(d["unvalidated"]["urgency"], 1.0)  # level 4 of 5
        self.assertEqual(d["unvalidated"]["urgency_band"], "needs_water_immediately")
        self.assertIs(d["unvalidated"]["is_release_time"], True)
        self.assertEqual(d["unvalidated"]["is_release_time_probability"], 0.9)
        self.assertIs(d["unvalidated"]["trusted"], False)

    def test_opt_in_emits_the_unvalidated_values(self):
        d = decide(trust_unvalidated=True)
        self.assertEqual(d["urgency"], 1.0)
        self.assertIs(d["is_release_time"], True)
        self.assertEqual(d["untrusted_fields"], [])
        self.assertEqual(d["urgency_band"], "needs_water_immediately")

    def test_score_maps_onto_zero_to_one(self):
        d0 = decide(level=0, trust_unvalidated=True)
        self.assertEqual(d0["urgency"], 0.0)
        self.assertEqual(d0["urgency_band"], "thanks_or_no_water_needed")
        d2 = decide(level=2, trust_unvalidated=True)
        self.assertEqual(d2["urgency"], 0.5)
        self.assertEqual(d2["urgency_band"], "visible_wilting_or_cracking_soil")

    def test_noul_threshold_is_half(self):
        low = decide(release=0.49, trust_unvalidated=True)
        high = decide(release=0.5, trust_unvalidated=True)
        self.assertIs(low["is_release_time"], False)
        self.assertIs(high["is_release_time"], True)

    def test_intent_outside_the_contract_is_refused(self):
        with self.assertRaises(DecisionMappingError):
            decide(intent="refund")

    def test_missing_intent_is_refused(self):
        partial = inner_answers()
        del partial["intent"]
        with self.assertRaises(DecisionMappingError):
            decide(partial)

    def test_missing_unvalidated_question_degrades_instead_of_failing(self):
        partial = inner_answers()
        del partial["urgency"]
        del partial["is_release_time"]
        d = decide(partial)
        self.assertEqual(d["intent"], "urgent_request")  # the good field survives
        self.assertIsNone(d["urgency"])
        self.assertIsNone(d["is_release_time"])
        self.assertIsNone(d["unvalidated"]["urgency"])

    def test_malformed_noul_degrades_instead_of_failing(self):
        partial = inner_answers()
        partial["is_release_time"] = {"type": "noul", "noul": "yes"}
        d = decide(partial)
        self.assertIsNone(d["is_release_time"])
        self.assertIsNone(d["unvalidated"]["is_release_time_probability"])

    def test_missing_stress_question_is_tolerated_but_not_invented(self):
        partial = inner_answers()
        del partial["mentions_crop_stress"]
        d = decide(partial)
        self.assertIsNone(d["mentions_crop_stress"])

    def test_band_boundaries(self):
        self.assertEqual(urgency_band(0.15), "thanks_or_no_water_needed")
        self.assertEqual(urgency_band(0.16), "routine_question_or_plain_ask")
        self.assertEqual(urgency_band(0.36), "visible_wilting_or_cracking_soil")
        self.assertEqual(urgency_band(0.61), "crop_dying_without_water_today")
        self.assertEqual(urgency_band(0.86), "needs_water_immediately")
        self.assertEqual(urgency_band(1.0), "needs_water_immediately")


class FakeTokenizer:
    """Counts whitespace-separated pieces; enough to exercise the length gate."""

    def __call__(self, text, add_special_tokens=False):
        return {"input_ids": text.split()}


class TestInputLength(unittest.TestCase):
    def test_count_state_tokens_counts_the_serialized_state(self):
        n = count_state_tokens(FakeTokenizer(), "నా వరి పంట ఎండిపోతుంది")
        self.assertGreater(n, 1)

    def test_short_input_passes(self):
        assert_input_length(MAX_STATE_TOKENS)

    def test_long_input_is_refused(self):
        with self.assertRaises(InputTooLongError):
            assert_input_length(MAX_STATE_TOKENS + 1)

    def test_refusal_names_the_window(self):
        with self.assertRaises(InputTooLongError) as ctx:
            assert_input_length(5000)
        self.assertIn(str(MAX_STATE_TOKENS), str(ctx.exception))


if __name__ == "__main__":
    unittest.main(verbosity=2)
