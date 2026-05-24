# Saarthi

**AI powered loan underwriting and Video onboarding platform.**

Saarthi replaces paper-and-form loan applications with a 5-minute conversational
experience: a live video KYC session, an XGBoost risk model with SHAP
explainability, industry-standard responsible-lending guardrails (FOIR, total
exposure cap, concurrent-loan limit), and a multi-agent layer that negotiates
the offer and issues the sanction letter: all guided by a voice-driven AI
assistant.

---

## What it does

| Step | Experience | Under the hood |
|---|---|---|
| **1. Sign up** | Email + password | FastAPI · JWT · bcrypt · PostgreSQL |
| **2. Live KYC** | 12-second webcam session: blink + hold up Aadhaar | Browser MediaRecorder · Supabase Storage · Groq Vision OCR · MediaPipe liveness · name-match guard |
| **3. Apply for loan** | Amount, purpose, income, tenure | Pydantic validation · LoanApplication row |
| **4a. Policy gate** | Hard check on FOIR ≤ 50%, exposure ≤ 24× income, ≤ 3 active loans | Rule engine in `agents/exposure.py`, runs **before** the model |
| **4b. ML underwriting** | Credit score 300–900 with SHAP top drivers | XGBoost 2.1 (12 features) · SHAP TreeExplainer |
| **5. Personalised offers** | 3 risk-tiered offers, sized to FOIR headroom | Decision Engine · EMI calculator · tier-based pricing |
| **6. Negotiate** | Natural-language chat — "lower the EMI", "extend tenure" | Groq Llama 3.3 70B · server-side guardrails clamp every proposal to policy |
| **7. Accept** | One click → sanction letter PDF | ReportLab · Supabase signed URLs · admin-review state |
| **Always-on** | "Talk to Saarthi" voice assistant — persistent conversation across pages | Groq Whisper STT · context-aware Groq Llama chat · sessionStorage history |

---

## Architecture

```
                         ┌──────────────────┐
                         │   React + Vite   │
                         │   (TypeScript)   │
                         └────────┬─────────┘
                                  │ JWT · axios
                                  ▼
                         ┌──────────────────┐        ┌──────────────────┐
                         │   FastAPI app    │◄──────►│ Supabase Storage │
                         │                  │        │  (KYC media,     │
                         │  ┌────────────┐  │        │   sanction PDFs) │
                         │  │   Routes   │  │        └──────────────────┘
                         │  └─────┬──────┘  │
                         │  ┌─────▼──────┐  │        ┌──────────────────┐
                         │  │  Services  │  │◄──────►│ Supabase Postgres│
                         │  └─────┬──────┘  │        │ (Supavisor pool) │
                         │  ┌─────▼──────┐  │        └──────────────────┘
                         │  │   Agents   │  │
                         │  └────────────┘  │
                         └────────┬─────────┘
                                  │
            ┌─────────────────────┼────────────────────────────┐
            ▼                     ▼                            ▼
    ┌──────────────┐     ┌──────────────────┐        ┌──────────────────┐
    │  XGBoost +   │     │   Groq Cloud     │        │   MediaPipe      │
    │     SHAP     │     │  • Llama 3.3 70B │        │  Face Mesh       │
    │ (risk model) │     │  • Llama 4 Scout │        │  (liveness)      │
    └──────────────┘     │    (vision)      │        └──────────────────┘
                         │  • Whisper       │
                         │    (STT)         │
                         └──────────────────┘
```

### Multi-agent pipeline

```
                ┌─── Policy Gate ───┐  fails → synthetic reject + Explanation
KYC Pipeline ─► │ FOIR / Exposure / │  ──┐
(OCR + face +   │ Concurrent loans  │    │
 liveness +     └─── passes ────────┘    │
 name match)            │                ▼
                        ▼      ┌────────────────────────────┐
              Underwriting     │ RiskAssessmentCard (UI)    │
              Agent (XGBoost   │  • score gauge + SHAP, OR  │
              + SHAP)          │  • policy-rejection panel  │
                        │      └────────────────────────────┘
                        ▼
              Decision Engine ──► 3 offers, sized to min(tier ceiling, FOIR headroom)
                        │
                        ├──► Negotiation Agent (loops within policy bounds)
                        │
                        └──► Sanction Writer (PDF) ──► admin review

Saarthi Assistant (voice + chat) runs alongside, routes the user to the next step.
```

---

## Responsible-lending controls

Three hard rules sit in `app/agents/exposure.py` and run **before** the ML
model is asked. They protect borrowers from over-leverage and protect the
lender from concentration risk, mirroring RBI guidance and standard practice
at HDFC / ICICI / SBI / Bajaj Finserv.

| Rule | Value | What it prevents |
|---|---|---|
| **FOIR** (Fixed Obligations to Income Ratio) | ≤ 50% | Total EMI commitments (existing + new) cannot exceed half of monthly income |
| **Exposure cap** | ≤ 24 × monthly income | Total outstanding unsecured principal capped at ~two years of income |
| **Concurrency cap** | ≤ 3 active loans | Limits debt stacking; data shows sharply higher default beyond 3 concurrent unsecured loans |

When the gate fails, the underwriting agent persists a synthetic
`RiskAssessment` with `model_version = "policy-gate-v1"` and a structured
explanation (breached rule, reason text, remediation hint, all the underlying
numbers). The frontend `RiskAssessmentCard` renders a dedicated
policy-rejection layout with the breached rule, a visualisation of the
breaching metric, a facts panel, and a plain-language remediation.

The Decision Engine respects the same headroom: even when the policy gate
passes, offer principal is capped at `min(tier_ceiling, max_safe_principal)`
so a slightly-stretched borrower gets a smaller offer rather than one that
would put them over FOIR.

---

## Tech stack

**Backend** — Python 3.11, FastAPI, SQLAlchemy 2, Alembic, Pydantic v2, JWT (python-jose), passlib + bcrypt, httpx

**ML / CV** — XGBoost 2.1, SHAP 0.46, scikit-learn 1.5, pandas, NumPy, OpenCV (headless), MediaPipe, Pillow, ReportLab

**LLM** — Groq SDK (Llama 3.3 70B Versatile for chat & negotiation, Llama 4 Scout for vision OCR + face comparison, Whisper Large v3 Turbo for STT)

**Frontend** — Vite, React 19, TypeScript, Tailwind CSS v4, React Router, Zustand (with persist middleware), Axios

**Infrastructure** — PostgreSQL via Supabase (Supavisor connection pooler), Supabase Storage (private buckets, signed URLs)

---

## Quick start

### Prerequisites

- Python 3.11+
- Node.js 20+
- A Supabase project (free tier is fine)
- A Groq API key (free tier: https://console.groq.com/keys)

### 1. Clone

```bash
git clone https://github.com/NANDINIS898/saarthi-main.git
cd saarthi-main
```

### 2. Backend

```bash
cd backend
python -m venv venv
# Windows:
.\venv\Scripts\Activate.ps1
# macOS/Linux:
source venv/bin/activate

pip install -r requirements.txt
cp .env.example .env       # then fill in the values below
```

Edit `backend/.env`:

```env
# Database — Supabase dashboard → Project Settings → Database → Connection string (URI)
# Use the SUPAVISOR pooler URL on port 6543, not the direct db host.
DATABASE_URL=postgresql://postgres.<PROJECT-REF>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:6543/postgres

SECRET_KEY=<generate-a-long-random-string>
GROQ_API_KEY=<from console.groq.com>

# Supabase Storage — Project Settings → API
SUPABASE_URL=https://<PROJECT-REF>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role JWT, NOT the anon key>
SUPABASE_STORAGE_BUCKET=kyc-media
```

> In the Supabase dashboard, create a **private** Storage bucket called `kyc-media`.

Run database migrations and train the initial risk model:

```bash
alembic upgrade head
python -m app.ml.risk.train     # produces app/ml/risk/artifacts/model.json
```

Start the API:

```bash
uvicorn main:app --reload --port 8000
```

Swagger docs: http://127.0.0.1:8000/docs

### 3. Frontend

```bash
cd ../frontend
npm install
npm run dev
```

Open http://localhost:5173

The Vite dev server proxies `/auth`, `/users`, `/kyc`, `/applications`, `/assistant`, `/health` to `127.0.0.1:8000`, so the React app uses relative URLs and avoids CORS in development.

---

## ML model

**Algorithm.** XGBoost classifier (gradient-boosted trees), `n_estimators=400`, `max_depth=5`, `learning_rate=0.05`, trained with `tree_method=hist`.

**Features (12).** Defined in [`app/ml/risk/features.py`](backend/app/ml/risk/features.py):

```
monthly_income · age · employment_years · existing_loans_count ·
credit_history_months · previous_defaults · loan_amount ·
loan_tenure_months · emi_to_income_ratio · kyc_face_match ·
kyc_liveness · address_stability_yrs
```

The underwriting agent populates `existing_loans_count`,
`credit_history_months`, `previous_defaults` and `emi_to_income_ratio` from
the borrower's **real** loan portfolio (via `exposure.snapshot_for(user)`),
so the model sees true exposure rather than placeholder defaults.

**Score scale.** XGBoost predicts P(default) ∈ [0, 1]. We map to a credit-bureau-style score:

```
credit_score = 900 − P(default) × 600
```

So P=0.07 → score 858, P=0.95 → score 330.

**Decision thresholds.**

| Score | Decision |
|---|---|
| ≥ 700 | Approve |
| 600–699 | Review |
| < 600 | Reject |

A policy-gate rejection bypasses the model entirely and is persisted with
`risk_score = 0` and `model_version = "policy-gate-v1"`.

**Training data.** Currently a 50,000-row synthetic dataset modelled after the Home Credit Default Risk Kaggle competition. Test AUC **0.883**. The training pipeline is set up to swap in the real Kaggle CSV — see `app/ml/risk/synthetic.py` to understand the contract, then write a `kaggle_loader.py` that returns the same `(X, y)` shape.

**Explainability.** Every model prediction runs through SHAP TreeExplainer → returns the contribution of each feature to that specific applicant's score. Policy-gate rejections come with a structured human explanation (breached rule, the offending numbers, and a remediation hint) instead of SHAP, since the model was never asked.

---

## Project structure

```
saarthi-main/
├── backend/
│   ├── main.py                        # FastAPI entrypoint
│   ├── alembic/                       # database migrations
│   ├── app/
│   │   ├── config.py                  # pydantic-settings, reads .env
│   │   ├── database/
│   │   │   ├── connection.py          # SQLAlchemy engine, get_db dependency
│   │   │   └── models.py              # 8 ORM tables
│   │   ├── routes/                    # FastAPI routers
│   │   ├── schemas/                   # Pydantic request/response models
│   │   ├── services/                  # business logic
│   │   ├── agents/                    # AI agents
│   │   │   ├── exposure.py            # FOIR / exposure / concurrency rules
│   │   │   ├── underwriting_agent.py  # policy gate + XGBoost + SHAP
│   │   │   ├── decision_engine.py     # offers sized to headroom + tier
│   │   │   ├── negotiation_agent.py   # Groq LLM with policy guardrails
│   │   │   ├── assistant_agent.py     # Whisper STT + contextual chat
│   │   │   ├── sanction_writer.py     # ReportLab PDF
│   │   │   └── emi.py                 # EMI calculator
│   │   ├── ml/
│   │   │   ├── kyc/                   # OCR / face match / liveness modules
│   │   │   └── risk/
│   │   │       ├── features.py        # feature contract
│   │   │       ├── synthetic.py       # training-data generator
│   │   │       ├── train.py
│   │   │       ├── predict.py         # inference + SHAP
│   │   │       └── artifacts/         # model.json, feature_columns.json
│   │   └── utils/                     # jwt, deps, security, logger
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    ├── src/
    │   ├── App.tsx                    # router + global floating assistant
    │   ├── api/                       # axios client + TS types
    │   ├── store/
    │   │   ├── auth.ts                # Zustand auth store
    │   │   └── chat.ts                # Persistent assistant chat (sessionStorage)
    │   ├── components/
    │   │   ├── Sidebar.tsx            # dark sidebar nav + global Apply CTA
    │   │   ├── PageShell.tsx          # sidebar + top bar (KYC pill, bell, profile)
    │   │   ├── Logo.tsx
    │   │   ├── SaarthiAssistant.tsx   # floating voice/chat assistant
    │   │   └── RiskAssessmentCard.tsx # score gauge + SHAP OR policy explanation
    │   └── pages/
    │       ├── Login.tsx
    │       ├── Signup.tsx
    │       ├── Assistant.tsx          # full-page AI chat (primary home)
    │       ├── KycSession.tsx         # 6-step stepper + live webcam KYC
    │       ├── LoanFlow.tsx           # form → risk → offers → chat → sanction
    │       ├── Applications.tsx       # stats + cards with progress bars
    │       ├── History.tsx            # stats + history rows + credit score
    │       └── Settings.tsx
    ├── vite.config.ts
    └── package.json
```

---

## API overview

Full interactive docs at `/docs` when the server is running. Highlights:

| Group | Routes |
|---|---|
| **Auth** | `POST /auth/signup` · `POST /auth/login` · `GET /auth/me` |
| **KYC** | `POST /kyc/session/start` · `POST /kyc/session/{id}/upload-video` · `POST /kyc/session/{id}/upload-aadhaar` · `POST /kyc/session/{id}/verify` |
| **Applications** | `POST /applications` · `GET /applications` · `GET /applications/{id}/summary` |
| **Underwriting** | `POST /applications/{id}/underwrite` · `GET /applications/{id}/risk` |
| **Offers + negotiation** | `POST /applications/{id}/offers/generate` · `GET /applications/{id}/offers` · `POST /applications/{id}/negotiate` |
| **Accept + sanction** | `POST /applications/{id}/offers/{offer_id}/accept` · `GET /applications/{id}/sanction` |
| **Saarthi assistant** | `POST /assistant/transcribe` · `POST /assistant/chat` |

Every authenticated route expects an `Authorization: Bearer <jwt>` header.

---

## Security notes

- The Supabase **service-role key** is server-only. It bypasses Row-Level Security and must never reach the browser.
- Passwords are stored as bcrypt hashes (cost factor 12).
- KYC pipeline enforces a **name-match check** between the OCR-extracted Aadhaar name and the registered account name to prevent impersonation.
- **Lending policy is enforced server-side.** The FOIR / exposure / concurrency gate and the negotiation guardrails (rate floor/ceiling, max tenure, max DTI) cannot be bypassed by anything the LLM produces — every proposal is clamped before persistence.
- Sanction PDFs live in a private Storage bucket, served via short-lived signed URLs.
- The assistant chat is persisted in **sessionStorage**, not localStorage — it clears on tab close.

---

## Future Integrations

- [ ] Swap synthetic training data for the real Home Credit Default Risk dataset
- [ ] Admin review screen for pending sanction letters
- [ ] Voice-driven actions (accept / negotiate directly from the assistant)
- [ ] STT for the KYC session itself, auto-extract loan amount and income from the spoken video
- [ ] Production anti-spoof model (replacement for the MediaPipe blink-based check)
- [ ] WebRTC streaming KYC (instead of chunked upload)
- [ ] Multi-language support (Hindi + regional languages via Whisper)
- [ ] Pull live FOIR data from a real bureau (CIBIL / Experian / CRIF) instead of relying only on in-system loans



