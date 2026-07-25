import { useEffect, useState } from "react";

interface VerifyButtonProps {
  loading: boolean;
  onClick: () => void;
}

const messages = [
  "Starting verification...",
  "Checking mail server...",
  "Verifying mailbox...",
  "Almost done...",
  "Just finishing up...",
];

export default function VerifyButton({
  loading,
  onClick,
}: VerifyButtonProps) {
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    if (!loading) {
      setMessageIndex(0);
      return;
    }

    const interval = setInterval(() => {
      setMessageIndex((prev) =>
        prev < messages.length - 1 ? prev + 1 : prev
      );
    }, 2000);

    return () => clearInterval(interval);
  }, [loading]);

  return (
    <div className="w-full">
      <button
        onClick={onClick}
        disabled={loading}
        className="
          flex
          w-full
          items-center
          justify-center
          gap-3
          rounded-2xl
          border
          border-zinc-700
          bg-black
          px-6
          py-5
          text-base
          font-medium
          tracking-wide
          text-white
          transition-all
          duration-300
          hover:border-zinc-400
          hover:bg-zinc-950
          hover:shadow-[0_0_25px_rgba(255,255,255,0.05)]
          active:scale-[0.99]
          disabled:cursor-not-allowed
          disabled:opacity-50
        "
      >
        {loading ? (
          <>
            <svg
              className="h-5 w-5 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="3"
                className="text-zinc-700"
              />
              <path
                d="M22 12a10 10 0 0 1-10 10"
                stroke="white"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>

            Verifying...
          </>
        ) : (
          <>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12l2 2 4-4m6-2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>

            Verify Email
          </>
        )}
      </button>

      {loading && (
        <p className="mt-4 text-center text-sm text-zinc-400 transition-all duration-500">
          {messages[messageIndex]}
        </p>
      )}
    </div>
  );
}