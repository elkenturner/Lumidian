"""Declarative tool definitions and dispatch for the AI visibility coach.

Each tool is a (schema, async_handler) pair. Handlers take (db, user_id,
brand_id, **kwargs), enforce ownership, query the DB, and return a
token-budgeted dict. Schemas use Anthropic's tool-use format.
"""
from typing import Any
