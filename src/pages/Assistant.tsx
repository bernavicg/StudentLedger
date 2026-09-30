import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import { useAction, useQuery } from "convex/react";
import { Bot, Send, Sparkles, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Message = { role: "user" | "assistant"; text: string };

const SUGGESTIONS = [
  "Which students attended most recently?",
  "How many sessions does each student have left?",
  "Who has marks still waiting for review?",
  "Summarize attendance for the last two weeks.",
];

/** Per-student chat focus: the AI then answers from one student's history. */
type StudentOption = { _id: string; name: string };

function StudentFocus({
  students,
  activeId,
  onPick,
}: {
  students: StudentOption[];
  activeId: string | null;
  onPick: (id: string | null) => void;
}) {
  if (students.length === 0) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        Focus:
      </span>
      <button
        type="button"
        onClick={() => onPick(null)}
        className={cn(
          "rounded-full px-3 py-1 text-xs transition-colors",
          activeId === null
            ? "bg-primary font-medium text-primary-foreground"
            : "border border-border text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        All students
      </button>
      {students.slice(0, 12).map((student) => (
        <button
          key={student._id}
          type="button"
          onClick={() => onPick(student._id)}
          className={cn(
            "max-w-[12rem] truncate rounded-full px-3 py-1 text-xs transition-colors",
            activeId === student._id
              ? "bg-primary font-medium text-primary-foreground"
              : "border border-border text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {student.name}
        </button>
      ))}
    </div>
  );
}

/**
 * AI Agent page: ask questions about attendance in plain language.
 * Answers come from the checkAttendance action, which feeds the model the
 * real roster + attendance data so it never invents numbers.
 */
export default function Assistant() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const checkAttendance = useAction(api.attendance.ask);
  const roster = useQuery(api.students.list) ?? [];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, pending]);

  const send = async (raw: string) => {
    const question = raw.trim();
    if (!question || pending) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", text: question }]);
    setPending(true);

    try {
      const res = await checkAttendance({
        question,
        studentId: focusId ?? undefined,
      });
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: res.success
            ? (res.answer ?? "Walay tubag nga nadawat.")
            : (res.error ?? "Something went wrong."),
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: "Naay problema sa pag-connect sa server. Sulayi pag-usab.",
        },
      ]);
    } finally {
      setPending(false);
    }
  };

  return (
    <AppShell active="assistant">
      <div className="mx-auto flex w-full max-w-3xl flex-col px-6 py-8 sm:py-10">
        {/* Header */}
        <div>
          <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            <Sparkles className="size-3.5" />
            AI Agent
          </p>
          <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
            Attendance Assistant
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Pangutana bahin sa attendance sa estudyante gamit ang ordinaryong
            pinulongan. Ang tubag gikan sa tinuod nga datos sa ledger.
          </p>
          <StudentFocus
            students={roster.map((s) => ({ _id: s._id, name: s.name }))}
            activeId={focusId}
            onPick={setFocusId}
          />
        </div>

        {/* Chat */}
        <div className="mt-6 flex min-h-[26rem] flex-col rounded-2xl border border-border bg-card shadow-none">
          <div
            ref={scrollRef}
            className="scrollbar-thin flex-1 space-y-4 overflow-y-auto p-5"
          >
            {messages.length === 0 && !pending ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 py-10 text-center">
                <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
                  <Bot className="size-6 text-primary" />
                </div>
                <p className="font-serif text-lg font-semibold">
                  Unsa ang pangutana nimo?
                </p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Pananglitan:
                </p>
                <div className="flex max-w-md flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => void send(suggestion)}
                      className="rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((message, index) => (
                <div
                  key={index}
                  className={
                    message.role === "user"
                      ? "flex items-start justify-end gap-3"
                      : "flex items-start gap-3"
                  }
                >
                  {message.role === "assistant" && (
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                      <Bot className="size-4 text-primary" />
                    </div>
                  )}
                  <div
                    className={
                      message.role === "user"
                        ? "max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground"
                        : "max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-tl-sm border border-border bg-background px-4 py-2.5 text-sm"
                    }
                  >
                    {message.text}
                  </div>
                  {message.role === "user" && (
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                      <User className="size-4 text-muted-foreground" />
                    </div>
                  )}
                </div>
              ))
            )}
            {pending && (
              <div className="flex items-start gap-3">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Bot className="size-4 text-primary" />
                </div>
                <div className="rounded-2xl rounded-tl-sm border border-border bg-background px-4 py-2.5 text-sm text-muted-foreground">
                  <span className="animate-pulse">Gisusi ang records…</span>
                </div>
              </div>
            )}
          </div>

          {/* Composer */}
          <form
            className="flex gap-2 border-t border-border p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void send(input);
            }}
          >
            <Input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="I-type imong pangutana bahin sa attendance…"
              disabled={pending}
              className="rounded-full"
            />
            <Button
              type="submit"
              size="icon"
              className="size-10 shrink-0 rounded-full"
              disabled={pending || input.trim().length === 0}
            >
              <Send className="size-4" />
            </Button>
          </form>
        </div>
      </div>
    </AppShell>
  );
}
