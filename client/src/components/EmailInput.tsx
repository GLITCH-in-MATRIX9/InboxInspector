interface EmailInputProps {
  email: string;
  setEmail: (value: string) => void;
}

export default function EmailInput({
  email,
  setEmail,
}: EmailInputProps) {
  return (
    <div className="relative">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="absolute left-6 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-500 transition-colors duration-300"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.8}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21 8V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v1m18 0v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8m18 0-9 6-9-6"
        />
      </svg>

      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Enter recruiter email address..."
        className="
          w-full
          rounded-2xl
          border
          border-zinc-700
          bg-[#0A0A0A]
          py-5
          pl-16
          pr-6
          text-lg
          text-white
          placeholder:text-zinc-600
          shadow-[0_0_0_1px_rgba(255,255,255,0.02)]
          outline-none
          transition-all
          duration-300
          hover:border-zinc-500
          hover:shadow-[0_0_25px_rgba(255,255,255,0.04)]
          focus:border-white
          focus:shadow-[0_0_35px_rgba(255,255,255,0.08)]
        "
      />
    </div>
  );
}