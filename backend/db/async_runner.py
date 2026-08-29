"""Run async coroutines from sync code using one persistent event loop."""

from __future__ import annotations

import asyncio
from typing import Coroutine, TypeVar

T = TypeVar("T")

_loop: asyncio.AbstractEventLoop | None = None


def run_async(coro: Coroutine[None, None, T]) -> T:
    global _loop
    if _loop is None or _loop.is_closed():
        _loop = asyncio.new_event_loop()
        asyncio.set_event_loop(_loop)
    return _loop.run_until_complete(coro)


async def shutdown_async_runner() -> None:
    global _loop
    from db.session import async_engine

    await async_engine.dispose()
    if _loop is not None and not _loop.is_closed():
        _loop.close()
    _loop = None
