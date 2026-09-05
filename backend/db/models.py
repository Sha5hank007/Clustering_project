from sqlalchemy import Column, Integer, String, Float, DateTime, Text, ForeignKey, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, relationship
from pgvector.sqlalchemy import Vector


class Base(DeclarativeBase):
    pass


class Person(Base):
    __tablename__ = "persons"

    id = Column(Integer, primary_key=True, index=True)
    centroid = Column(Vector(512), nullable=False)
    embedding_count = Column(Integer, default=1, nullable=False)
    sighting_count = Column(Integer, default=1, nullable=False)
    first_seen = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    last_seen = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    label = Column(Text, nullable=True)  # owner-assigned name
    model_version = Column(String(50), default="w600k_r50", nullable=False)

    sightings = relationship("Sighting", back_populates="person", cascade="all, delete-orphan")


class Sighting(Base):
    __tablename__ = "sightings"

    id = Column(Integer, primary_key=True, index=True)
    person_id = Column(Integer, ForeignKey("persons.id", ondelete="CASCADE"), nullable=False)
    camera_id = Column(String(100), nullable=False)
    seen_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    quality_score = Column(Float, nullable=True)
    embedding = Column(Vector(512), nullable=True)
    crop_path = Column(Text, nullable=True)
    bbox = Column(JSONB, nullable=True)
    job_id = Column(Text, ForeignKey("ingest_jobs.id", ondelete="SET NULL"), nullable=True)

    person = relationship("Person", back_populates="sightings")
    job = relationship("IngestJob", back_populates="sightings")


class IngestJob(Base):
    __tablename__ = "ingest_jobs"

    id = Column(Text, primary_key=True)
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

    sightings = relationship("Sighting", back_populates="job")