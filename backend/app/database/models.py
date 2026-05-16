"""
SQLAlchemy ORM models.

These represent database tables. They are NEVER returned directly to API clients —
always map them to a Pydantic schema in app/schemas/ first.
"""

from sqlalchemy import (
    Column,
    Integer,
    String,
    DateTime,
    Boolean,
    Float,
    ForeignKey,
    Text,
    JSON,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database.connection import Base


# ────────────────────────────────────────────────────────────────────────────────
# User
# ────────────────────────────────────────────────────────────────────────────────
class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)

    full_name = Column(String(150), nullable=False)
    email = Column(String(150), unique=True, index=True, nullable=False)
    phone = Column(String(20), unique=True, index=True, nullable=True)

    hashed_password = Column(String(255), nullable=False)

    is_active = Column(Boolean, default=True, nullable=False)
    is_verified = Column(Boolean, default=False, nullable=False)
    is_admin = Column(Boolean, default=False, nullable=False)

    # KYC lifecycle: pending → in_review → approved / rejected
    kyc_status = Column(String(30), default="pending", nullable=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    loan_applications = relationship("LoanApplication", back_populates="user", cascade="all, delete-orphan")
    kyc_submissions = relationship("KYCSubmission", back_populates="user", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<User id={self.id} email={self.email}>"


# ────────────────────────────────────────────────────────────────────────────────
# LoanApplication — central record for one loan request
# ────────────────────────────────────────────────────────────────────────────────
class LoanApplication(Base):
    __tablename__ = "loan_applications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    # Captured from the video / STT pipeline
    loan_amount = Column(Float, nullable=True)
    loan_purpose = Column(String(100), nullable=True)
    monthly_income = Column(Float, nullable=True)
    tenure_preference_months = Column(Integer, nullable=True)

    # Lifecycle: draft → kyc_pending → underwriting → offer_pending →
    #            negotiating → accepted → sanctioned → disbursed / rejected
    status = Column(String(40), default="draft", nullable=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    user = relationship("User", back_populates="loan_applications")
    risk_assessments = relationship("RiskAssessment", back_populates="application", cascade="all, delete-orphan")
    offers = relationship("LoanOffer", back_populates="application", cascade="all, delete-orphan")
    agent_decisions = relationship("AgentDecision", back_populates="application", cascade="all, delete-orphan")
    sanction_letter = relationship("SanctionLetter", back_populates="application", uselist=False, cascade="all, delete-orphan")


# ────────────────────────────────────────────────────────────────────────────────
# KYCSubmission — one row per onboarding video session
# ────────────────────────────────────────────────────────────────────────────────
class KYCSubmission(Base):
    __tablename__ = "kyc_submissions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    # Media URLs — stored in Supabase Storage (Phase 2)
    video_url = Column(String(500), nullable=True)
    aadhaar_front_url = Column(String(500), nullable=True)
    aadhaar_back_url = Column(String(500), nullable=True)

    # CV pipeline outputs (Phase 3)
    face_match_score = Column(Float, nullable=True)        # 0.0 – 1.0
    liveness_score = Column(Float, nullable=True)          # 0.0 – 1.0
    ocr_extracted = Column(JSON, nullable=True)            # {name, dob, address, …}

    # Lifecycle: in_progress → processing → approved / rejected
    status = Column(String(30), default="in_progress", nullable=False)
    failure_reason = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    user = relationship("User", back_populates="kyc_submissions")


# ────────────────────────────────────────────────────────────────────────────────
# RiskAssessment — output of the XGBoost underwriting agent
# ────────────────────────────────────────────────────────────────────────────────
class RiskAssessment(Base):
    __tablename__ = "risk_assessments"

    id = Column(Integer, primary_key=True, index=True)
    application_id = Column(Integer, ForeignKey("loan_applications.id", ondelete="CASCADE"), nullable=False, index=True)

    risk_score = Column(Float, nullable=False)             # 0 – 1000 (or 0–1, your call)
    decision = Column(String(20), nullable=False)          # approve / review / reject
    model_version = Column(String(40), nullable=False)
    shap_values = Column(JSON, nullable=True)              # {feature: contribution}
    features_used = Column(JSON, nullable=True)            # {feature: value}

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    application = relationship("LoanApplication", back_populates="risk_assessments")


# ────────────────────────────────────────────────────────────────────────────────
# LoanOffer — one row per offer generated or negotiated
# ────────────────────────────────────────────────────────────────────────────────
class LoanOffer(Base):
    __tablename__ = "loan_offers"

    id = Column(Integer, primary_key=True, index=True)
    application_id = Column(Integer, ForeignKey("loan_applications.id", ondelete="CASCADE"), nullable=False, index=True)

    amount = Column(Float, nullable=False)
    interest_rate = Column(Float, nullable=False)          # annual %
    tenure_months = Column(Integer, nullable=False)
    emi = Column(Float, nullable=False)

    is_recommended = Column(Boolean, default=False, nullable=False)
    is_negotiated = Column(Boolean, default=False, nullable=False)
    negotiation_round = Column(Integer, default=0, nullable=False)
    accepted = Column(Boolean, default=False, nullable=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    application = relationship("LoanApplication", back_populates="offers")


# ────────────────────────────────────────────────────────────────────────────────
# AgentDecision — audit trail for every agent action (underwriting / nego / explain)
# ────────────────────────────────────────────────────────────────────────────────
class AgentDecision(Base):
    __tablename__ = "agent_decisions"

    id = Column(Integer, primary_key=True, index=True)
    application_id = Column(Integer, ForeignKey("loan_applications.id", ondelete="CASCADE"), nullable=False, index=True)

    agent_name = Column(String(50), nullable=False)        # underwriting / negotiation / explanation
    decision = Column(String(100), nullable=True)
    reasoning = Column(Text, nullable=True)
    llm_trace = Column(JSON, nullable=True)                # raw messages / tool calls

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    application = relationship("LoanApplication", back_populates="agent_decisions")


# ────────────────────────────────────────────────────────────────────────────────
# SanctionLetter — final generated PDF, awaiting admin review
# ────────────────────────────────────────────────────────────────────────────────
class SanctionLetter(Base):
    __tablename__ = "sanction_letters"

    id = Column(Integer, primary_key=True, index=True)
    application_id = Column(Integer, ForeignKey("loan_applications.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)

    ref_no = Column(String(50), unique=True, nullable=False, index=True)
    pdf_url = Column(String(500), nullable=True)

    # Lifecycle: pending_admin_review → approved / rejected
    status = Column(String(30), default="pending_admin_review", nullable=False)
    admin_reviewed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    admin_reviewed_at = Column(DateTime(timezone=True), nullable=True)
    admin_notes = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    application = relationship("LoanApplication", back_populates="sanction_letter")


# ────────────────────────────────────────────────────────────────────────────────
# AuditEvent — compliance-grade log of every meaningful action
# ────────────────────────────────────────────────────────────────────────────────
class AuditEvent(Base):
    __tablename__ = "audit_events"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    application_id = Column(Integer, ForeignKey("loan_applications.id", ondelete="SET NULL"), nullable=True, index=True)

    event_type = Column(String(60), nullable=False, index=True)  # signup, login, kyc_start, kyc_pass, underwrite, …
    payload = Column(JSON, nullable=True)
    ip_address = Column(String(45), nullable=True)
    user_agent = Column(String(255), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
