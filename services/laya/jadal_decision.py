"""The Jadal decision shape that Laya is asked to produce, and the mapping back onto it.

This module is the contract bridge between the local Laya service and
``apps/api/src/system1.ts`` / ``packages/contracts/src/agents.ts``. It is deliberately pure
Python with no torch import, so it can be unit-tested without loading a model.

What it mirrors, and from where:

* ``INTENTS`` is ``System1Intent`` from ``packages/contracts/src/agents.ts`` line 33, in the same
  order. That enum is the published contract and wins over any prose list elsewhere.
* ``URGENCY_BANDS`` is the five-band rubric in the ``JEV_SYSTEM_PROMPT`` of
  ``apps/api/src/system1.ts`` lines 86-88, verbatim in meaning. ``urgency`` is a 0..1 ``score``,
  never a boolean.
* ``is_release_time`` is the ``noul`` question named in ``docs/decisions/ADR-001-004-stack.md``
  line 47 ("is this a release-time question"). ``mentions_crop_stress`` is the ``noul`` question
  in the same file's schema line 72. Both are calibrated P(true) in 0..1 and become booleans at
  >= 0.5, which is exactly how ``system1.ts`` line 281 reads ``mentions_crop_stress``.

Laya's own answer shapes (``laya/agent.py`` ``_decode_answers``):

* ``choice`` -> ``{"type","choice": <label>, "probabilities": {label: p}, "confidence", ...}``
* ``score``  -> ``{"type","score": <expected level index>, "legend": {idx: text},
  "probabilities": {idx: p}, ...}`` -- ``score`` is a 0-based level index, not 0..1, so
  ``score / (levels - 1)`` is what lands on Jadal's scale.
* ``noul``   -> ``{"type","noul": P(true), "confidence", ...}``

``agent.system_one(state, questions)`` returns the *envelope*
``{"model", "answers", "usage"}`` (``laya/agent.py`` line 1697), not the inner answers map.
:func:`unwrap_answers` is the single place that unwraps it; passing the envelope straight to
:func:`build_decision` was a real bug (every ``/decide`` answered 502).

WHICH FIELDS ARE TRUSTWORTHY -- read before using this service
-------------------------------------------------------------
``docs/research/laya-verdict.md`` (independent evaluation lane, PR #28) measured this exact
checkpoint on short Telugu inputs:

* ``intent`` (choice) -- **reliable**: 4/4 on short Telugu.
* ``mentions_crop_stress`` (noul) -- **reliable at small n**: 5/5 on short Telugu.
* ``urgency`` (score) -- **NOT trustworthy**: never left band 2 even for "the crop will die
  today".
* ``is_release_time`` (noul) -- **NOT trustworthy**: false-positived 0.814 on a Telugu urgent
  sentence and 0.778 on an English control.

So this service emits ``intent`` (and ``mentions_crop_stress``) as the decision, and returns
``urgency`` / ``is_release_time`` as **null** by default, with the raw model output preserved
under ``unvalidated`` and a machine-readable ``field_trust`` table. ``null`` is the agreed
"not reported" signal, which is how the Worker falls back to its Telugu rules for those two
fields instead of consuming a value the evaluation showed is wrong. Set
``trust_unvalidated=True`` (env ``LAYA_TRUST_UNVALIDATED_FIELDS=1``) only when a *different*,
validated checkpoint is configured.
"""

from __future__ import annotations

import json
from typing import Any, Mapping, Sequence

# --- mirrors packages/contracts/src/agents.ts `System1Intent` (order included) ---------------
INTENTS: tuple[str, ...] = (
    "urgent_request",
    "buffer_request",
    "not_needed_this_week",
    "harvested",
    "schedule_question",
    "acknowledge",
    "other",
)

# --- mirrors the JEV urgency rubric in apps/api/src/system1.ts ---------------------------------
URGENCY_BANDS: tuple[str, ...] = (
    "0.00-0.15 thanks or no water needed",
    "0.16-0.35 routine question or a plain ask",
    "0.36-0.60 visible wilting or cracking soil",
    "0.61-0.85 crop dying without water today",
    "0.86-1.00 crop dead or dying and the farmer says they need water immediately",
)

BAND_NAMES: tuple[str, ...] = (
    "thanks_or_no_water_needed",
    "routine_question_or_plain_ask",
    "visible_wilting_or_cracking_soil",
    "crop_dying_without_water_today",
    "needs_water_immediately",
)

INTENT_QUESTION_ID = "intent"
URGENCY_QUESTION_ID = "urgency"
RELEASE_TIME_QUESTION_ID = "is_release_time"
STRESS_QUESTION_ID = "mentions_crop_stress"

#: The question ids this service needs in order to emit a Jadal decision. Only ``intent`` is
#: load-bearing: it is the field the evaluation found reliable. The other three are evaluated
#: and reported, but a missing or malformed one degrades to ``null`` rather than failing the
#: request, because killing a good intent because an unvalidated score was malformed would be
#: the wrong trade.
REQUIRED_QUESTION_IDS: tuple[str, ...] = (INTENT_QUESTION_ID,)

#: The four question ids the Worker sends (frozen by the System-1 provider lane). Accepted and
#: never renamed; this service requires none of them beyond ``intent``.
WORKER_QUESTION_IDS: tuple[str, ...] = (
    INTENT_QUESTION_ID,
    URGENCY_QUESTION_ID,
    STRESS_QUESTION_ID,
    RELEASE_TIME_QUESTION_ID,
)

#: Validated input window. The evaluation lane's verdict: Laya is reliable on SHORT inputs and
#: the state window is 978 tokens at the shipped ``max_len=1024`` (the real head is 45 tokens);
#: above 888 state tokens the tail -- which is where the actual ask sits -- is truncated away.
#: We enforce a stricter 512 and never pad.
MAX_STATE_TOKENS = 512
HARD_STATE_TOKEN_CEILING = 888

#: Per-field trust, as measured by the independent evaluation. Reported verbatim in every
#: response so a caller never has to guess which numbers it may act on.
FIELD_TRUST: dict[str, dict[str, Any]] = {
    INTENT_QUESTION_ID: {
        "trusted": True,
        "basis": "4/4 on short Telugu urgent/other sentences (docs/research/laya-verdict.md)",
    },
    STRESS_QUESTION_ID: {
        "trusted": True,
        "basis": "5/5 on short Telugu crop-stress sentences (small n; docs/research/laya-verdict.md)",
    },
    URGENCY_QUESTION_ID: {
        "trusted": False,
        "basis": (
            "never left band 2 even for 'the crop will die today'; emitted as null by default"
        ),
    },
    RELEASE_TIME_QUESTION_ID: {
        "trusted": False,
        "basis": (
            "noul false-positived 0.814 on a Telugu urgent sentence and 0.778 on an English "
            "control; emitted as null by default"
        ),
    },
}

#: The default question set. The state is passed as ``{"text": ...}`` so the backticked field
#: reference resolves the way Laya's own presets do (``laya/presets.py``).
JADAL_QUESTIONS: dict[str, dict[str, Any]] = {
    INTENT_QUESTION_ID: {
        "type": "choice",
        "instructions": "What does the farmer want in `text`?",
        "criteria": {
            "urgent_request": "the crop is wilting, drying or dying and the farmer needs water now",
            "buffer_request": "asks for extra water beyond the quota, or to draw on the common buffer",
            "not_needed_this_week": "says water is not needed this week, or declines the turn",
            "harvested": "the crop has been harvested or cut, so the turn is no longer wanted",
            "schedule_question": "asks when their turn is, or when the water will be released",
            "acknowledge": "confirms, agrees, acknowledges the plan or says thanks",
            "other": "none of the other options fits",
        },
    },
    URGENCY_QUESTION_ID: {
        "type": "score",
        "instructions": "How urgent is the farmer's water need in `text`?",
        "criteria": list(URGENCY_BANDS),
    },
    STRESS_QUESTION_ID: {
        "type": "noul",
        "instructions": (
            "Does `text` describe the crop suffering - dry, wilting, dying, or no water in the channel?"
        ),
        "criteria": {
            "false": "no crop suffering is described",
            "true": "the crop is described as dry, wilting, dying, or the channel has no water",
        },
    },
    RELEASE_TIME_QUESTION_ID: {
        "type": "noul",
        "instructions": (
            "Is `text` asking about the timing of a canal release - when the water will be "
            "released, or when the farmer's turn starts?"
        ),
        "criteria": {
            "false": "no question about release timing",
            "true": "asks when the water will be released or when their turn starts",
        },
    },
}


class DecisionMappingError(ValueError):
    """Laya answered, but the answer cannot be expressed as a Jadal decision."""


class InputTooLongError(ValueError):
    """The state exceeds the validated token window, so the ask could be truncated away."""


def clamp01(value: float) -> float:
    if value != value:  # NaN
        return 0.0
    return min(1.0, max(0.0, float(value)))


def urgency_band(urgency: float) -> str:
    """The band name for a 0..1 urgency, using the same cut points as the JEV rubric."""
    u = clamp01(urgency)
    if u <= 0.15:
        return BAND_NAMES[0]
    if u <= 0.35:
        return BAND_NAMES[1]
    if u <= 0.60:
        return BAND_NAMES[2]
    if u <= 0.85:
        return BAND_NAMES[3]
    return BAND_NAMES[4]


# --------------------------------------------------------------------------- envelope handling

def unwrap_answers(result: Any) -> Mapping[str, Any]:
    """Pull the per-question answers out of ``system_one``/``predict``'s envelope.

    ``agent.system_one`` returns ``{"model", "answers", "usage"}`` (``laya/agent.py`` line
    1697). Passing that envelope to :func:`build_decision` made every required-question lookup
    miss and every ``/decide`` answer 502, so unwrapping lives in one tested place. A bare
    answers map is accepted too, for callers using ``predict_batch`` elements directly.
    """
    if not isinstance(result, Mapping):
        raise DecisionMappingError(
            "model returned %s, expected the result envelope object" % type(result).__name__
        )
    inner = result.get("answers")
    if isinstance(inner, Mapping):
        return inner
    if "answers" in result:
        raise DecisionMappingError(
            "result envelope has a non-object 'answers' field (%s)" % type(inner).__name__
        )
    return result


def result_usage(result: Any) -> Mapping[str, Any]:
    """The envelope's ``usage`` block, or an empty map when there is none."""
    if isinstance(result, Mapping):
        usage = result.get("usage")
        if isinstance(usage, Mapping):
            return usage
    return {}


def serialize_state(text: str) -> str:
    """Exactly what Laya tokenizes for a ``{"text": ...}`` state (``common.serialize_state``)."""
    return json.dumps({"text": text}, ensure_ascii=False)


def count_state_tokens(tokenizer: Any, text: str) -> int:
    """Token count of the state as Laya will see it, without special tokens.

    ``tokenizer`` is Laya's ``agent.tok``. The service calls this before inference so an
    over-long input is refused rather than silently truncated -- the evaluation showed
    truncation drops the tail of the message, which is where the ask is.
    """
    encoded = tokenizer(serialize_state(text), add_special_tokens=False)
    ids = encoded["input_ids"]
    return len(ids)


# --------------------------------------------------------------------------- answer readers

def _answer(answers: Mapping[str, Any], qid: str) -> Mapping[str, Any] | None:
    value = answers.get(qid)
    return value if isinstance(value, Mapping) else None


def _read_noul(answers: Mapping[str, Any], qid: str) -> float | None:
    value = _answer(answers, qid)
    if value is None:
        return None
    raw = value.get("noul")
    if not isinstance(raw, (int, float)):
        return None
    return clamp01(raw)


def _read_choice(answers: Mapping[str, Any], qid: str) -> tuple[str, dict[str, float]]:
    value = _answer(answers, qid)
    if value is None:
        raise DecisionMappingError("question %r was not answered by the model" % qid)
    label = value.get("choice")
    if not isinstance(label, str) or label not in INTENTS:
        raise DecisionMappingError(
            "question %r returned %r, which is not one of the System1Intent labels %s"
            % (qid, label, list(INTENTS))
        )
    probs = value.get("probabilities")
    probabilities = (
        {str(k): float(v) for k, v in probs.items()} if isinstance(probs, Mapping) else {}
    )
    return label, probabilities


def _read_score(answers: Mapping[str, Any], qid: str) -> tuple[float, list[float]] | None:
    """Laya's expected level index -> (0..1 score, per-level mass), or None if unusable."""
    value = _answer(answers, qid)
    if value is None:
        return None
    raw = value.get("score")
    if not isinstance(raw, (int, float)):
        return None

    legend = value.get("legend")
    levels = len(legend) if isinstance(legend, Mapping) else 0
    if levels == 0:
        probs = value.get("probabilities")
        levels = len(probs) if isinstance(probs, Mapping) else 0
    if levels == 0:
        return None

    unit = clamp01(float(raw) / (levels - 1)) if levels > 1 else 0.0

    probs = value.get("probabilities")
    mass: list[float] = []
    if isinstance(probs, Mapping):
        for i in range(levels):
            mass.append(float(probs.get(str(i), probs.get(i, 0.0)) or 0.0))
    return unit, mass


# --------------------------------------------------------------------------- the decision

def build_decision(
    answers: Mapping[str, Any],
    *,
    latency_ms: int,
    model: str,
    device: str,
    trust_unvalidated: bool = False,
    usage: Mapping[str, Any] | None = None,
    state_tokens: int | None = None,
) -> dict[str, Any]:
    """Map raw Laya answers onto the Jadal response body.

    ``intent`` is required and raises :class:`DecisionMappingError` when it is absent or outside
    the contract: a decision the model did not make is worse than no decision, because the
    Worker cannot tell the difference. ``urgency`` and ``is_release_time`` are **not** put in
    the decision path by default -- see the module docstring -- and degrade to ``null``.
    """
    if INTENT_QUESTION_ID not in answers:
        raise DecisionMappingError(
            "model did not answer required question %r" % INTENT_QUESTION_ID
        )

    intent, intent_probabilities = _read_choice(answers, INTENT_QUESTION_ID)
    intent_answer = _answer(answers, INTENT_QUESTION_ID) or {}
    confidence = intent_answer.get("answer_confidence", intent_answer.get("confidence"))

    urgency_unit: float | None = None
    urgency_mass: list[float] = []
    scored = _read_score(answers, URGENCY_QUESTION_ID)
    if scored is not None:
        urgency_unit, urgency_mass = scored

    release_time_p = _read_noul(answers, RELEASE_TIME_QUESTION_ID)
    stress_p = _read_noul(answers, STRESS_QUESTION_ID)

    warnings: list[str] = []
    untrusted: list[str] = []

    if not trust_unvalidated:
        for qid in (URGENCY_QUESTION_ID, RELEASE_TIME_QUESTION_ID):
            untrusted.append(qid)
            warnings.append(
                "%s: not validated on this checkpoint (%s) - returned as null so the caller "
                "falls back to rules" % (qid, FIELD_TRUST[qid]["basis"])
            )

    emit_urgency = trust_unvalidated and urgency_unit is not None
    emit_release_time = trust_unvalidated and release_time_p is not None

    decision: dict[str, Any] = {
        # --- the five keys the brief fixes ---
        "intent": intent,
        "urgency": round(urgency_unit, 4) if emit_urgency else None,
        "is_release_time": (release_time_p >= 0.5) if emit_release_time else None,
        "source": "laya",
        "latency_ms": int(latency_ms),
        # --- supporting fields the Worker's System1Result also carries ---
        "model": model,
        "device": device,
        "intent_confidence": round(clamp01(confidence), 4) if isinstance(confidence, (int, float)) else None,
        "mentions_crop_stress": None if stress_p is None else stress_p >= 0.5,
        "mentions_crop_stress_probability": None if stress_p is None else round(stress_p, 4),
        "urgency_band": urgency_band(urgency_unit) if emit_urgency else None,
        "urgency_band_probabilities": (
            {name: round(p, 4) for name, p in zip(BAND_NAMES, urgency_mass)}
            if emit_urgency
            else None
        ),
        "intent_probabilities": {k: round(v, 4) for k, v in intent_probabilities.items()},
        # --- what the model said for the fields we refuse to put in the decision path ---
        "unvalidated": {
            URGENCY_QUESTION_ID: None if urgency_unit is None else round(urgency_unit, 4),
            "urgency_band": None if urgency_unit is None else urgency_band(urgency_unit),
            RELEASE_TIME_QUESTION_ID: None if release_time_p is None else release_time_p >= 0.5,
            "is_release_time_probability": (
                None if release_time_p is None else round(release_time_p, 4)
            ),
            "trusted": trust_unvalidated,
        },
        # --- trust metadata, so a caller never has to guess ---
        "field_trust": FIELD_TRUST,
        "trusted_fields": [q for q, t in FIELD_TRUST.items() if t["trusted"]],
        "untrusted_fields": untrusted,
        "warnings": warnings,
        # --- input accounting (the evaluation's length cliff) ---
        "state_tokens": state_tokens,
        "max_state_tokens": MAX_STATE_TOKENS,
        "truncated": bool(usage.get("truncated")) if isinstance(usage, Mapping) else None,
        # --- the untouched per-question model output, for auditability ---
        "answers": dict(answers),
    }
    return decision


def assert_input_length(state_tokens: int) -> None:
    """Refuse an input outside the validated window. Never truncate silently."""
    if state_tokens > MAX_STATE_TOKENS:
        raise InputTooLongError(
            "state is %d tokens, above the validated %d-token window (the checkpoint's hard "
            "ceiling is %d; beyond it the tail of the message - the actual ask - is truncated "
            "away). Shorten the message or fall back to rules."
            % (state_tokens, MAX_STATE_TOKENS, HARD_STATE_TOKEN_CEILING)
        )
