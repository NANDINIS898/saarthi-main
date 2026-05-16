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
