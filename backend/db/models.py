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
    label = Column(Text, nullable=True)
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

    person = relationship("Person", back_populates="sightings")

