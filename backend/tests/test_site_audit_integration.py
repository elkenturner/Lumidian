import asyncio

import pytest

from app.database import AsyncSessionLocal
from app.models import Brand
from tests.conftest import register_and_login, create_brand
from tests.fixtures.site_audit.static_server import run_server


HOME = """<html><head><title>X Pricing</title>
<meta name="description" content="X costs $99/month for Pro plan, billed annually with volume discounts.">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Organization","name":"X","url":"http://x","logo":"x","sameAs":["https://linkedin.com/x"]}
</script></head>
<body><h1>X</h1><h2>Pricing</h2><p>X costs $99/month as of 2025. According to a 2025 Forrester study, 73% of teams save 12 hours per week.</p>
<table><tr><th>Plan</th><th>Price</th></tr><tr><td>Pro</td><td>$99</td></tr></table>
<p>Source: <a href="https://forrester.com">Forrester</a></p></body></html>"""
ROBOTS = "User-agent: *\nAllow: /\n"
LLMS = "# X\n\n> X makes widgets.\n\n## Key resources\n- [Home](http://example.com/)\n"


@pytest.mark.asyncio
async def test_full_audit_flow_via_api(client):
    """End-to-end audit flow via HTTP API.

    1. Register paid user, create brand
    2. Override website_url to local static server
    3. POST /trigger
    4. Poll /audit/{id} until completed or timeout
    5. Verify pages, findings, recommendations endpoints respond
    6. Verify llms-txt and robots-snippet endpoints respond
    """
    await register_and_login(client, subscription_tier="basic")
    brand = await create_brand(client)

    async with run_server({
        "/": (200, "text/html", HOME),
        "/robots.txt": (200, "text/plain", ROBOTS),
        "/llms.txt": (200, "text/plain", LLMS),
    }) as base:
        # Override the brand's website_url to point at our static server
        async with AsyncSessionLocal() as db:
            b = await db.get(Brand, brand["id"])
            b.website_url = base
            await db.commit()

        r = await client.post(f"/api/site-audit/{brand['id']}/trigger")
        assert r.status_code == 202, r.text
        audit_id = r.json()["audit_id"]

        # Poll up to 60s for completion
        completed = False
        for _ in range(120):
            r = await client.get(f"/api/site-audit/audit/{audit_id}")
            if r.status_code == 200 and r.json().get("status") in ("completed", "failed", "cancelled"):
                completed = True
                break
            await asyncio.sleep(0.5)

        assert completed, "audit didn't complete within 60s"
        detail = r.json()
        assert detail["status"] == "completed", detail

        r = await client.get(f"/api/site-audit/audit/{audit_id}/pages")
        assert r.status_code == 200
        pages = r.json()
        assert pages, "expected at least one page in audit"

        r = await client.get(f"/api/site-audit/audit/{audit_id}/findings")
        assert r.status_code == 200

        r = await client.get(f"/api/site-audit/audit/{audit_id}/recommendations")
        assert r.status_code == 200

        r = await client.get(f"/api/site-audit/{brand['id']}/llms-txt")
        assert r.status_code == 200
        assert "# " in r.text

        r = await client.get(f"/api/site-audit/{brand['id']}/robots-snippet?mode=allow_all")
        assert r.status_code == 200
        assert "GPTBot" in r.text
