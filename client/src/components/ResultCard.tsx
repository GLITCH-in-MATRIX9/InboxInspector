import type { VerificationResult } from "../types/email";

interface Props {
  result: VerificationResult;
}

export default function ResultCard({ result }: Props) {
  const { classification } = result;
  const flags = classification.flags;

  const valid = classification.category === "VALID";

  return (
    <section className="mt-12 rounded-3xl border border-zinc-800 bg-[#080808] p-10">

      {/* Header */}
      <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">

        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
            Verification Result
          </p>

          <h2 className="mt-2 break-all text-3xl font-semibold text-white">
            {result.email}
          </h2>
        </div>

        <div className="flex items-center gap-3 rounded-full border border-zinc-700 px-5 py-3">
          <span
            className={`h-3 w-3 rounded-full ${
              valid ? "bg-emerald-400" : "bg-red-400"
            }`}
          />

          <span className="text-sm font-medium tracking-wide text-white">
            {classification.category}
          </span>
        </div>

      </div>

      {/* Overview */}
      <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">

        <Info
          title="Confidence"
          value={`${classification.score}%`}
        />

        <Info
          title="Domain"
          value={result.domain}
        />

        <Info
          title="Response Time"
          value={`${result.elapsedMs} ms`}
        />

        <Info
          title="MX Server"
          value={result.mxHostUsed}
        />

      </div>

      {/* Checks */}

      <div className="mt-12">

        <h3 className="mb-6 text-lg font-medium tracking-wide text-white">
          Verification Checks
        </h3>

        <div className="grid gap-3 md:grid-cols-2">

          <Status title="Syntax Validation" status={flags.syntaxValid} />
          <Status title="MX Record Found" status={flags.mxFound} />
          <Status title="SMTP Connected" status={flags.smtpConnected} />
          <Status title="STARTTLS Enabled" status={flags.starttls} />
          <Status title="Mailbox Exists" status={flags.recipientAccepted} />
          <Status title="Catch-All Domain" status={flags.catchAll} />
          <Status title="Greylisted" status={flags.greylisted} />
          <Status title="Temporary Failure" status={flags.temporaryFailure} />
          <Status title="Request Timed Out" status={flags.timedOut} />

        </div>

      </div>

    </section>
  );
}

function Info({
  title,
  value,
}: {
  title: string;
  value: string | number;
}) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-black p-6 transition hover:border-zinc-600">

      <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
        {title}
      </p>

      <p className="mt-3 break-all text-xl font-semibold text-white">
        {value}
      </p>

    </div>
  );
}

function Status({
  title,
  status,
}: {
  title: string;
  status: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-zinc-800 bg-black px-5 py-4 transition hover:border-zinc-600">

      <span className="text-zinc-300">
        {title}
      </span>

      <div className="flex items-center gap-3">

        <span
          className={`h-2.5 w-2.5 rounded-full ${
            status
              ? "bg-emerald-400"
              : "bg-red-400"
          }`}
        />

        <span className="text-sm font-medium text-zinc-400">
          {status ? "Pass" : "Fail"}
        </span>

      </div>

    </div>
  );
}