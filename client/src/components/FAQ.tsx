export default function FAQ() {
  const faqs = [
    {
      question: "What is Syntax Validation?",
      answer:
        "Syntax validation checks whether an email follows the correct format (for example: name@example.com). It does not confirm that the mailbox actually exists.",
    },
    {
      question: "What is an MX Record?",
      answer:
        "An MX (Mail Exchange) record is a DNS record that specifies which mail server receives email for a domain. Without a valid MX record, a domain cannot receive emails.",
    },
    {
      question: "What is SMTP Connection?",
      answer:
        "SMTP (Simple Mail Transfer Protocol) is the standard protocol for sending email. Establishing an SMTP connection confirms that the destination mail server is reachable.",
    },
    {
      question: "What is STARTTLS?",
      answer:
        "STARTTLS upgrades an SMTP connection to an encrypted channel, protecting email communication while it is transmitted.",
    },
    {
      question: "What does Mailbox Exists mean?",
      answer:
        "The destination mail server confirmed that the specified mailbox exists and is capable of receiving emails.",
    },
    {
      question: "What is a Catch-All Domain?",
      answer:
        "A catch-all domain accepts email sent to any address within the domain. This makes definitive mailbox verification more difficult.",
    },
    {
      question: "What is Greylisting?",
      answer:
        "Greylisting is an anti-spam technique where a server temporarily rejects a message on the first attempt, expecting legitimate mail servers to retry automatically.",
    },
    {
      question: "What is a Temporary Failure?",
      answer:
        "Temporary failures occur when verification cannot be completed because of rate limiting, server overload, maintenance, or transient network issues.",
    },
    {
      question: "What does Request Timed Out mean?",
      answer:
        "The mail server did not respond within the allotted verification time window.",
    },
    {
      question: "What is the Confidence Score?",
      answer:
        "The confidence score estimates how reliable the verification result is based on all validation checks performed.",
    },
    {
      question: "What is the Response Time?",
      answer:
        "Response time measures the total duration required to complete the verification process.",
    },
    {
      question: "Why is an email marked INVALID?",
      answer:
        "An email may be marked invalid because the address format is incorrect, the domain lacks mail servers, the mailbox does not exist, or the receiving SMTP server rejected it.",
    },
  ];

  return (
    <section className="mt-20">
      <div className="mb-10">
        <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
          Documentation
        </p>

        <h2 className="mt-3 text-4xl font-semibold text-white">
          Email Verification Guide
        </h2>

        <p className="mt-4 max-w-3xl text-zinc-400">
          Learn how each verification step works and understand the meaning of
          the results displayed above.
        </p>
      </div>

      <div className="overflow-hidden rounded-3xl border border-zinc-800 bg-[#080808]">

        {faqs.map((faq, index) => (
          <details
            key={index}
            className="group border-b border-zinc-800 last:border-none"
          >
            <summary className="flex cursor-pointer items-center justify-between px-8 py-6 transition hover:bg-zinc-900/40">

              <span className="text-lg font-medium text-white">
                {faq.question}
              </span>

              <span className="text-2xl font-light text-zinc-500 transition duration-300 group-open:rotate-45">
                +
              </span>

            </summary>

            <div className="px-8 pb-7 pr-16 leading-8 text-zinc-400">
              {faq.answer}
            </div>

          </details>
        ))}

      </div>
    </section>
  );
}