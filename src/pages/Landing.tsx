import { Wordmark } from "@/components/Wordmark";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { motion } from "framer-motion";
import { ArrowRight, ArrowUpRight, CheckCircle2, Clock, MessageSquare, ShieldCheck } from "lucide-react";
import { Link } from "react-router";

const FEATURES = [
  {
    icon: ShieldCheck,
    title: "Approvals that stay on record",
    body: "Entries start pending and are settled by an admin with a decision that's written into the entry's thread.",
  },
  {
    icon: MessageSquare,
    title: "Discussion where the money is",
    body: "Each entry carries its own comment thread, so questions live next to the numbers they're about.",
  },
  {
    icon: Clock,
    title: "Your numbers, live",
    body: "A personal dashboard totals what you've filed and what's awaiting review — no refresh needed.",
  },
  {
    icon: CheckCircle2,
    title: "One ledger, one truth",
    body: "Money in and money out on a single timeline, with categories and notes instead of drifting spreadsheets.",
  },
];

const STEPS = [
  { k: "01", title: "File it", body: "Members log an entry: what it was for, the amount, and the category." },
  { k: "02", title: "Discuss it", body: "Anyone on the entry can ask questions right in the thread." },
  { k: "03", title: "Settle it", body: "An admin approves or rejects; the decision is stamped into the record." },
];

export default function Landing() {
  const { isLoading, isAuthenticated, user } = useAuth();
  const dashboardHref = user?.role === "admin" ? "/admin" : "/dashboard";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="min-h-screen bg-background text-foreground"
    >
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-6">
          <Wordmark />
          <div className="flex items-center gap-2">
            {isLoading ? null : isAuthenticated ? (
              <Button asChild className="rounded-full">
                <Link to={dashboardHref}>
                  Open Ledger
                  <ArrowRight className="ml-1.5 size-4" />
                </Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost" className="rounded-full">
                  <Link to="/auth?mode=signin">Sign in</Link>
                </Button>
                <Button asChild className="rounded-full">
                  <Link to="/auth?mode=signup">Get started</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="border-b border-border bg-card/50">
        <div className="mx-auto grid w-full max-w-5xl gap-10 px-6 py-20 lg:grid-cols-[1.2fr_1fr] lg:items-center lg:py-28">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Internal tool · our team
            </p>
            <h1 className="mt-4 max-w-xl text-balance font-serif text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
              Every dollar, neatly on the record.
            </h1>
            <p className="mt-5 max-w-md text-pretty text-base leading-7 text-muted-foreground">
              Ledger is how our team tracks money in and money out. Members
              file entries, discuss them in the open, and admins settle each
              one with a decision that stays on the record.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg" className="rounded-full">
                <Link to={isAuthenticated ? dashboardHref : "/auth?mode=signup"}>
                  {isAuthenticated ? "Open your dashboard" : "Create your account"}
                  <ArrowRight className="ml-2 size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="rounded-full">
                <Link to={isAuthenticated ? "/dashboard" : "/auth?mode=signin"}>
                  Sign in
                </Link>
              </Button>
            </div>
          </div>

          {/* Editorial stat stack */}
          <div className="flex flex-col gap-3">
            {[
              { label: "Open work", value: "21" },
              { label: "Awaiting review", value: "4" },
              { label: "Settled this month", value: "22%" },
            ].map(({ label, value }) => (
              <div
                key={label}
                className="rounded-2xl border border-border bg-card px-6 py-5"
              >
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  {label}
                </p>
                <p className="mt-1 font-serif text-3xl font-semibold">{value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto w-full max-w-5xl px-6 py-20">
        <h2 className="font-serif text-3xl font-semibold tracking-tight">
          What it does
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="rounded-2xl border border-border bg-card p-6 transition-colors hover:border-primary/40"
            >
              <div className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Icon className="size-4" />
              </div>
              <h3 className="mt-4 text-lg font-semibold">{title}</h3>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Flow */}
      <section className="border-y border-border bg-card/50">
        <div className="mx-auto w-full max-w-5xl px-6 py-20">
          <h2 className="font-serif text-3xl font-semibold tracking-tight">
            How an entry moves
          </h2>
          <div className="mt-8 grid gap-8 sm:grid-cols-3">
            {STEPS.map(({ k, title, body }) => (
              <div key={k}>
                <div className="font-serif text-sm text-primary">{k}</div>
                <h3 className="mt-2 text-lg font-semibold">{title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="mx-auto flex w-full max-w-5xl flex-col items-center px-6 py-20 text-center">
        <h2 className="max-w-md text-balance font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
          Keep the books clean without leaving the team.
        </h2>
        <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
          Sign in with your work email and you're in — the ledger is waiting.
        </p>
        <Button asChild size="lg" className="mt-8 rounded-full">
          <Link to={isAuthenticated ? dashboardHref : "/auth?mode=signup"}>
            {isAuthenticated ? "Go to Ledger" : "Get started"}
            <ArrowUpRight className="ml-2 size-4" />
          </Link>
        </Button>
      </section>

      <footer className="border-t border-border py-6">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 text-xs text-muted-foreground">
          <span>Ledger · internal use only</span>
          <Link to="/auth?mode=signin" className="hover:text-foreground">
            Team sign in
          </Link>
        </div>
      </footer>
    </motion.div>
  );
}
