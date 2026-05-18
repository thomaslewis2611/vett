import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Send, Sparkles, User } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { chatAboutProperty, type ChatMessage } from "@/lib/chat.functions";
import type { AnalysisResult } from "@/lib/analysis.types";
import { supabase } from "@/integrations/supabase/client";

const mdComponents = {
  h2: ({ children }: any) => (
    <h2 style={{ fontSize: 14, fontWeight: 500, color: "#1A1108", marginBottom: 6 }}>{children}</h2>
  ),
  h3: ({ children }: any) => (
    <h3 style={{ fontSize: 14, fontWeight: 500, color: "#1A1108", marginBottom: 6 }}>{children}</h3>
  ),
  strong: ({ children }: any) => (
    <strong style={{ fontWeight: 500, color: "#1A1108" }}>{children}</strong>
  ),
  p: ({ children }: any) => (
    <p style={{ fontSize: 13, color: "#1A1108", lineHeight: 1.6, marginBottom: 8 }}>{children}</p>
  ),
  ul: ({ children }: any) => (
    <ul style={{ fontSize: 13, color: "#1A1108", lineHeight: 1.6, paddingLeft: 16, marginBottom: 8, listStyle: "disc" }}>{children}</ul>
  ),
  ol: ({ children }: any) => (
    <ol style={{ fontSize: 13, color: "#1A1108", lineHeight: 1.6, paddingLeft: 16, marginBottom: 8, listStyle: "decimal" }}>{children}</ol>
  ),
  li: ({ children }: any) => (
    <li style={{ fontSize: 13, color: "#1A1108", lineHeight: 1.6 }}>{children}</li>
  ),
};

const STARTERS = [
  "Is this a fair price for the area?",
  "What should I offer?",
  "What are the biggest risks with this property?",
  "What questions should I prioritise at the viewing?",
];

export function PropertyChat({ analysis }: { analysis: AnalysisResult }) {
  const chatFn = useServerFn(chatAboutProperty);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isSending]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;
    setError(null);
    const next: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setInput("");
    setIsSending(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const sessionJwt = sess.session?.access_token ?? "";
      if (!sessionJwt) {
        setError("Please sign in to use chat.");
        return;
      }
      const { reply } = await chatFn({ data: { analysis, messages: next, sessionJwt } });
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (err) {
      const msg = (err as Error)?.message || "Chat failed";
      setError(msg.replace(/^[A-Z_]+:\s*/, ""));
    } finally {
      setIsSending(false);
    }
  }

  const showStarters = messages.length === 0;

  return (
    <div className="rounded-3xl border border-border bg-card shadow-card">
      <div className="flex items-center gap-2 border-b border-border px-5 py-4">
        <div
          className="flex h-7 w-7 items-center justify-center rounded-full text-primary-foreground"
          style={{ background: "var(--gradient-primary)" }}
        >
          <Sparkles className="h-3.5 w-3.5" />
        </div>
        <div>
          <h3 className="text-base font-semibold tracking-tight">Ask vett AI</h3>
          <p className="text-xs text-muted-foreground">
            Tailored to this property — knows the address, price, red flags and costs.
          </p>
        </div>
      </div>

      <div ref={scrollRef} className="max-h-[480px] overflow-y-auto px-5 py-5">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ask anything about this property — value, risks, negotiation, viewing prep.
          </p>
        ) : (
          <ul className="space-y-4">
            {messages.map((m, i) => (
              <li key={i} className="flex items-start gap-3">
                {m.role === "assistant" ? (
                  <div
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-primary-foreground"
                    style={{ background: "var(--gradient-primary)" }}
                  >
                    AI
                  </div>
                ) : (
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                )}
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    m.role === "assistant"
                      ? "bg-muted text-foreground"
                      : "bg-primary text-primary-foreground whitespace-pre-wrap"
                  }`}
                >
                  {m.role === "assistant" ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                      {m.content}
                    </ReactMarkdown>
                  ) : (
                    m.content
                  )}
                </div>
              </li>
            ))}
            {isSending && (
              <li className="flex items-start gap-3">
                <div
                  className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-primary-foreground"
                  style={{ background: "var(--gradient-primary)" }}
                >
                  AI
                </div>
                <div className="rounded-2xl bg-muted px-4 py-3">
                  <TypingDots />
                </div>
              </li>
            )}
          </ul>
        )}

        {showStarters && (
          <div className="mt-5 flex flex-wrap gap-2">
            {STARTERS.map((q) => (
              <button
                key={q}
                onClick={() => send(q)}
                disabled={isSending}
                className="rounded-full border border-border bg-background px-3.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {error && (
          <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex items-center gap-2 border-t border-border p-3"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about price, risks, negotiation…"
          disabled={isSending}
          className="flex-1 rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isSending || !input.trim()}
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          aria-label="Send"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1">
      <Dot delay="0ms" />
      <Dot delay="150ms" />
      <Dot delay="300ms" />
    </span>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground"
      style={{ animationDelay: delay }}
    />
  );
}
