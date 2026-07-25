export default function Header() {
  return (
    <header className="relative overflow-hidden border bg-gradient-to-b from-[#0f0f11] to-[#050505] px-10 py-14 shadow-2xl">

      {/* Background Glow */}
      <div className="absolute -top-32 left-1/2 h-72 w-72 -translate-x-1/2 bg-violet-600/10 blur-3xl" />

      <div className="relative z-10 text-center">

        {/* Small Badge */}
        <div className="mb-8 inline-flex items-center   bg-slate-900/70 px-4 py-2 backdrop-blur">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <span className="ml-3 text-xs font-medium uppercase tracking-[0.25em] text-slate-400">
            IGDTUW • Training & Placement Cell
          </span>
        </div>

        {/* Main Heading */}
        <h1 className="text-5xl font-black tracking-tight text-white md:text-7xl">
          EMAIL
          <br />
          <span className="text-slate-300">VERIFIER</span>
        </h1>

        {/* Divider */}
        <div className="mx-auto my-8 h-px w-28 bg-gradient-to-r from-transparent via-violet-500 to-transparent" />

        {/* Subtitle */}
        <p className="mx-auto max-w-3xl text-lg leading-8 text-slate-400">
          Enterprise-grade SMTP email verification for recruiter outreach.
          Validate mailbox existence, MX records, SMTP connectivity,
          STARTTLS support, and domain configuration with confidence scoring.
        </p>

        {/* Author Card */}
        <div className="mx-auto mt-10 inline-flex items-center gap-4  bg-slate-900/60 px-6 py-4 backdrop-blur">

          <div className="flex h-12 w-12 items-center justify-center  bg-gradient-to-br from-violet-600 to-purple-700 font-bold text-white">
            AD
          </div>

          <div className="text-left">
            <p className="font-semibold text-white">
              Anjali Dass
            </p>

            <p className="text-sm text-slate-400">
              CSE-1 • TNP MR Head
            </p>
          </div>

        </div>

      </div>

    </header>
  );
}