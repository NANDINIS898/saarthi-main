# Saarthi

**AI-powered loan underwriting and onboarding platform.**

Saarthi replaces paper-and-form loan applications with a 5-minute conversational
experience: a live video KYC session, an XGBoost risk model with SHAP
explainability, and a multi-agent layer that negotiates the offer and issues
the sanction letter — all guided by a voice-driven AI assistant.

---

## What it does

| Step | Experience | Under the hood |
|---|---|---|
| **1. Sign up** | Email + password | FastAPI · JWT · bcrypt · PostgreSQL |
| **2. Live KYC** | 12-second webcam session: blink + hold up Aadhaar | Browser MediaRecorder · Supabase Storage · Groq Vision OCR · MediaPipe liveness · name-match guard |
| **3. Apply for loan** | Amount, purpose, income, tenure | Pydantic validation · LoanApplication row |
| **4. Underwriting** | Instant credit score 300–900 with SHAP top drivers | XGBoost 2.1 (12 features) · SHAP TreeExplainer |
| **5. Personalised offers** | 3 risk-tiered offers (best, lower-EMI, quick-payoff) | Decision Engine · EMI calculator · tier-based pricing |
| **6. Negotiate** | Natural-language chat — "lower the EMI", "extend tenure" | Groq Llama 3.3 70B · server-side guardrails clamp every proposal to policy |
| **7. Accept** | One click → sanction letter PDF | ReportLab · Supabase signed URLs · admin-review state |
| **Always-on** | "Talk to Saarthi" voice assistant floating on every page | Groq Whisper STT · context-aware Groq Llama chat |

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
                         │  │  Services  │  │◄──────►│  Supabase Postgres│
                         │  └─────┬──────┘  │        │  (Supavisor pool)│
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
KYC Pipeline ─────► Underwriting Agent ─────► Decision Engine ─┬─► Negotiation Agent (loops)
(OCR + face +       (XGBoost + SHAP →           (3 offer        │
 liveness +         RiskAssessment row)         variants per    │
 name match)                                    risk tier)      └─► Sanction Writer (PDF)
                                                                        │
                                            Saarthi Assistant ──────────┘
                                            (voice + chat, context-aware,
                                             routes user to the right page)
```

---

## Tech stack

**Backend** — Python 3.11, FastAPI, SQLAlchemy 2, Alembic, Pydantic v2, JWT (python-jose), passlib + bcrypt, httpx

**ML / CV** — XGBoost 2.1, SHAP 0.46, scikit-learn 1.5, pandas, NumPy, OpenCV (headless), MediaPipe, Pillow, ReportLab

**LLM** — Groq SDK (Llama 3.3 70B Versatile for chat & negotiation, Llama 4 Scout for vision OCR + face comparison, Whisper Large v3 Turbo for STT)

**Frontend** — Vite, React 19, TypeScript, Tailwind CSS v4, React Router, Zustand, Axios

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

**Training data.** Currently a 50,000-row synthetic dataset modelled after the Home Credit Default Risk Kaggle competition. Test AUC **0.883**. The training pipeline is set up to swap in the real Kaggle CSV — see `app/ml/risk/synthetic.py` to understand the contract, then write a `kaggle_loader.py` that returns the same `(X, y)` shape.

**Explainability.** Every prediction runs through SHAP TreeExplainer → returns the contribution of each feature to that specific applicant's score. The frontend renders these as horizontal bars (green = lowered risk, red = raised it).

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
│   │   │   ├── auth.py
│   │   │   ├── kyc.py
│   │   │   ├── applications.py
│   │   │   └── assistant.py
│   │   ├── schemas/                   # Pydantic request/response models
│   │   ├── services/                  # business logic
│   │   │   ├── auth_service.py
│   │   │   ├── kyc_service.py
│   │   │   ├── kyc_pipeline_service.py
│   │   │   ├── loan_service.py
│   │   │   └── storage_service.py     # Supabase Storage client (httpx)
│   │   ├── agents/                    # AI agents
│   │   │   ├── underwriting_agent.py  # XGBoost + SHAP
│   │   │   ├── decision_engine.py     # risk-tiered offer generation
│   │   │   ├── negotiation_agent.py   # Groq LLM with policy guardrails
│   │   │   ├── assistant_agent.py     # Whisper STT + contextual chat
│   │   │   ├── sanction_writer.py     # ReportLab PDF
│   │   │   └── emi.py                 # EMI calculator
│   │   ├── ml/
│   │   │   ├── kyc/                   # OCR / face match / liveness modules
│   │   │   └── risk/
│   │   │       ├── features.py        # feature contract
│   │   │       ├── synthetic.py       # training-data generator
│   │   │       ├── train.py           # `python -m app.ml.risk.train`
│   │   │       ├── predict.py         # inference + SHAP
│   │   │       └── artifacts/         # model.json, feature_columns.json
│   │   └── utils/                     # jwt, deps, security, logger
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    ├── src/
    │   ├── App.tsx                    # router + global Saarthi FAB
    │   ├── api/                       # axios client + TS types
    │   ├── store/                     # Zustand auth store
    │   ├── components/
    │   │   ├── AppHeader.tsx
    │   │   ├── SaarthiAssistant.tsx   # floating voice/chat assistant
    │   │   └── RiskAssessmentCard.tsx # score gauge + SHAP bars
    │   └── pages/
    │       ├── Login.tsx
    │       ├── Signup.tsx
    │       ├── Dashboard.tsx
    │       ├── KycSession.tsx         # live webcam KYC
    │       ├── LoanFlow.tsx           # form → risk → offers → chat → sanction
    │       └── Applications.tsx       # list with lifecycle timeline
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
- The negotiation LLM cannot violate business policy: every proposal it returns is clamped to the tier's rate floor/ceiling, max tenure, and max DTI by server-side guardrails before being persisted.
- Sanction PDFs live in a private Storage bucket, served via short-lived signed URLs.

---

## Roadmap

- [ ] Swap synthetic training data for the real Home Credit Default Risk dataset
- [ ] Admin review screen for pending sanction letters
- [ ] Voice-driven actions (accept / negotiate directly from the assistant)
- [ ] STT for the KYC session itself — auto-extract loan amount and income from the spoken video
- [ ] Production anti-spoof model (replacement for the MediaPipe blink-based check)
- [ ] WebRTC streaming KYC (instead of chunked upload)
- [ ] Multi-language support (Hindi + regional languages via Whisper)

---


