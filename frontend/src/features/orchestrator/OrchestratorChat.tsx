import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, ArrowDown, ArrowUp, CheckCircle2, FileText, Loader2, Paperclip, RotateCcw, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/brand/Logo";
import type { ChatMessage, DoneInfo, Readiness } from "./useOrchestrator";
import type { UploadItem } from "@/features/documents/useDocumentUpload";

type Props = {
  messages: ChatMessage[];
  streaming: boolean;
  stream: { text: string; question: { text: string; suggestions: string[]; index: number | null; max: number | null } | null; refused: string | null };
  readiness: Readiness | null;
  done: DoneInfo | null;
  error: string | null;
  onSend: (text: string | null, attachments: Array<{ id: string; filename: string }>) => void;
  onRetry: () => void;
  uploads: { items: UploadItem[]; add: (f: File[]) => void; remove: (k: string) => void; clearReady: () => void; ready: Array<{ id: string; filename: string }>; busy: boolean };
  placeholder?: string;
  starterChips?: string[];
  doneCard?: React.ReactNode;
  showQuestionCounter?: boolean;
};

export function OrchestratorChat(p: Props) {
  const [text, setText] = useState("");
  const [dragging, setDragging] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const [stuckToBottom, setStuckToBottom] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (stuckToBottom) scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [p.messages, p.stream, p.done, stuckToBottom]);

  const lastAssistant = [...p.messages].reverse().find((m) => m.role === "assistant");
  const suggestions = p.streaming ? [] : lastAssistant?.suggestions ?? [];
  const canSend = (text.trim().length > 0 || p.uploads.ready.length > 0) && !p.streaming && !p.uploads.busy;

  const submit = (value?: string) => {
    const v = (value ?? text).trim();
    if (!v && !p.uploads.ready.length) return;
    p.onSend(v || null, p.uploads.ready);
    p.uploads.clearReady();
    setText("");
    setStuckToBottom(true);
  };

  return (
    <div
      className="relative flex h-full min-h-0 flex-col"
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); p.uploads.add([...e.dataTransfer.files]); }}
    >
      <AnimatePresence>
        {dragging && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-2 z-20 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-brand-500 bg-background/90 backdrop-blur">
            <FileText className="h-8 w-8 text-brand-600" />
            <p className="mt-2 font-medium">Drop your price list, menu or brochure</p>
            <p className="text-sm text-muted-foreground">PDF, photo, Word or text · up to 10 MB</p>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          setStuckToBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
        }}
        className="flex-1 space-y-4 overflow-y-auto px-4 py-6 sm:px-6"
        aria-live="polite"
      >
        {p.messages.map((m) => <Bubble key={m.id} m={m} showIndex={p.showQuestionCounter} max={p.readiness?.max_questions} />)}

        {p.streaming && (
          <div className="flex gap-3">
            <AssistantAvatar />
            <div className="min-w-0 max-w-[85%] space-y-2">
              {p.stream.refused ? (
                <div className="rounded-2xl rounded-tl-md bg-muted px-4 py-3 text-sm">{p.stream.refused}</div>
              ) : p.stream.text || p.stream.question ? (
                <div className="rounded-2xl rounded-tl-md border bg-card px-4 py-3 text-sm leading-relaxed shadow-sm">
                  <span className="whitespace-pre-wrap">{p.stream.text}</span>
                  {p.stream.question && <p className="mt-2 font-medium">{p.stream.question.text}</p>}
                  <span className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse rounded-sm bg-brand-500" />
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-2xl rounded-tl-md border bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">
                  <span className="flex gap-1">{[0, 1, 2].map((i) => <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-brand-500" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: i * 0.15 }} />)}</span>
                  Thinking…
                </div>
              )}
            </div>
          </div>
        )}

        {p.done && p.doneCard}

        {p.error && (
          <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="flex-1">{p.error}</div>
            <Button size="sm" variant="outline" onClick={p.onRetry}><RotateCcw className="mr-1 h-3.5 w-3.5" />Retry</Button>
          </div>
        )}
      </div>

      {!stuckToBottom && (
        <button onClick={() => { setStuckToBottom(true); scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }}
          className="absolute bottom-36 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border bg-background px-3 py-1.5 text-xs shadow-soft">
          <ArrowDown className="h-3.5 w-3.5" /> New messages
        </button>
      )}

      <div className="border-t bg-background/80 px-3 pb-3 pt-2 backdrop-blur sm:px-5">
        {(suggestions.length > 0 || (p.starterChips?.length && p.messages.length === 0)) && (
          <div className="mb-2 flex flex-wrap gap-2">
            {(suggestions.length ? suggestions : p.starterChips ?? []).map((s) => (
              <button key={s} onClick={() => submit(s)} className="rounded-full border bg-card px-3 py-1.5 text-sm shadow-sm transition-colors hover:border-brand-500/60 hover:bg-accent">{s}</button>
            ))}
            {suggestions.length > 0 && p.showQuestionCounter && (
              <button onClick={() => submit("Skip for now — I'll add this later.")} className="rounded-full px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">Skip for now</button>
            )}
          </div>
        )}

        {p.uploads.items.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {p.uploads.items.map((u) => (
              <div key={u.key} className={cn("flex max-w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs", u.status === "failed" && "border-destructive/40 bg-destructive/5", u.status === "ready" && "border-brand-500/40 bg-accent")}>
                {u.status === "ready" ? <CheckCircle2 className="h-3.5 w-3.5 text-brand-600" /> : u.status === "failed" ? <AlertCircle className="h-3.5 w-3.5 text-destructive" /> : <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span className="max-w-[140px] truncate font-medium">{u.filename}</span>
                <span className="truncate text-muted-foreground">· {u.label}{u.pct != null && u.status === "reading" ? ` ${Math.round(u.pct)}%` : ""}</span>
                <button onClick={() => p.uploads.remove(u.key)} aria-label="Remove file" className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2 rounded-2xl border bg-card p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring">
          <input ref={fileInput} type="file" multiple hidden accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.docx,.txt" onChange={(e) => { p.uploads.add([...(e.target.files ?? [])]); e.target.value = ""; }} />
          <Button variant="ghost" size="icon" className="shrink-0" onClick={() => fileInput.current?.click()} aria-label="Attach a file"><Paperclip className="h-5 w-5" /></Button>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const files = [...e.clipboardData.files];
              if (files.length) { e.preventDefault(); p.uploads.add(files); }
            }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (canSend) submit(); } }}
            placeholder={p.placeholder ?? "Type your answer…"}
            rows={1}
            className="max-h-40 min-h-[40px] flex-1 resize-none border-0 bg-transparent px-1 py-2 shadow-none focus-visible:ring-0"
          />
          <Button size="icon" className="shrink-0 rounded-xl" disabled={!canSend} onClick={() => submit()} aria-label="Send">
            {p.streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </Button>
        </div>
        <p className="mt-1.5 text-center text-[11px] text-muted-foreground">Drop a price list or menu to save typing · Enter to send</p>
      </div>
    </div>
  );
}

function AssistantAvatar() {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border bg-card shadow-sm">
      <Logo variant="icon" className="h-5 w-5" />
    </div>
  );
}

function Bubble({ m, showIndex, max }: { m: ChatMessage; showIndex?: boolean; max?: number }) {
  if (m.role === "user") {
    return (
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end">
        <div className="max-w-[85%] space-y-1.5">
          {m.attachments?.map((a) => (
            <div key={a.id} className="ml-auto flex w-fit items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1 text-xs"><FileText className="h-3.5 w-3.5 text-brand-600" />{a.filename}</div>
          ))}
          {m.content && <div className="whitespace-pre-wrap rounded-2xl rounded-tr-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">{m.content}</div>}
        </div>
      </motion.div>
    );
  }
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3">
      <AssistantAvatar />
      <div className="min-w-0 max-w-[85%] space-y-1.5">
        {showIndex && m.questionIndex ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-foreground">
            <Sparkles className="h-3 w-3" /> Question {m.questionIndex}{max ? ` of up to ${max}` : ""}
          </span>
        ) : null}
        <div className={cn("whitespace-pre-wrap rounded-2xl rounded-tl-md px-4 py-3 text-sm leading-relaxed", m.refused ? "bg-muted text-muted-foreground" : "border bg-card shadow-sm")}>
          {m.content}
        </div>
      </div>
    </motion.div>
  );
}
