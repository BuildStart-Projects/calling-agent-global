import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Check, ChevronsUpDown, Loader2, Pause, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { callFunction } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { SetupShell } from "@/features/setup/SetupShell";
import { useCatalogs, useChannelConfigs, useSaveChannel, type ChannelConfig } from "@/features/setup/hooks";
import { useAgentKnowledge } from "@/features/knowledge/useAgentKnowledge";

const STYLES: Array<{ key: ChannelConfig["persona_style"]; label: string; hint: string }> = [
  { key: "friendly", label: "Friendly & warm", hint: "A natural smile in the voice" },
  { key: "professional", label: "Professional & calm", hint: "Clear and composed" },
  { key: "energetic", label: "Energetic & upbeat", hint: "Positive, never loud" },
  { key: "reassuring", label: "Gentle & reassuring", hint: "Patient and kind" },
];
const FILTERS = ["all", "warm", "clear", "energetic", "deep", "professional"] as const;
const GRADIENTS = ["from-emerald-400 to-lime-300", "from-green-600 to-emerald-400", "from-lime-400 to-green-500", "from-teal-500 to-green-400", "from-green-700 to-lime-400"];

function words(text: string, locale: string) {
  try { return [...new Intl.Segmenter(locale, { granularity: "word" }).segment(text)].filter((s) => s.isWordLike).length; }
  catch { return text.trim().split(/\s+/).filter(Boolean).length; }
}

export default function VoicePage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data: catalogs } = useCatalogs();
  const { data: cfg } = useChannelConfigs(id);
  const { data: k } = useAgentKnowledge(id);
  const save = useSaveChannel(id);
  const calling = cfg?.calling;

  const [language, setLanguage] = useState<string>();
  const [voice, setVoice] = useState<string>();
  const [style, setStyle] = useState<ChannelConfig["persona_style"]>("friendly");
  const [adapt, setAdapt] = useState(true);
  const [greeting, setGreeting] = useState("");
  const [missed, setMissed] = useState("");
  const [sample, setSample] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [playing, setPlaying] = useState<string | null>(null);
  const [loadingVoice, setLoadingVoice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!calling) return;
    setLanguage((l) => l ?? calling.language);
    setVoice((v) => v ?? calling.voice_name ?? "Aoede");
    setStyle(calling.persona_style);
    setAdapt(calling.adapt_language);
    setGreeting((g) => g || calling.greeting || "");
    setMissed((m) => m || calling.missed_call_message || "");
  }, [calling]);

  const businessName = k?.blueprint.business?.name ?? "our business";
  useEffect(() => { if (!sample) setSample(`Hi! Thanks for calling ${businessName}. How can I help?`.split(/\s+/).slice(0, 10).join(" ")); }, [businessName, sample]);

  const wc = words(sample, language ?? "en");
  const voices = useMemo(() => (catalogs?.voices ?? []).filter((v) => filter === "all" || v.tags.includes(filter)), [catalogs, filter]);
  const langLabel = catalogs?.languages.find((l) => l.code === language);

  const play = async (name: string) => {
    if (playing === name) { audio.current?.pause(); setPlaying(null); return; }
    if (wc === 0 || wc > 10) { toast.error("Use up to 10 words for the preview."); return; }
    audio.current?.pause();
    setLoadingVoice(name);
    try {
      const res = await callFunction<{ url: string }>("voice-preview", { voice: name, language, style, text: sample });
      const a = new Audio(res.url);
      audio.current = a;
      a.onended = () => setPlaying(null);
      await a.play();
      setPlaying(name);
    } catch (e) {
      toast.error((e as Error).message || "Preview unavailable for this language. Try another.");
    } finally {
      setLoadingVoice(null);
    }
  };
  useEffect(() => () => audio.current?.pause(), []);

  const languageChanged = calling && language !== calling.language;
  const onContinue = async () => {
    if (!language || !voice) return;
    setSaving(true);
    try {
      await save("calling", {
        language, voice_name: voice, persona_style: style, adapt_language: adapt,
        // Changing language clears texts so they're re-written in the new language.
        greeting: languageChanged ? null : greeting || null, missed_call_message: languageChanged ? null : missed || null,
        ...(languageChanged ? { callback_greeting: null, off_topic_reply: null } : {}),
      });
      await callFunction("agent-compile", { agent_id: id });
      navigate(`/app/agents/${id}/messaging`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!calling || !catalogs) return <SetupShell agentId={id} step="voice" title="Choose a voice"><Skeleton className="h-96 rounded-2xl" /></SetupShell>;

  return (
    <SetupShell
      agentId={id} step="voice" title="How should your agent sound?"
      description="Pick the language callers hear first and the voice that fits your brand. Tap ▶ to hear each one."
      footer={<Button size="lg" onClick={onContinue} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Continue</Button>}
    >
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Default language</Label>
          <LanguagePicker value={language} onChange={setLanguage} languages={catalogs.languages} />
          <label className="flex items-start gap-3 pt-2 text-sm">
            <Switch checked={adapt} onCheckedChange={setAdapt} className="mt-0.5" />
            <span><span className="font-medium">Adapt to the caller's language</span><br /><span className="text-muted-foreground">Starts in {langLabel?.label ?? "your language"}, switches if the caller speaks another.</span></span>
          </label>
        </div>
        <div className="space-y-2">
          <Label htmlFor="sample">Preview text <span className={cn("ml-1 tabular", wc > 10 ? "text-destructive" : "text-muted-foreground")}>{wc}/10 words</span></Label>
          <Input id="sample" value={sample} onChange={(e) => setSample(e.target.value)} maxLength={120} aria-invalid={wc > 10} />
          <p className="text-xs text-muted-foreground">Type in any language — previews speak it in {langLabel?.label ?? "the selected language"}.</p>
        </div>
      </div>

      <div className="mt-8">
        <Label>Speaking style</Label>
        <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {STYLES.map((s) => (
            <button key={s.key} onClick={() => setStyle(s.key)} className={cn("rounded-xl border p-3 text-left transition-colors", style === s.key ? "border-brand-500 bg-accent" : "hover:bg-muted")}>
              <p className="text-sm font-medium">{s.label}</p>
              <p className="text-xs text-muted-foreground">{s.hint}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label>Voice</Label>
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={cn("rounded-full px-3 py-1 text-xs capitalize", filter === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground")}>{f}</button>
            ))}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {voices.map((v, i) => {
            const selected = voice === v.name;
            return (
              <motion.div key={v.name} layout className={cn("group relative flex items-center gap-3 rounded-xl border bg-card p-3 transition-colors", selected ? "border-brand-500 ring-2 ring-brand-500/30" : "hover:border-brand-500/40")}>
                <button onClick={() => setVoice(v.name)} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-pressed={selected}>
                  <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-sm font-semibold text-white", GRADIENTS[i % GRADIENTS.length])}>{v.display_name[0]}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{v.display_name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{v.descriptor}</span>
                  </span>
                </button>
                <button onClick={() => play(v.name)} aria-label={`Play ${v.display_name}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted transition-colors hover:bg-brand-500 hover:text-white">
                  {loadingVoice === v.name ? <Loader2 className="h-4 w-4 animate-spin" /> : playing === v.name ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>
                {selected && <Check className="absolute right-1.5 top-1.5 h-3.5 w-3.5 text-brand-600" />}
              </motion.div>
            );
          })}
        </div>
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="greet">Greeting when answering</Label>
          <Textarea id="greet" value={greeting} onChange={(e) => setGreeting(e.target.value)} rows={2} placeholder="Written for you in your language when you continue" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="missed">WhatsApp message after a missed call</Label>
          <Textarea id="missed" value={missed} onChange={(e) => setMissed(e.target.value)} rows={2} placeholder="Written for you in your language when you continue" />
        </div>
      </div>
    </SetupShell>
  );
}

function LanguagePicker({ value, onChange, languages }: { value?: string; onChange: (v: string) => void; languages: Array<{ code: string; label: string; native_label: string }> }) {
  const [open, setOpen] = useState(false);
  const current = languages.find((l) => l.code === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="h-11 w-full justify-between font-normal">
          {current ? <span>{current.native_label} <span className="text-muted-foreground">· {current.label}</span></span> : "Select a language"}
          <ChevronsUpDown className="h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search languages…" />
          <CommandList>
            <CommandEmpty>No language found.</CommandEmpty>
            <CommandGroup>
              {languages.map((l) => (
                <CommandItem key={l.code} value={`${l.label} ${l.native_label} ${l.code}`} onSelect={() => { onChange(l.code); setOpen(false); }}>
                  <Check className={cn("mr-2 h-4 w-4", value === l.code ? "opacity-100" : "opacity-0")} />
                  {l.native_label} <span className="ml-1 text-muted-foreground">· {l.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
