import Link from "next/link";
import { NETWORK_NAME } from "@/config/arc";
import { CreatePaymentForm, type PaymentPrefill } from "@/components/CreatePaymentForm";

const STEPS = [
  { title: "Send", body: "Lock USDC for one recipient, or distribute it to many in a single airdrop." },
  { title: "Claim", body: "Each recipient claims their own allocation with their wallet." },
  { title: "Recover", body: "Anything left unclaimed after the deadline goes back to the sender." },
];

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const q = await searchParams;
  // "Resend" links pre-fill the form; the sender can edit everything before creating a NEW payment.
  const prefill: PaymentPrefill = {
    recipient: one(q.recipient),
    amount: one(q.amount),
    neverExpires: one(q.expiry) === "never",
  };
  const formKey = `${prefill.recipient ?? ""}|${prefill.amount ?? ""}|${prefill.neverExpires}`;

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_minmax(0,28rem)] lg:gap-14">
      <section className="lg:pt-6">
        <p className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
          ArcClaim · Live on {NETWORK_NAME}
        </p>
        <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">Programmable USDC Payments on Arc</h1>
        <p className="mt-4 max-w-lg text-lg leading-relaxed text-muted">
          Send USDC to one or many recipients. Let them claim their allocation, while unclaimed funds can be recovered
          after the deadline.
        </p>
        <p className="mt-3 text-sm font-medium text-fg/80">
          Send to one. Distribute to many. Let recipients claim. Recover what&apos;s unclaimed.
        </p>

        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <ActionCard href="#create" title="Send Payment" body="Send USDC to one recipient." primary />
          <ActionCard href="/airdrop" title="Create Airdrop" body="Distribute USDC to multiple recipients." />
        </div>

        <ol className="mt-10 space-y-5">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-4">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border bg-surface text-sm font-semibold tabular-nums">
                {i + 1}
              </span>
              <div>
                <h3 className="text-sm font-semibold">{s.title}</h3>
                <p className="mt-0.5 text-sm leading-relaxed text-muted">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section id="create" className="scroll-mt-24">
        <CreatePaymentForm key={formKey} prefill={prefill} />
      </section>
    </div>
  );
}

function ActionCard({ href, title, body, primary }: { href: string; title: string; body: string; primary?: boolean }) {
  return (
    <Link
      href={href}
      className={
        primary
          ? "group rounded-2xl bg-primary p-4 text-primary-fg transition-opacity hover:opacity-90"
          : "group rounded-2xl border border-border bg-surface p-4 transition-colors hover:bg-surface-2"
      }
    >
      <span className="flex items-center justify-between font-semibold">
        {title}
        <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
          →
        </span>
      </span>
      <span className={primary ? "mt-1 block text-sm opacity-80" : "mt-1 block text-sm text-muted"}>{body}</span>
    </Link>
  );
}
