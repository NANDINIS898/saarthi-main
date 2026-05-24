import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiErrorMessage } from "../api/client";
import { useAuth } from "../store/auth";
import { Logo } from "../components/Logo";

export default function Login() {
  const navigate = useNavigate();
  const login = useAuth((s) => s.login);
  const loading = useAuth((s) => s.loading);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await login(email, password);
      navigate("/dashboard");
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-white rounded-2xl border border-gray-200 p-6 shadow-sm"
      >
        <div className="flex flex-col items-center mb-6">
          <Logo size={48} />
          <h1 className="text-xl font-semibold text-gray-900 mt-3">Welcome back</h1>
          <p className="text-sm text-gray-500 mt-1">Sign in to continue your loan application</p>
        </div>

        <label className="block text-sm text-gray-700 mb-1" htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#10b981] mb-4"
          placeholder="you@example.com"
        />

        <label className="block text-sm text-gray-700 mb-1" htmlFor="pw">Password</label>
        <input
          id="pw"
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#10b981] mb-4"
          placeholder="At least 8 characters"
        />

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-[#10b981] hover:bg-[#059669] disabled:opacity-50 text-white font-medium rounded-lg py-2.5 text-sm"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>

        <p className="text-sm text-gray-500 text-center mt-4">
          New to Saarthi?{" "}
          <Link to="/signup" className="text-[#10b981] font-medium hover:underline">
            Create an account
          </Link>
        </p>
      </form>
    </div>
  );
}
