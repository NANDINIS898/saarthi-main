# 🧠 Saarthi — AI-Powered Video-Based Loan Assistant

Saarthi is a real-time, AI-driven, video-based loan onboarding and decision intelligence system designed to transform traditional form-based lending journeys into intelligent conversational experiences.

Instead of static forms and manual verification, users interact with Saarthi through a video-based AI assistant that captures, verifies, evaluates, and generates personalized loan offers in real time.

---

# 🚀 Vision

With Saarthi, we aim to build the next generation of intelligent lending systems that are:

- Conversational instead of form-based
- Explainable instead of black-box
- Real-time instead of delayed
- User-centric instead of process-centric

Our goal is to reduce onboarding friction, improve fraud detection, and deliver transparent financial decision-making using AI, ML, and multi-agent orchestration.

---

# 🎯 Key Features

## 🎥 Video-Based AI Onboarding
- Real-time conversational onboarding
- AI-powered user interaction
- Eliminates long static forms

---

## 🗣️ Speech-to-Text & Semantic Understanding
- Extracts:
  - Income
  - Employment
  - Loan purpose
  - Consent
- Converts unstructured conversation into structured financial data

---

## 👁️ Fraud Detection & Verification
- OpenCV-based age estimation
- Geo-location validation
- Session metadata analysis
- Consent capture & verification

---

## 🧠 Multi-Agent AI Architecture
Saarthi uses specialized AI agents coordinated through a master orchestrator:

### 🔹 Underwriting Agent
- ML-based risk scoring
- Decision intelligence
- Confidence scoring

### 🔹 Negotiation Agent
- Personalized loan offers
- EMI optimization
- Risk-based pricing

### 🔹 Explanation Agent
- Human-friendly decision explanations
- Transparent reasoning
- Explainable AI experience

---

## 📊 Explainable ML Decisioning
- XGBoost for risk prediction
- SHAP for explainability
- Risk bands & confidence scoring

---

## 🔄 Drop-Off Recovery
- Stateful user journey tracking
- Resume onboarding from last step
- Reduces application abandonment

---

## 🛡️ Audit & Compliance
- Stores:
  - transcripts
  - decisions
  - metadata
  - session logs
- LangSmith integration for LLM tracing & observability

---

# 🧩 System Architecture

```text
Frontend (React Video UI)
        ↓
Perception Layer (STT + OpenCV + Metadata Extraction)
        ↓
Intent Router (LLM + Rule-Based Routing)
        ↓
Master Orchestrator (Flow + State Management)
        ↓
Agents Layer:
   → Underwriting Agent
   → Negotiation Agent
   → Explanation Agent
        ↓
Decision Aggregation Layer
        ↓
Sanction Letter Generation Engine
        ↓
Audit & Compliance Layer
        ↓
Response to Frontend
