from sqlalchemy import Column, Integer, String, Float, DateTime, Text, ForeignKey, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, relationship
from pgvector.sqlalchemy import Vector


class Base(DeclarativeBase):
    pass


# ── Hierarchy ──

class Tenant(Base):
    __tablename__ = "tenants"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    shops = relationship("Shop", back_populates="tenant", cascade="all, delete-orphan")
    users = relationship("User", back_populates="tenant", cascade="all, delete-orphan")


class Shop(Base):
    __tablename__ = "shops"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    address = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    tenant = relationship("Tenant", back_populates="shops")
    users = relationship("User", back_populates="shop", cascade="all, delete-orphan")
    persons = relationship("Person", back_populates="shop", cascade="all, delete-orphan")
    sightings = relationship("Sighting", back_populates="shop", cascade="all, delete-orphan")
    ingest_jobs = relationship("IngestJob", back_populates="shop", cascade="all, delete-orphan")
    live_streams = relationship("LiveStream", back_populates="shop", cascade="all, delete-orphan")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    shop_id = Column(Integer, ForeignKey("shops.id", ondelete="CASCADE"), nullable=True)
    email = Column(String(255), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(50), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    tenant = relationship("Tenant", back_populates="users")
    shop = relationship("Shop", back_populates="users")
    uploaded_jobs = relationship("IngestJob", back_populates="uploaded_by_user")
    created_streams = relationship("LiveStream", back_populates="created_by_user")


# ── Data tables ──

class Person(Base):
    __tablename__ = "persons"

    id = Column(Integer, primary_key=True, index=True)
    shop_id = Column(Integer, ForeignKey("shops.id", ondelete="CASCADE"), nullable=False)
    centroid = Column(Vector(512), nullable=False)
    embedding_count = Column(Integer, default=1, nullable=False)
    sighting_count = Column(Integer, default=1, nullable=False)
    first_seen = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    last_seen = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    label = Column(Text, nullable=True)
    model_version = Column(String(50), default="w600k_r50", nullable=False)

    shop = relationship("Shop", back_populates="persons")
    sightings = relationship("Sighting", back_populates="person", cascade="all, delete-orphan")


class Sighting(Base):
    __tablename__ = "sightings"

    id = Column(Integer, primary_key=True, index=True)
    shop_id = Column(Integer, ForeignKey("shops.id", ondelete="CASCADE"), nullable=False)
    person_id = Column(Integer, ForeignKey("persons.id", ondelete="CASCADE"), nullable=False)
    camera_id = Column(String(100), nullable=False)
    seen_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    quality_score = Column(Float, nullable=True)
    embedding = Column(Vector(512), nullable=True)
    crop_path = Column(Text, nullable=True)
    bbox = Column(JSONB, nullable=True)
    job_id = Column(Text, ForeignKey("ingest_jobs.id", ondelete="SET NULL"), nullable=True)
    stream_id = Column(Text, ForeignKey("live_streams.id", ondelete="SET NULL"), nullable=True)

    shop = relationship("Shop", back_populates="sightings")
    person = relationship("Person", back_populates="sightings")
    job = relationship("IngestJob", back_populates="sightings")
    stream = relationship("LiveStream", back_populates="sightings")


class IngestJob(Base):
    __tablename__ = "ingest_jobs"

    id = Column(Text, primary_key=True)
    shop_id = Column(Integer, ForeignKey("shops.id", ondelete="CASCADE"), nullable=False)
    uploaded_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    original_name = Column(Text, nullable=True)
    video_path = Column(Text, nullable=False)
    camera_id = Column(String(100), nullable=False)
    recorded_at = Column(DateTime(timezone=True), nullable=False)
    fps = Column(Float, nullable=True)
    total_frames = Column(Integer, nullable=True)
    processed_frame = Column(Integer, default=0)
    status = Column(Text, nullable=False, default="queued")
    error = Column(Text, nullable=True)
    persons_found = Column(Integer, default=0)
    sightings_added = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    shop = relationship("Shop", back_populates="ingest_jobs")
    uploaded_by_user = relationship("User", back_populates="uploaded_jobs")
    sightings = relationship("Sighting", back_populates="job")


class LiveStream(Base):
    """
    A live RTSP camera stream.
    - status='running': worker is actively processing
    - status='paused': worker stopped, can resume
    - status='stopped': permanently stopped
    """
    __tablename__ = "live_streams"

    id = Column(Text, primary_key=True)
    shop_id = Column(Integer, ForeignKey("shops.id", ondelete="CASCADE"), nullable=False)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    url = Column(Text, nullable=False)
    camera_id = Column(String(100), nullable=False)
    name = Column(String(255), nullable=True)
    status = Column(Text, nullable=False, default="running")
    started_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    stopped_at = Column(DateTime(timezone=True), nullable=True)
    persons_found = Column(Integer, default=0)
    sightings_added = Column(Integer, default=0)

    shop = relationship("Shop", back_populates="live_streams")
    created_by_user = relationship("User", back_populates="created_streams")
    sightings = relationship("Sighting", back_populates="stream")