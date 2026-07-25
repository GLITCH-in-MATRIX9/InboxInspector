export default function Footer() {
  return (
    <footer className="mt-24 border-t border-zinc-800">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-8 px-8 py-10 text-center md:flex-row md:text-left">

        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
            IGDTUW • Training & Placement Cell
          </p>

          <h3 className="mt-2 text-lg font-semibold text-white">
            Email Verifier
          </h3>

          <p className="mt-3 text-sm leading-6 text-zinc-500">
            Designed & Developed by{" "}
            <span className="font-medium text-zinc-300">
              Anjali Dass
            </span>
            <br />
            Computer Science Engineering • CSE-1
          </p>
        </div>

        <div className="flex flex-col items-center gap-3 md:items-end">

          <a
            href="mailto:anjalidass100@gmail.com?subject=IGDTUW Email Verifier"
            className="
              text-sm
              font-medium
              text-zinc-400
              transition
              duration-300
              hover:text-white
            "
          >
            anjalidass100@gmail.com
          </a>

          <p className="text-xs tracking-wide text-zinc-600">
            © {new Date().getFullYear()} IGDTUW Email Verifier
          </p>

        </div>

      </div>
    </footer>
  );
}