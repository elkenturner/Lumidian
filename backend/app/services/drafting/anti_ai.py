"""Anti-AI writing enforcement — scan generated text for LLM "tells" and gate it.

Grounded in research compiled 2026-06 under docs/strategy/research/antiai-*.md
and the standard at docs/strategy/anti-ai-writing-standard.md.

Design principles (from the research, do not "improve" away):
  1. NO single common word proves AI authorship. Density + co-occurrence are the
     real signal. We hard-fire only on smoking-gun terms / high-precision
     constructions / assistant-voice leaks; everything else contributes to a
     density score that must clear a threshold.
  2. DO NOT replicate AI-detector ESL bias: never penalize short sentences or
     simple vocabulary *in isolation*. We flag rhythm UNIFORMITY (low variance),
     not shortness; and lexical tells, not simplicity.
  3. The durable bar is "reads human to an editor", approximated by burstiness
     (sentence-length variance) + absence of phrase/lexicon tells.

Public API:
  scan(text)                  -> AntiAIReport
  passes(text)                -> bool
  feedback_for_regeneration(report) -> str   # instruction to feed back to the writer LLM
  autofix(text)               -> str         # safe, meaning-preserving cosmetic fixes
"""
from __future__ import annotations

import re
import statistics
from dataclasses import dataclass, field

# ── Tunables ────────────────────────────────────────────────────────────────
DEFAULT_THRESHOLD = 12.0   # breadth-weighted points per 1000 words; above => fail
_RHYTHM_MIN_WORDS = 120     # below this, rhythm stats are unreliable (don't flag)
_TIER_WEIGHT = {"S1": 3.0, "S2": 2.0, "S3": 1.0}
_FP_DISCOUNT = {"LOW": 0.0, "MED": 0.2, "HIGH": 0.5}
_PER_TERM_CAP = 2          # one repeated word contributes at most this many hits

# ── Category 7: assistant-voice leaks — ALWAYS hard-fail ─────────────────────
_ASSISTANT_LEAKS = [
    "as an ai", "as a large language model", "as an ai language model",
    "my training data", "knowledge cutoff", "as of my last knowledge update",
    "i hope this helps", "i'd be happy to help", "i am unable to", "i cannot browse",
    "i don't have personal", "great question", "that's a fantastic point",
    "as a language model",
]
_ASSISTANT_RE = re.compile(
    "|".join(re.escape(p) for p in _ASSISTANT_LEAKS), re.IGNORECASE
)
# Paragraph-initial chat sign-ons ("Certainly!", "Absolutely!")
_CHAT_OPENER_RE = re.compile(r"(?:^|\n)\s*(?:certainly|absolutely|sure)!", re.IGNORECASE)

# ── High-precision constructions — each match is a heavy hit ─────────────────
# (label, compiled regex, human-readable suggestion)
_CONSTRUCTIONS: list[tuple[str, re.Pattern, str]] = [
    ("antithesis 'it's not X, it's Y'",
     re.compile(r"\b(?:isn't|aren't|wasn't|weren't|is not|are not|was not|were not|not)\s+(?:just|merely|only|simply|about)\b.{1,60}?[—–,.;]\s*(?:it|this|that|they|which)(?:'s|\s+is|\s+was|\s+are)\b", re.IGNORECASE),
     "Drop the 'not just X, it's Y' antithesis; state the point plainly."),
    ("'not only X but also Y'",
     re.compile(r"\bnot only\b.{1,80}?\bbut(?:\s+also)?\b", re.IGNORECASE),
     "Rewrite without 'not only … but also'."),
    ("trailing '-ing' significance clause",
     re.compile(r",\s+(?:highlighting|emphasizing|underscoring|reflecting|showcasing|demonstrating|illustrating|contributing to|reinforcing|signaling|cementing|solidifying)\b", re.IGNORECASE),
     "Cut the trailing ', highlighting/underscoring…' editorializing clause."),
    ("'plays a crucial role'",
     re.compile(r"\bplays?\s+an?\s+(?:crucial|vital|pivotal|key|critical|significant|central|major|important)\s+role\b", re.IGNORECASE),
     "Replace 'plays a crucial role' with the concrete thing it does."),
    ("'stands/serves as a testament'",
     re.compile(r"\b(?:stands?|serves?)\s+as\s+an?\s+(?:testament|reminder|symbol|beacon|cornerstone|hallmark)\b", re.IGNORECASE),
     "Remove the 'serves as a testament to' filler."),
    ("'whether you're X or Y'",
     re.compile(r"\bwhether\s+you(?:'re|\s+are)\b.{1,40}?\bor\b", re.IGNORECASE),
     "Drop the 'whether you're X or Y' catch-all opener."),
    ("'in today's … world/landscape'",
     re.compile(r"\bin\s+today's\s+(?:[\w-]+\s+){0,3}(?:world|landscape|environment|market|economy|age|era)\b", re.IGNORECASE),
     "Cut 'in today's fast-paced world'-type openers."),
    ("'in the realm/world/landscape of'",
     re.compile(r"\bin\s+(?:the|today's)\s+(?:world|realm|landscape|age|era|sphere|domain|space)\s+of\b", re.IGNORECASE),
     "Replace 'in the realm of X' with plain reference to X."),
    ("'let's dive in/unpack/explore'",
     re.compile(r"\blet(?:'s|\s+us)\s+(?:dive\s+in(?:to)?|unpack|explore|delve\s+into|break\s+(?:this|it)\s+down|take\s+a\s+(?:closer\s+)?look)\b", re.IGNORECASE),
     "Remove the 'let's dive in' essay-narration."),
    ("'here's the thing/kicker'",
     re.compile(r"\bhere(?:'s|\s+is)\s+the\s+(?:thing|kicker|deal|catch|truth|secret|problem)\b", re.IGNORECASE),
     "Cut the 'here's the thing' framing."),
    ("signposted conclusion",
     re.compile(r"(?:^|[.!?]\s+)(?:in conclusion|to sum up|in summary|to summarize|all in all|at the end of the day|when all is said and done)\b", re.IGNORECASE),
     "Delete the 'In conclusion / at the end of the day' wrap-up."),
    ("'despite … challenges' pivot",
     re.compile(r"\bdespite\s+(?:its|these|the|several|numerous|various|ongoing)\s+(?:challenges|obstacles|setbacks|limitations|complexities|difficulties)\b", re.IGNORECASE),
     "Avoid the 'despite its challenges' optimistic pivot."),
    ("em-dash reframe '— and that's a good thing'",
     re.compile(r"[—–]\s*and that(?:'s|\s+is)\s+(?:a good thing|exactly|precisely|the point|the whole point|okay|fine)\b", re.IGNORECASE),
     "Remove the '— and that's a good thing' reframe."),
    ("patronizing analogy 'think of it as'",
     re.compile(r"\b(?:think of (?:it|this) (?:as|like)|it's like (?:a|an)|imagine (?:it|this) as)\b", re.IGNORECASE),
     "Drop the 'think of it as a …' analogy."),
    ("stakes inflation",
     re.compile(r"\b(?:fundamentally\s+(?:reshape|transform|change)|paradigm\s+shift|game[\s-]chang(?:er|ing)|revolutioniz(?:e|ing|es)|usher(?:ing)?\s+in\s+a\s+new\s+(?:era|age)|at the forefront of)\b", re.IGNORECASE),
     "Replace grandiose 'paradigm shift / game-changer' with a concrete claim."),
    ("vague attribution",
     re.compile(r"(?:^|[.!?]\s+)(?:experts?\s+(?:argue|say|agree|suggest|believe)|studies have shown|research (?:shows|suggests|indicates)|many (?:believe|argue|say)|it is (?:widely )?(?:believed|known) that)\b", re.IGNORECASE),
     "Name the source instead of 'experts argue / studies have shown'."),
    ("hedge preamble 'it's worth noting'",
     re.compile(r"\bit(?:'s|\s+is)\s+(?:worth\s+(?:noting|mentioning|remembering)|important\s+to\s+(?:note|remember|understand))\b", re.IGNORECASE),
     "Cut 'it's worth noting / important to note' and just say it."),
]

# ── Lexicon: term -> (tier, fp_risk). Multi-word entries matched as phrases. ──
# Curated from docs/strategy/research/antiai-lexical-tells.md (221-term master).
_LEXICON: dict[str, tuple[str, str]] = {
    # Cat 1 verbs (smoking guns + strong)
    "delve": ("S1", "LOW"), "delves": ("S1", "LOW"), "delved": ("S1", "LOW"), "delving": ("S1", "LOW"),
    "underscore": ("S1", "MED"), "underscores": ("S1", "MED"), "underscoring": ("S1", "MED"),
    "showcasing": ("S1", "LOW"), "showcases": ("S1", "LOW"),
    "boasts": ("S1", "MED"), "garnered": ("S1", "MED"), "surpassing": ("S1", "MED"), "surpasses": ("S1", "MED"),
    "leverage": ("S1", "MED"), "harness": ("S2", "MED"), "foster": ("S2", "MED"), "utilize": ("S2", "MED"),
    "facilitate": ("S2", "MED"), "streamline": ("S2", "MED"), "embark": ("S1", "LOW"), "elevate": ("S2", "LOW"),
    "unlock": ("S2", "MED"), "empower": ("S2", "MED"), "spearhead": ("S2", "LOW"), "cultivate": ("S2", "MED"),
    "bolster": ("S2", "MED"), "elucidate": ("S2", "LOW"), "ascertain": ("S2", "LOW"), "commence": ("S2", "MED"),
    "endeavor": ("S2", "LOW"), "curate": ("S2", "MED"), "comprehending": ("S1", "LOW"),
    # Cat 2 adjectives/adverbs
    "intricate": ("S1", "MED"), "intricacies": ("S1", "LOW"), "meticulous": ("S1", "LOW"), "meticulously": ("S1", "LOW"),
    "pivotal": ("S1", "MED"), "groundbreaking": ("S1", "MED"), "multifaceted": ("S2", "LOW"),
    "seamless": ("S2", "MED"), "nuanced": ("S2", "MED"), "holistic": ("S2", "MED"), "transformative": ("S2", "MED"),
    "invaluable": ("S2", "MED"), "paramount": ("S2", "LOW"), "commendable": ("S2", "LOW"), "indelible": ("S2", "LOW"),
    "vibrant": ("S2", "MED"), "bustling": ("S2", "LOW"), "unprecedented": ("S2", "MED"), "quintessential": ("S2", "LOW"),
    "overarching": ("S2", "MED"), "indispensable": ("S2", "LOW"),
    # FP-HIGH adjectives — only count in clusters (low standalone weight)
    "crucial": ("S2", "HIGH"), "robust": ("S2", "HIGH"), "comprehensive": ("S2", "HIGH"),
    "significant": ("S3", "HIGH"), "innovative": ("S3", "HIGH"), "notable": ("S2", "MED"),
    # Cat 3 nouns/metaphors
    "tapestry": ("S1", "LOW"), "realm": ("S1", "MED"), "testament": ("S1", "LOW"), "myriad": ("S1", "LOW"),
    "plethora": ("S1", "LOW"), "beacon": ("S2", "LOW"), "cornerstone": ("S2", "MED"), "paradigm": ("S2", "LOW"),
    "synergy": ("S2", "LOW"), "trove": ("S2", "LOW"), "advancements": ("S2", "MED"), "ecosystem": ("S2", "MED"),
    "confluence": ("S2", "LOW"), "juxtaposition": ("S2", "LOW"), "interplay": ("S2", "LOW"),
    "underpinnings": ("S2", "LOW"), "landscape": ("S2", "MED"),
    # Cat 4 transition/filler phrases
    "moreover": ("S2", "MED"), "furthermore": ("S2", "MED"), "additionally": ("S2", "MED"),
    "notably": ("S2", "MED"), "consequently": ("S2", "MED"), "in essence": ("S2", "MED"),
    "that being said": ("S2", "MED"), "needless to say": ("S2", "MED"), "it goes without saying": ("S2", "MED"),
    # Cat 6 hype phrases
    "cutting-edge": ("S2", "MED"), "state-of-the-art": ("S2", "MED"), "unparalleled": ("S2", "LOW"),
    "world-class": ("S2", "MED"), "next-level": ("S2", "MED"), "best-in-class": ("S2", "MED"),
    "supercharge": ("S2", "MED"), "game-changer": ("S2", "MED"),
}
# Build one alternation regex per phrase length class for efficient matching.
_LEXICON_RE = re.compile(
    r"\b(?:" + "|".join(re.escape(t) for t in sorted(_LEXICON, key=len, reverse=True)) + r")\b",
    re.IGNORECASE,
)


# ── Data classes ────────────────────────────────────────────────────────────
@dataclass
class Violation:
    category: str          # assistant_leak | construction | lexicon | structure | rhythm
    severity: str          # block | high | medium | low
    detail: str
    match: str | None = None
    suggestion: str | None = None


@dataclass
class AntiAIReport:
    passed: bool
    blocked: bool
    score: float
    threshold: float
    word_count: int
    violations: list[Violation] = field(default_factory=list)
    metrics: dict = field(default_factory=dict)


# ── Helpers ─────────────────────────────────────────────────────────────────
_CURLY = {"‘": "'", "’": "'", "“": '"', "”": '"'}


def _normalize_for_match(text: str) -> str:
    for k, v in _CURLY.items():
        text = text.replace(k, v)
    return text


def _word_count(text: str) -> int:
    return len(re.findall(r"\b[\w']+\b", text))


def _sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    return [p for p in parts if p.strip()]


# ── Scanners ────────────────────────────────────────────────────────────────
def _scan_assistant(text: str, v: list[Violation]) -> bool:
    blocked = False
    for m in _ASSISTANT_RE.finditer(text):
        blocked = True
        v.append(Violation("assistant_leak", "block",
                           "Assistant-voice leak — never ships.", m.group(0),
                           "Remove all assistant/chat phrasing."))
    if _CHAT_OPENER_RE.search(text):
        blocked = True
        v.append(Violation("assistant_leak", "block",
                           "Chat sign-on opener (Certainly!/Absolutely!).", None,
                           "Open with substance, not an acknowledgement."))
    return blocked


def _scan_constructions(text: str, v: list[Violation]) -> float:
    points = 0.0
    for label, rx, suggestion in _CONSTRUCTIONS:
        m = rx.search(text)
        if m:
            points += 4.0
            v.append(Violation("construction", "high", label, m.group(0).strip(), suggestion))
    return points


def _scan_lexicon(text: str, v: list[Violation]) -> tuple[float, bool]:
    counts: dict[str, int] = {}
    for m in _LEXICON_RE.finditer(text):
        term = m.group(0).lower()
        counts[term] = counts.get(term, 0) + 1
    points = 0.0
    s1_present = False
    flagged: list[str] = []
    for term, n in counts.items():
        tier, fp = _LEXICON[term]
        if tier == "S1":
            s1_present = True
        weight = _TIER_WEIGHT[tier] * (1.0 - _FP_DISCOUNT[fp])
        points += weight * min(n, _PER_TERM_CAP)
        flagged.append(f"{term}×{n}" if n > 1 else term)
    if flagged:
        v.append(Violation("lexicon", "medium",
                           f"AI-tell vocabulary ({len(flagged)} term(s)).",
                           ", ".join(sorted(flagged)),
                           "Swap for specific, less-expected word choices."))
    return points, s1_present


def _scan_structure(text: str, v: list[Violation], wc: int) -> tuple[float, dict]:
    points = 0.0
    metrics: dict = {}
    # Em-dash density
    dash = len(re.findall(r"[—–]", text)) + len(re.findall(r"(?<=\w) - (?=\w)", text))
    per1k = dash / wc * 1000 if wc else 0
    metrics["em_dash_per_1k"] = round(per1k, 2)
    if per1k > 2.0:
        points += 3.0
        v.append(Violation("structure", "low",
                           f"Em-dash density {per1k:.1f}/1k (>2).", None,
                           "Cut em-dashes to <2 per 1000 words."))
    # List discipline
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if lines:
        bullets = [ln for ln in lines if re.match(r"\s*(?:[-*•]|\d+[.)])\s+", ln)]
        ratio = len(bullets) / len(lines)
        metrics["bullet_ratio"] = round(ratio, 2)
        if ratio > 0.4:
            points += 3.0
            v.append(Violation("structure", "medium",
                               f"Bulleted-line ratio {ratio:.0%} (>40%).", None,
                               "Convert most bullets to prose."))
        # Bold-label-colon list spam
        bold_label = [ln for ln in bullets if re.match(r"\s*(?:[-*•]|\d+[.)])\s+\*\*[^*]+\*\*\s*:", ln)]
        if bullets and len(bold_label) / len(bullets) > 0.3:
            points += 3.0
            v.append(Violation("structure", "medium",
                               "Bold-label-colon list spam (**Label:** …).", None,
                               "Drop the bolded label-colon list format."))
    return points, metrics


def _scan_rhythm(text: str, v: list[Violation], wc: int) -> tuple[float, dict]:
    if wc < _RHYTHM_MIN_WORDS:
        return 0.0, {}
    sents = _sentences(text)
    lens = [len(re.findall(r"\b[\w']+\b", s)) for s in sents]
    lens = [n for n in lens if n > 0]
    if len(lens) < 4:
        return 0.0, {}
    points = 0.0
    stdev = statistics.pstdev(lens)
    # Uniformity (low variance) is the tell — NOT shortness (avoids ESL bias).
    if stdev < 6.0:
        points += 4.0
        v.append(Violation("rhythm", "high",
                           f"Uniform sentence length (stdev {stdev:.1f} < 6).", None,
                           "Add burstiness: mix a <6-word sentence with a >25-word one."))
    band = sum(1 for n in lens if 18 <= n <= 24) / len(lens)
    if band > 0.5:
        points += 2.0
        v.append(Violation("rhythm", "medium",
                           f"{band:.0%} of sentences in the robotic 18–24-word band.", None,
                           "Break the uniform mid-length cadence."))
    # Canned transition openers
    canned = sum(1 for s in sents if re.match(
        r"(?:moreover|furthermore|additionally|consequently|however|nevertheless|nonetheless|thus|hence)\b,?",
        s.strip(), re.IGNORECASE))
    if sents and canned / len(sents) > 0.2:
        points += 2.0
        v.append(Violation("rhythm", "medium",
                           f"{canned/len(sents):.0%} of sentences open with a canned transition.", None,
                           "Vary sentence openings; cut Moreover/Furthermore/Additionally."))
    return points, {"sentence_len_stdev": round(stdev, 1)}


# ── Public API ──────────────────────────────────────────────────────────────
def scan(text: str, threshold: float = DEFAULT_THRESHOLD) -> AntiAIReport:
    """Scan text for AI tells. Density-normalized, breadth-weighted score."""
    if not text or not text.strip():
        return AntiAIReport(True, False, 0.0, threshold, 0)
    norm = _normalize_for_match(text)
    wc = _word_count(norm)
    violations: list[Violation] = []

    blocked = _scan_assistant(norm, violations)
    construction_points = _scan_constructions(norm, violations)
    lexicon_points, s1_present = _scan_lexicon(norm, violations)
    struct_points, struct_metrics = _scan_structure(norm, violations, wc)
    rhythm_points, rhythm_metrics = _scan_rhythm(norm, violations, wc)
    cat_points = {
        "construction": construction_points,
        "lexicon": lexicon_points,
        "structure": struct_points,
        "rhythm": rhythm_points,
    }
    raw = sum(cat_points.values())
    per_1k = raw / wc * 1000 if wc else 0.0
    # Breadth multiplier: co-occurrence across categories matters more than depth.
    firing = sum(1 for p in cat_points.values() if p > 0)
    breadth_mult = 1.0 + 0.5 * max(0, firing - 1)
    score = round(per_1k * breadth_mult, 2)

    # A "hard signal" is a high-precision tell: a banned construction, a smoking-gun
    # S1 word, or uniform robotic cadence. Without one, FP-prone vocab can only fail
    # text when it co-occurs across >=2 categories (genuine density) — this is what
    # stops a single "robust"/"crucial" from flagging legit human/ESL/technical prose.
    hard_signal = (
        construction_points > 0
        or s1_present
        or any(vi.category == "rhythm" and vi.severity == "high" for vi in violations)
    )
    over = score > threshold
    passed = (not blocked) and not (over and (hard_signal or firing >= 2))

    metrics = {"raw_points": round(raw, 1), "categories_firing": firing,
               "breadth_mult": breadth_mult, "hard_signal": hard_signal,
               **struct_metrics, **rhythm_metrics}
    return AntiAIReport(passed, blocked, score, threshold, wc, violations, metrics)


def passes(text: str, threshold: float = DEFAULT_THRESHOLD) -> bool:
    return scan(text, threshold).passed


def feedback_for_regeneration(report: AntiAIReport) -> str:
    """Build a concrete instruction for the writer LLM to fix the flagged tells."""
    if report.passed:
        return ""
    lines = ["Your draft reads as AI-generated. Rewrite to remove these specific tells "
             "(keep all facts/claims; vary sentence length deliberately):"]
    for vi in report.violations:
        bit = f"- {vi.detail}"
        if vi.match:
            bit += f"  [found: \"{vi.match[:80]}\"]"
        if vi.suggestion:
            bit += f"  → {vi.suggestion}"
        lines.append(bit)
    if report.blocked:
        lines.append("- CRITICAL: remove all assistant/chatbot phrasing entirely.")
    return "\n".join(lines)


def autofix(text: str) -> str:
    """Apply only safe, meaning-preserving cosmetic fixes (cannot change claims).

    - curly quotes -> straight
    - em/en dash used as a connector -> comma
    - strip leading chat sign-ons and trailing assistant sign-offs
    Lexical/structural/rhythm tells are NOT auto-fixed (they need a real rewrite —
    use feedback_for_regeneration()).
    """
    if not text:
        return text
    out = text
    for k, v in _CURLY.items():
        out = out.replace(k, v)
    out = re.sub(r"\s*[—–]\s*", ", ", out)               # dash connector -> comma
    out = re.sub(r"(?im)^\s*(?:certainly|absolutely|sure)!\s*", "", out)
    out = re.sub(r"(?im)\s*\b(?:i hope this helps|hope this helps)[.!]?\s*$", "", out)
    return out.strip()
