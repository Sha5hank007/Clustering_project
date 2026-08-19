"""
Async SQLAlchemy engine and session factory.
Creates engine from settings.DATABASE_URL.
Exports: async_engine, AsyncSessionLocal, get_db()
"""
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from config import settings

async_engine = create_async_engine(settings.database_url, echo=False)
AsyncSessionLocal = async_sessionmaker(async_engine, expire_on_commit=False)


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session