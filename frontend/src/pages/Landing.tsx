import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiErrorMessage } from "../api/client";
import { useAuth } from "../store/auth";
import { Logo } from "../components/Logo";

/**
 * Public landing + auth page.
 *
 * The right-side card toggles between Sign-in and Sign-up modes in place —
 * no separate /signup route to fragment the experience. Top nav and hero
 * CTAs flip the same card.
 *
 * Animation philosophy: every hover affordance uses `transition-all`
 * with 150–300ms easing. Lifts use small Y translates + shadow growth;
 * icons get a subtle scale. No flashy effects — just a sense of weight
 * and responsiveness that mirrors B2B SaaS landing pages.
 */
type AuthMode = "signin" | "signup";

export default function Landing() {
  const [authMode, setAuthMode] = useState<AuthMode>("signin");

  function focusAuth(mode: AuthMode) {
    setAuthMode(mode);
    // Smooth scroll to the auth card so the user sees it switch.
    const el = document.getElementById("auth");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <TopNav onSignIn={() => focusAuth("signin")} onSignUp={() => focusAuth("signup")} />
      <Hero mode={authMode} setMode={setAuthMode} onJumpToAuth={focusAuth} />
      <AppPreview />
      <Features />
      <TrustStrip />
      <Footer onSignIn={() => focusAuth("signin")} onSignUp={() => focusAuth("signup")} />
    </div>
  );
}

// ─── Top nav ─────────────────────────────────────────────────────────────
function TopNav({ onSignIn, onSignUp }: { onSignIn: () => void; onSignUp: () => void }) {
  return (
    <header className="sticky top-0 z-30 bg-white/85 backdrop-blur border-b border-gray-100">
      <div className="max-w-7xl mx-auto px-6 py-3.5 flex items-center justify-between">
        <a href="#" className="flex items-center gap-2.5 group">
          <span className="transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3">
            <Logo size={34} />
          </span>
          <span className="font-semibold text-gray-900">Saarthi</span>
          <span className="hidden sm:inline text-[11px] text-gray-400 border-l border-gray-200 pl-2.5 ml-1">
            AI Loan Assistant
          </span>
        </a>

        <nav className="flex items-center gap-1">
          <NavLink href="#features">How it works</NavLink>
          <NavLink href="#preview">Product</NavLink>
          <button
            onClick={onSignUp}
            className="text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5 relative group"
          >
            <span>Sign up</span>
            <span className="absolute left-3 right-3 -bottom-0.5 h-px bg-gray-900 origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
          </button>
          <button
            onClick={onSignIn}
            className="text-sm bg-gray-900 hover:bg-gray-800 text-white font-medium rounded-lg px-4 py-1.5 transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5"
          >
            Sign in
          </button>
        </nav>
      </div>
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="hidden md:inline text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5 relative group"
    >
      <span>{children}</span>
      <span className="absolute left-3 right-3 -bottom-0.5 h-px bg-gray-900 origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
    </a>
  );
}

// ─── Hero ────────────────────────────────────────────────────────────────
function Hero({
  mode, setMode, onJumpToAuth,
}: { mode: AuthMode; setMode: (m: AuthMode) => void; onJumpToAuth: (m: AuthMode) => void }) {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(60% 60% at 15% 10%, rgba(16,185,129,0.10) 0%, rgba(16,185,129,0) 60%), radial-gradient(50% 50% at 90% 90%, rgba(15,23,42,0.06) 0%, rgba(15,23,42,0) 60%)",
        }}
      />
      <div className="relative max-w-7xl mx-auto px-6 pt-14 md:pt-20 pb-12 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
        {/* Left — pitch */}
        <div className="lg:col-span-7">
          <span className="inline-flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-full px-3 py-1 text-xs font-medium hover:bg-emerald-100 transition-colors duration-200 cursor-default">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Powered by XGBoost · SHAP · Groq Llama
          </span>

          <h1 className="mt-5 text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-gray-900 leading-[1.05]">
            Loans approved in{" "}
            <span className="bg-gradient-to-r from-emerald-500 to-emerald-700 bg-clip-text text-transparent">
              under 5 minutes.
            </span>
          </h1>

          <p className="mt-5 text-lg text-gray-600 max-w-xl leading-relaxed">
            Saarthi replaces paperwork with a 12-second video KYC, an explainable
            credit decision, and an AI agent that negotiates your offer — all
            inside one conversational flow.
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            <Pill>Video KYC</Pill>
            <Pill>Explainable ML scoring</Pill>
            <Pill>Offer negotiation</Pill>
            <Pill>Instant sanction PDF</Pill>
          </div>

          <div className="mt-7 flex flex-wrap gap-3">
            <button
              onClick={() => onJumpToAuth("signup")}
              className="group inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white font-medium rounded-lg px-5 py-3 text-sm shadow-md hover:shadow-xl hover:shadow-emerald-500/30 hover:-translate-y-0.5 transition-all duration-300"
            >
              Get started — it's free
              <span className="transition-transform duration-300 group-hover:translate-x-1">
                <ArrowRightIcon />
              </span>
            </button>
            <a
              href="#preview"
              className="group inline-flex items-center gap-2 bg-white hover:bg-gray-50 border border-gray-200 hover:border-gray-300 text-gray-700 font-medium rounded-lg px-5 py-3 text-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
            >
              <span className="transition-transform duration-300 group-hover:scale-110">
                <PlayIcon />
              </span>
              See the product
            </a>
          </div>

          <div className="mt-10 grid grid-cols-3 gap-6 max-w-md">
            <Stat number="5 min" label="Apply → offer" />
            <Stat number="300–900" label="Credit score range" />
            <Stat number="₹0" label="Setup cost" />
          </div>
        </div>

        {/* Right — auth card */}
        <div id="auth" className="lg:col-span-5 scroll-mt-24">
          <AuthCard mode={mode} setMode={setMode} />
        </div>
      </div>
    </section>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 bg-white border border-gray-200 rounded-full px-3 py-1 text-xs text-gray-700 hover:border-emerald-300 hover:text-emerald-700 hover:-translate-y-0.5 transition-all duration-200 cursor-default">
      <span className="w-1 h-1 rounded-full bg-emerald-500" />
      {children}
    </span>
  );
}

function Stat({ number, label }: { number: string; label: string }) {
  return (
    <div className="group cursor-default">
      <p className="text-xl font-bold text-gray-900 group-hover:text-emerald-600 transition-colors duration-200">
        {number}
      </p>
      <p className="text-[11px] text-gray-500 mt-0.5">{label}</p>
    </div>
  );
}

// ─── Auth card (toggles between sign-in and sign-up in place) ───────────
function AuthCard({ mode, setMode }: { mode: AuthMode; setMode: (m: AuthMode) => void }) {
  const navigate = useNavigate();
  const login = useAuth((s) => s.login);
  const signup = useAuth((s) => s.signup);
  const loading = useAuth((s) => s.loading);

  const [form, setForm] = useState({
    full_name: "",
    email: "",
    phone: "",
    password: "",
  });
  const [error, setError] = useState<string | null>(null);

  function field<K extends keyof typeof form>(key: K) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    try {
      if (mode === "signin") {
        await login(form.email, form.password);
      } else {
        await signup({
          full_name: form.full_name,
          email: form.email,
          phone: form.phone || undefined,
          password: form.password,
        });
      }
      navigate("/assistant");
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  function switchMode(next: AuthMode) {
    setError(null);
    setMode(next);
  }

  const isSignup = mode === "signup";

  return (
    <div className="w-full max-w-md ml-auto bg-white rounded-2xl border border-gray-200 shadow-[0_20px_50px_-20px_rgba(15,23,42,0.15)] hover:shadow-[0_25px_60px_-15px_rgba(15,23,42,0.2)] transition-shadow duration-300 overflow-hidden">
      {/* Tab toggle */}
      <div className="grid grid-cols-2 border-b border-gray-100 bg-gray-50/60">
        <ModeTab active={!isSignup} onClick={() => switchMode("signin")}>Sign in</ModeTab>
        <ModeTab active={isSignup}  onClick={() => switchMode("signup")}>Create account</ModeTab>
      </div>

      <form onSubmit={onSubmit} className="p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="transition-transform duration-300 hover:rotate-6">
            <Logo size={40} />
          </div>
          <div>
            <p className="text-base font-semibold text-gray-900 leading-tight">
              {isSignup ? "Create your account" : "Welcome back"}
            </p>
            <p className="text-xs text-gray-500 leading-tight">
              {isSignup ? "Get a loan decision in 5 minutes" : "Sign in to continue your application"}
            </p>
          </div>
        </div>

        {/* Smooth slide-in for signup-only fields */}
        <div
          className={`grid transition-all duration-300 ease-out overflow-hidden ${
            isSignup ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="min-h-0">
            <Field id="name" label="Full name">
              <input
                id="name"
                required={isSignup}
                minLength={2}
                value={form.full_name}
                onChange={field("full_name")}
                className={inputCls}
                placeholder="Arjun Mehta"
              />
            </Field>
          </div>
        </div>

        <Field id="email" label="Email">
          <input
            id="email"
            type="email"
            required
            value={form.email}
            onChange={field("email")}
            className={inputCls}
            placeholder="you@example.com"
          />
        </Field>

        <div
          className={`grid transition-all duration-300 ease-out overflow-hidden ${
            isSignup ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="min-h-0">
            <Field id="phone" label={<>Phone <span className="text-gray-400 font-normal">(optional)</span></>}>
              <input
                id="phone"
                value={form.phone}
                onChange={field("phone")}
                className={inputCls}
                placeholder="+91…"
              />
            </Field>
          </div>
        </div>

        <div className="flex items-center justify-between mb-1">
          <label className="block text-xs font-medium text-gray-600" htmlFor="pw">Password</label>
          {!isSignup && (
            <a href="#" className="text-[11px] text-emerald-600 hover:underline">Forgot?</a>
          )}
        </div>
        <input
          id="pw"
          type="password"
          required
          minLength={8}
          value={form.password}
          onChange={field("password")}
          className={inputCls + " mb-4"}
          placeholder={isSignup ? "At least 8 characters" : "Your password"}
        />

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="group w-full bg-gray-900 hover:bg-gray-800 disabled:opacity-50 disabled:hover:translate-y-0 text-white font-medium rounded-lg py-2.5 text-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg inline-flex items-center justify-center gap-2"
        >
          {loading
            ? (isSignup ? "Creating account…" : "Signing in…")
            : (<>
                {isSignup ? "Create account" : "Sign in"}
                <span className="transition-transform duration-300 group-hover:translate-x-1">
                  <ArrowRightIcon />
                </span>
              </>)}
        </button>

        <p className="mt-5 text-[10px] text-gray-400 text-center leading-relaxed">
          By continuing you agree to Saarthi's terms. We never share your KYC data with third parties.
        </p>
      </form>
    </div>
  );
}

const inputCls =
  "w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 mb-3 transition-all duration-200";

function ModeTab({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative py-3 text-sm font-medium transition-colors duration-200 ${
        active ? "text-gray-900 bg-white" : "text-gray-500 hover:text-gray-800"
      }`}
    >
      {children}
      {active && (
        <span className="absolute left-4 right-4 bottom-0 h-0.5 bg-emerald-500 rounded-full" />
      )}
    </button>
  );
}

function Field({
  id, label, children,
}: { id: string; label: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor={id}>{label}</label>
      {children}
    </>
  );
}

// ─── App preview (HTML mockup of the AI Assistant page) ─────────────────
function AppPreview() {
  return (
    <section id="preview" className="relative max-w-7xl mx-auto px-6 py-12 md:py-20">
      <div className="text-center max-w-2xl mx-auto mb-10">
        <p className="text-xs font-semibold tracking-wider uppercase text-emerald-600">
          What you'll see after sign-in
        </p>
        <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mt-2">
          A conversational dashboard, not a paperwork form.
        </h2>
      </div>

      <div className="group relative mx-auto max-w-6xl">
        <div
          aria-hidden
          className="absolute -inset-6 rounded-3xl blur-3xl opacity-60 pointer-events-none transition-opacity duration-500 group-hover:opacity-90"
          style={{
            background: "radial-gradient(40% 50% at 50% 50%, rgba(16,185,129,0.25) 0%, rgba(16,185,129,0) 70%)",
          }}
        />
        <div className="relative bg-white border border-gray-200 rounded-2xl shadow-2xl overflow-hidden transition-transform duration-500 group-hover:-translate-y-1">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-gray-50">
            <span className="w-3 h-3 rounded-full bg-red-400" />
            <span className="w-3 h-3 rounded-full bg-amber-400" />
            <span className="w-3 h-3 rounded-full bg-emerald-400" />
            <div className="flex-1 mx-4 bg-white border border-gray-200 rounded-md px-3 py-1 text-[11px] text-gray-400 truncate">
              saarthi.app/assistant
            </div>
          </div>

          <div className="grid grid-cols-12 min-h-[440px]">
            <div className="hidden md:block col-span-3 bg-[#0F172A] text-white p-4">
              <div className="flex items-center gap-2 mb-5">
                <Logo size={28} />
                <div>
                  <p className="text-sm font-semibold leading-tight">Saarthi</p>
                  <p className="text-[9px] text-white/50 leading-tight">Loan Assistant</p>
                </div>
              </div>
              <button className="w-full bg-emerald-500 text-white text-xs font-medium rounded-md py-2 mb-4">+ Apply for Loan</button>
              <SidebarItem label="AI Assistant" active />
              <SidebarItem label="Video KYC" badge="Required" />
              <SidebarItem label="Applications" />
              <SidebarItem label="History" />
            </div>

            <div className="col-span-12 md:col-span-9 bg-[#F9FAFB] p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm font-semibold text-gray-900">AI Assistant</p>
                  <p className="text-[10px] text-gray-500">Chat with Saarthi AI</p>
                </div>
                <span className="text-[10px] bg-amber-100 text-amber-700 border border-amber-200 rounded-md px-2 py-0.5">
                  KYC: Pending
                </span>
              </div>

              <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3 h-[230px] overflow-hidden">
                <ChatBubble role="assistant">
                  Namaste! I'm Saarthi. I can help with loan eligibility, EMI
                  calculations, and document requirements. How can I assist?
                </ChatBubble>
                <ChatBubble role="user">
                  Am I eligible for a ₹4 lakh personal loan?
                </ChatBubble>
                <ChatBubble role="assistant">
                  Based on your profile, you qualify with a credit score of 748.
                  I can show you 3 offers — the best one starts at ₹13,140 EMI for
                  36 months.
                </ChatBubble>
              </div>

              <div className="grid grid-cols-3 gap-2 mt-4">
                <QuickActionMini label="Calculate EMI" />
                <QuickActionMini label="Check Eligibility" />
                <QuickActionMini label="Document List" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SidebarItem({ label, active = false, badge }: { label: string; active?: boolean; badge?: string }) {
  return (
    <div className={`flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs mb-1 ${
      active ? "bg-emerald-500 text-white" : "text-white/70"
    }`}>
      <span>{label}</span>
      {badge && (
        <span className="text-[8px] bg-white/15 px-1 py-0.5 rounded">{badge}</span>
      )}
    </div>
  );
}

function ChatBubble({ role, children }: { role: "user" | "assistant"; children: React.ReactNode }) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="bg-emerald-500 text-white text-xs rounded-xl rounded-br-sm px-3 py-2 max-w-[75%]">
          {children}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start gap-2">
      <div className="w-6 h-6 rounded-full bg-emerald-500 flex-shrink-0" />
      <div className="bg-gray-100 border border-gray-200 text-gray-700 text-xs rounded-xl rounded-tl-sm px-3 py-2 max-w-[75%]">
        {children}
      </div>
    </div>
  );
}

function QuickActionMini({ label }: { label: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-2.5 py-2 text-[11px] text-gray-700 text-center hover:border-emerald-300 hover:text-emerald-700 hover:-translate-y-0.5 transition-all duration-200 cursor-default">
      {label}
    </div>
  );
}

// ─── Features grid ───────────────────────────────────────────────────────
function Features() {
  return (
    <section id="features" className="bg-[#0F172A] text-white">
      <div className="max-w-7xl mx-auto px-6 py-16 md:py-24">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
          <div className="lg:col-span-4">
            <p className="text-xs font-semibold tracking-wider uppercase text-emerald-400">
              How it works
            </p>
            <h2 className="text-3xl md:text-4xl font-bold mt-2 leading-tight">
              Four steps from sign-up to sanction.
            </h2>
            <p className="text-sm text-white/60 mt-4 leading-relaxed max-w-md">
              Every stage is an agent. They hand off to each other automatically —
              no human in the loop, but every decision is explainable.
            </p>
          </div>

          <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FeatureCard
              n="01"
              title="Video KYC"
              body="A 12-second selfie verifies you're a real person and matches your Aadhaar — face mesh liveness + OCR + name-match guard."
            />
            <FeatureCard
              n="02"
              title="Explainable scoring"
              body="XGBoost predicts default probability, mapped to a 300–900 credit score. SHAP tells you exactly which factors helped or hurt."
            />
            <FeatureCard
              n="03"
              title="AI negotiation"
              body="Chat with our agent to lower the EMI or extend tenure. Llama 3.3 70B drives the conversation; server-side guardrails keep every offer inside policy."
            />
            <FeatureCard
              n="04"
              title="Sanction letter"
              body="Accept the offer and your sanction PDF is generated in seconds, stored in a private bucket, and served via a short-lived signed URL."
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function FeatureCard({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="group relative bg-white/5 border border-white/10 rounded-2xl p-5 hover:bg-white/[0.08] hover:border-emerald-400/40 hover:-translate-y-1 transition-all duration-300 cursor-default overflow-hidden">
      {/* Subtle emerald gradient that appears on hover */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{
          background:
            "radial-gradient(80% 60% at 0% 0%, rgba(16,185,129,0.10) 0%, rgba(16,185,129,0) 60%)",
        }}
      />
      <div className="relative">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-emerald-400 font-mono text-sm group-hover:text-emerald-300 transition-colors duration-300">{n}</span>
          <h3 className="text-base font-semibold group-hover:text-white transition-colors duration-300">{title}</h3>
        </div>
        <p className="text-sm text-white/60 leading-relaxed group-hover:text-white/80 transition-colors duration-300">{body}</p>
      </div>
    </div>
  );
}

// ─── Trust strip ─────────────────────────────────────────────────────────
function TrustStrip() {
  return (
    <section className="bg-white border-t border-gray-100">
      <div className="max-w-7xl mx-auto px-6 py-10 grid grid-cols-2 md:grid-cols-4 gap-6">
        <TrustItem icon={<ShieldIcon />} title="Encrypted at rest" subtitle="Private Supabase buckets" />
        <TrustItem icon={<BoltIcon />} title="Real-time decisions" subtitle="< 2 second underwriting" />
        <TrustItem icon={<EyeIcon />} title="Explainable AI" subtitle="SHAP for every score" />
        <TrustItem icon={<LockIcon />} title="Policy-first" subtitle="FOIR · exposure · concurrency" />
      </div>
    </section>
  );
}

function TrustItem({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="group flex items-start gap-3 cursor-default">
      <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0 transition-all duration-300 group-hover:bg-emerald-500 group-hover:text-white group-hover:scale-110 group-hover:rotate-3">
        {icon}
      </div>
      <div>
        <p className="text-sm font-semibold text-gray-900 group-hover:text-emerald-700 transition-colors duration-300">{title}</p>
        <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
      </div>
    </div>
  );
}

// ─── Footer ──────────────────────────────────────────────────────────────
function Footer({ onSignIn, onSignUp }: { onSignIn: () => void; onSignUp: () => void }) {
  return (
    <footer className="border-t border-gray-100 bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-gray-500">
        <div className="flex items-center gap-2">
          <Logo size={24} />
          <span>© {new Date().getFullYear()} Saarthi. Built as a portfolio project.</span>
        </div>
        <div className="flex items-center gap-4">
          <a href="#features" className="hover:text-gray-900 transition-colors duration-200">Features</a>
          <button onClick={onSignUp} className="hover:text-gray-900 transition-colors duration-200">Sign up</button>
          <button onClick={onSignIn} className="hover:text-gray-900 transition-colors duration-200">Sign in</button>
        </div>
      </div>
    </footer>
  );
}

// ─── Icons ───────────────────────────────────────────────────────────────
function ArrowRightIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}
function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
function BoltIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}
function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
