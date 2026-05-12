"""Local aiohttp server for site_audit tests — serves canned HTML by path."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from aiohttp import web


def make_app(routes: dict[str, tuple[int, str, str]]) -> web.Application:
    """routes: { path: (status, content_type, body) }"""
    app = web.Application()

    async def handler(request: web.Request) -> web.Response:
        entry = routes.get(request.path)
        if entry is None:
            return web.Response(status=404, text="not found")
        status, ctype, body = entry
        return web.Response(status=status, content_type=ctype, text=body)

    app.router.add_route("GET", "/{path:.*}", handler)
    return app


@asynccontextmanager
async def run_server(routes: dict[str, tuple[int, str, str]], port: int = 0):
    app = make_app(routes)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", port)
    await site.start()
    actual_port = site._server.sockets[0].getsockname()[1]
    try:
        yield f"http://127.0.0.1:{actual_port}"
    finally:
        await runner.cleanup()
