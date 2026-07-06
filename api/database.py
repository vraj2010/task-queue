import os
import asyncpg
import redis.asyncio as aioredis
from dotenv import load_dotenv

load_dotenv()

_db_pool = None
_redis = None


async def get_db() -> asyncpg.Pool:
    global _db_pool
    if _db_pool is None:
        dsn = os.getenv("DATABASE_URL")
        if not dsn:
            raise RuntimeError(".env not loaded — DATABASE_URL is None")
        _db_pool = await asyncpg.create_pool(
            dsn=dsn,
            min_size=1,
            max_size=3
        )
    return _db_pool


async def get_redis() -> aioredis.Redis:
    global _redis

    if _redis is None:
        _redis = aioredis.from_url(
            os.getenv("REDIS_URL"),
            decode_responses=True
        )

    return _redis