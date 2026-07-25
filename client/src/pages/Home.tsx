import { useState } from "react";

import Header from "../components/Header";
import EmailInput from "../components/EmailInput";
import VerifyButton from "../components/VerifyButton";
import ResultCard from "../components/ResultCard";
import FAQ from "../components/FAQ";
import Footer from "../components/Footer";

import { verifyEmail } from "../services/api";
import type { VerificationResult } from "../types/email";

export default function Home() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState("");

  const handleVerify = async () => {
    if (!email.trim()) {
      setError("Please enter an email address.");
      return;
    }

    try {
      setLoading(true);
      setError("");

      const response = await verifyEmail(email);

      setResult(response.data);
    } catch (err) {
      console.error(err);
      setResult(null);
      setError("Unable to verify email. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
  <main className="min-h-screen bg-[#050505]">

    {/* Full Width Header */}
    <Header />

    {/* Centered Content */}
    <section className="mx-auto max-w-4xl px-6 py-12 space-y-8">

      <EmailInput
        email={email}
        setEmail={setEmail}
      />

      <VerifyButton
        loading={loading}
        onClick={handleVerify}
      />

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-center text-red-300">
          {error}
        </div>
      )}

      {result && <ResultCard result={result} />}

      <FAQ />

      <Footer />

    </section>

  </main>
);
}