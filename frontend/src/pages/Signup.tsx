import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiErrorMessage } from "../api/client";
import { useAuth } from "../store/auth";
import { Logo } from "../components/Logo";

export default function Signup() {
  const navigate = useNavigate();
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

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await signup({
        full_name: form.full_name,
        email: form.email,
        phone: form.phone || undefined,
        password: form.password,
      });
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
          <h1 className="text-xl font-semibold text-gray-900 mt-3">Create your account</h1>
          <p className="text-sm text-gray-500 mt-1">Get a loan decision in 5 minutes</p>
        </div>

        <label className="block text-sm text-gray-700 mb-1" htmlFor="name">Full name</label>
        <input
          id="name"
          required
          minLength={2}
          value={form.full_name}
          onChange={field("full_name")}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#6C63FF] mb-4"
          placeholder="Arjun Mehta"
        />

        <label className="block text-sm text-gray-700 mb-1" htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          required
          value={form.email}
          onChange={field("email")}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#6C63FF] mb-4"
          placeholder="you@example.com"
        />

        <label className="block text-sm text-gray-700 mb-1" htmlFor="phone">Phone <span className="text-gray-400">(optional)</span></label>
        <input
          id="phone"
          value={form.phone}
          onChange={field("phone")}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#6C63FF] mb-4"
          placeholder="+91…"
        />

        <label className="block text-sm text-gray-700 mb-1" htmlFor="pw">Password</label>
        <input
          id="pw"
          type="password"
          required
          minLength={8}
          value={form.password}
          onChange={field("password")}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#6C63FF] mb-4"
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
          className="w-full bg-[#6C63FF] hover:bg-[#5a52d6] disabled:opacity-50 text-white font-medium rounded-lg py-2.5 text-sm"
        >
          {loading ? "Creating account…" : "Create account"}
        </button>

        <p className="text-sm text-gray-500 text-center mt-4">
          Already have an account?{" "}
          <Link to="/login" className="text-[#6C63FF] font-medium hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
