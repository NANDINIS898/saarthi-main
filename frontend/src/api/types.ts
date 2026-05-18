// Shapes returned by the FastAPI backend. Keep these in sync with app/schemas.

export interface User {
  id: number;
  full_name: string;
  email: string;
  phone: string | null;
  is_active: boolean;
  is_verified: boolean;
  is_admin: boolean;
  kyc_status: string;
  created_at: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in_minutes: number;
}

export interface KYCSession {
  id: number;
  user_id: number;
  status: string;
  video_url: string | null;
  aadhaar_front_url: string | null;
  aadhaar_back_url: string | null;
  face_match_score: number | null;
  liveness_score: number | null;
  ocr_extracted: Record<string, unknown> | null;
  failure_reason: string | null;
  created_at: string;
}

export interface UploadResult {
  session_id: number;
  storage_path: string;
  signed_url: string;
  size_bytes: number;
  content_type: string;
  field: string;
}

// ─── Phase 4: loan domain ─────────────────────────────────────────────────
export interface LoanApplication {
  id: number;
  user_id: number;
  loan_amount: number | null;
  loan_purpose: string | null;
  monthly_income: number | null;
  tenure_preference_months: number | null;
  status: string;
  created_at: string;
}

export interface RiskAssessment {
  id: number;
  application_id: number;
  risk_score: number;
  decision: string;            // "approve" | "review" | "reject"
  model_version: string;
  shap_values: Record<string, number> | null;
  features_used: Record<string, number> | null;
  created_at: string;
}

export interface LoanOffer {
  id: number;
  application_id: number;
  amount: number;
  interest_rate: number;
  tenure_months: number;
  emi: number;
  is_recommended: boolean;
  is_negotiated: boolean;
  negotiation_round: number;
  accepted: boolean;
  created_at: string;
}

export interface NegotiationResponse {
  offer: LoanOffer;
  agent_message: string;
  concession: string;
  round: number;
  dti: number;
}

export interface SanctionLetter {
  id: number;
  application_id: number;
  ref_no: string;
  pdf_url: string | null;
  signed_url: string | null;
  status: string;
  created_at: string;
}
