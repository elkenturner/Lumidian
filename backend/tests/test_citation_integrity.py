import pytest

from app.services.drafting.citation_integrity import enforce_citation_integrity
from app.services.drafting.evidence import EvidencePack, EvidenceSource


def _pack(n: int) -> EvidencePack:
    return EvidencePack(
        sources=[
            EvidenceSource(ref=f"S{i}", kind="web", url=f"https://nature.com/{i}",
                           title=f"T{i}", snippet=f"snippet {i}")
            for i in range(1, n + 1)
        ],
        query="q", brand_name="b",
    )


async def _keep_all(*, text, pack_sources):
    return text


async def _drop_s2(*, text, pack_sources):
    import re
    return re.sub(r"\[S2\]", "", text)


@pytest.mark.asyncio
async def test_bounds_drop_removes_hallucinated_marker():
    text = "Foo [S1] bar [S5] baz [S2]."
    res = await enforce_citation_integrity(
        text=text, pack=_pack(2), run_support_critic=False,
    )
    assert "[S5]" not in res.text
    assert res.out_of_range_dropped == 1
    assert res.retained_refs == ["S1", "S2"]
    assert res.low_evidence is False


@pytest.mark.asyncio
async def test_support_critic_drops_unsupported_marker():
    text = "Foo [S1] bar [S2]."
    res = await enforce_citation_integrity(
        text=text, pack=_pack(2), run_support_critic=True, support_critic=_drop_s2,
    )
    assert res.retained_refs == ["S1"]
    assert res.low_evidence is False


@pytest.mark.asyncio
async def test_all_markers_dropped_flags_low_evidence():
    # Writer cited only out-of-range markers → nothing real survives.
    text = "Foo [S7] bar [S9]."
    res = await enforce_citation_integrity(
        text=text, pack=_pack(2), run_support_critic=False,
    )
    assert res.retained_refs == []
    assert res.low_evidence is True


@pytest.mark.asyncio
async def test_empty_pack_is_low_evidence():
    res = await enforce_citation_integrity(
        text="No markers here.", pack=_pack(0), run_support_critic=False,
    )
    assert res.low_evidence is True


@pytest.mark.asyncio
async def test_no_markers_with_sources_is_not_low_evidence():
    # A piece that legitimately needed no citations and has a real pack.
    res = await enforce_citation_integrity(
        text="Plain prose, no claims.", pack=_pack(3), run_support_critic=True,
        support_critic=_keep_all,
    )
    assert res.low_evidence is False
    assert res.retained_refs == []


@pytest.mark.asyncio
async def test_support_critic_not_called_when_no_markers_survive_bounds():
    called = {"n": 0}

    async def _spy(*, text, pack_sources):
        called["n"] += 1
        return text

    # All markers out of range → bounds-drop clears them → critic skipped.
    await enforce_citation_integrity(
        text="Foo [S8].", pack=_pack(2), run_support_critic=True, support_critic=_spy,
    )
    assert called["n"] == 0
