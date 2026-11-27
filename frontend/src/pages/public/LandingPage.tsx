import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight, Bell, CalendarCheck, Check, Globe2, Headphones, Megaphone, MessageCircle, Mic, Phone, PhoneIncoming,
  QrCode, ShoppingBag, Sparkles, Target, UserRound, Wrench, Scissors, Stethoscope, Utensils, Store, Smile, Menu, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Logo } from "@/components/brand/Logo";
import { PricingCards } from "@/features/billing/PricingCards";
import { cn } from "@/lib/utils";

const fadeUp = {
  initial: { opacity: 0, y: 18 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-60px" },
  transition: { duration: 0.45, ease: "easeOut" },
} as const;

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-white text-ink">
      <Nav />
      <Hero />
      <Industries />
      <HowItWorks />
      <Features />
      <CampaignBand />
      <Pricing />
      <Faq />
      <FinalCta />
      <Footer />
    </div>
  );
}

function Nav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const links = [
    ["#features", "Features"],
    ["#how", "How it works"],
    ["#pricing", "Pricing"],
    ["#faq", "FAQ"],
  ];
  return (
    <header className={cn("sticky top-0 z-50 transition-all", scrolled ? "border-b bg-white/85 backdrop-blur" : "bg-transparent")}>
      <div className="container flex h-16 items-center gap-6">
        <Link to="/" aria-label="BuildStart home"><Logo tone="light" className="h-7" /></Link>
        <nav className="hidden items-center gap-6 text-sm font-medium text-neutral-600 md:flex">
          {links.map(([href, label]) => <a key={href} href={href} className="hover:text-ink">{label}</a>)}
        </nav>
        <div className="ml-auto hidden items-center gap-2 md:flex">
          <Button asChild variant="ghost"><Link to="/login">Log in</Link></Button>
          <Button asChild className="bg-brand-gradient text-white shadow-glow hover:opacity-95">
            <Link to="/signup">Start free <ArrowRight className="ml-1 h-4 w-4" /></Link>
          </Button>
        </div>
        <Button variant="ghost" size="icon" className="ml-auto md:hidden" onClick={() => setOpen((v) => !v)} aria-label="Menu">
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-b bg-white md:hidden">
            <div className="container flex flex-col gap-1 py-3">
              {links.map(([href, label]) => (
                <a key={href} href={href} onClick={() => setOpen(false)} className="rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-neutral-50">{label}</a>
              ))}
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button asChild variant="outline"><Link to="/login">Log in</Link></Button>
                <Button asChild className="bg-brand-gradient text-white"><Link to="/signup">Start free</Link></Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-[640px] bg-brand-radial" />
      <div className="container relative grid items-center gap-12 pb-20 pt-12 lg:grid-cols-[1.1fr_0.9fr] lg:pb-28 lg:pt-20">
        <motion.div {...fadeUp}>
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
            <Sparkles className="h-3.5 w-3.5" /> AI calling + messaging agents for WhatsApp
          </span>
          <h1 className="mt-5 text-[40px] font-semibold leading-[1.05] sm:text-6xl lg:text-[68px]">
            Your AI receptionist on WhatsApp.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-neutral-600">
            Answers every call. Replies to every message. Books appointments, takes orders and calls your leads back — 24/7, in your customers' language.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg" className="h-12 bg-brand-gradient px-6 text-base text-white shadow-glow hover:opacity-95">
              <Link to="/signup">Create your agent free <ArrowRight className="ml-2 h-5 w-5" /></Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-12 px-6 text-base">
              <a href="#how"><Headphones className="mr-2 h-5 w-5" /> See how it works</a>
            </Button>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-neutral-600">
            {["Live in 10 minutes", "No card required", "Just scan a QR code"].map((t) => (
              <span key={t} className="inline-flex items-center gap-1.5"><Check className="h-4 w-4 text-brand-600" />{t}</span>
            ))}
          </div>
        </motion.div>
        <motion.div {...fadeUp} transition={{ ...fadeUp.transition, delay: 0.1 }} className="relative mx-auto w-full max-w-[380px]">
          <PhoneMock />
        </motion.div>
      </div>
    </section>
  );
}

const SCENES = ["call", "chat", "booked"] as const;

function PhoneMock() {
  const [scene, setScene] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setScene((s) => (s + 1) % SCENES.length), 3800);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="relative">
      <div className="absolute -inset-6 -z-10 rounded-[48px] bg-brand-gradient opacity-25 blur-3xl" />
      <div className="rounded-[42px] border-[10px] border-neutral-900 bg-neutral-900 shadow-2xl">
        <div className="relative h-[560px] overflow-hidden rounded-[32px] bg-[#0b141a]">
          <div className="absolute left-1/2 top-2 z-10 h-6 w-28 -translate-x-1/2 rounded-full bg-black" />
          <AnimatePresence mode="wait">
            {SCENES[scene] === "call" && <CallScene key="call" />}
            {SCENES[scene] === "chat" && <ChatScene key="chat" />}
            {SCENES[scene] === "booked" && <BookedScene key="booked" />}
          </AnimatePresence>
        </div>
      </div>
      <motion.div animate={{ y: [0, -6, 0] }} transition={{ repeat: Infinity, duration: 5 }} className="absolute -left-10 top-24 hidden rounded-2xl border bg-white p-3 shadow-soft sm:block">
        <div className="flex items-center gap-2 text-sm font-medium"><Megaphone className="h-4 w-4 text-brand-600" />Campaign · 64/100 called</div>
        <div className="mt-2 h-1.5 w-44 rounded-full bg-neutral-100"><div className="h-full w-[64%] rounded-full bg-brand-gradient" /></div>
      </motion.div>
      <motion.div animate={{ y: [0, 6, 0] }} transition={{ repeat: Infinity, duration: 6 }} className="absolute -right-8 bottom-24 hidden rounded-2xl border bg-white p-3 shadow-soft sm:block">
        <div className="flex items-center gap-2 text-sm font-medium"><CalendarCheck className="h-4 w-4 text-brand-600" />New booking · Tue 3:00 PM</div>
      </motion.div>
    </div>
  );
}

const scene = { initial: { opacity: 0, scale: 0.98 }, animate: { opacity: 1, scale: 1 }, exit: { opacity: 0 }, transition: { duration: 0.35 } };

function CallScene() {
  return (
    <motion.div {...scene} className="flex h-full flex-col items-center justify-between bg-gradient-to-b from-[#0f2a17] to-[#0b141a] px-6 pb-14 pt-20 text-white">
      <div className="text-center">
        <p className="text-sm text-white/60">WhatsApp voice call</p>
        <div className="mx-auto mt-6 flex h-24 w-24 items-center justify-center rounded-full bg-white/10 animate-pulse-ring">
          <UserRound className="h-12 w-12 text-white/80" />
        </div>
        <p className="mt-5 text-xl font-semibold">Sarah Johnson</p>
        <p className="text-sm text-brand-300">AI agent answering…</p>
      </div>
      <div className="flex h-16 items-end gap-1">
        {Array.from({ length: 24 }).map((_, i) => (
          <motion.span
            key={i}
            className="w-1.5 rounded-full bg-brand-300"
            animate={{ height: [8, 14 + ((i * 7) % 40), 8] }}
            transition={{ repeat: Infinity, duration: 0.9 + (i % 5) * 0.12, ease: "easeInOut" }}
          />
        ))}
      </div>
      <div className="rounded-2xl bg-white/10 px-4 py-3 text-center text-sm text-white/90">
        "Hi Sarah! Thanks for calling Bella Salon. How can I help today?"
      </div>
    </motion.div>
  );
}

function ChatScene() {
  const msgs = [
    { me: false, t: "Hi! Do you have time for a haircut tomorrow?" },
    { me: true, t: "Hi! 😊 Tomorrow I have 10:30 AM, 2:00 PM or 4:30 PM. Which works for you?" },
    { me: false, t: "2pm please" },
    { me: true, t: "Done ✅ You're booked for *Haircut* tomorrow at 2:00 PM." },
  ];
  return (
    <motion.div {...scene} className="flex h-full flex-col bg-[#0b141a] pt-12">
      <div className="flex items-center gap-3 border-b border-white/5 bg-[#1f2c34] px-4 py-3 text-white">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600"><Scissors className="h-4 w-4" /></div>
        <div><p className="text-sm font-semibold">Bella Salon</p><p className="text-xs text-white/60">online</p></div>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        {msgs.map((m, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 + i * 0.55 }}
            className={cn("max-w-[80%] rounded-xl px-3 py-2 text-[13px] leading-snug", m.me ? "ml-auto bg-[#005c4b] text-white" : "bg-[#1f2c34] text-white/90")}
          >
            {m.t}
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

function BookedScene() {
  return (
    <motion.div {...scene} className="flex h-full flex-col bg-white px-5 pt-14">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Bookings · this week</p>
      <div className="mt-3 grid grid-cols-5 gap-1.5 text-center text-[11px] text-neutral-500">
        {["Mon", "Tue", "Wed", "Thu", "Fri"].map((d) => <span key={d}>{d}</span>)}
      </div>
      <div className="mt-2 grid flex-1 grid-cols-5 gap-1.5 pb-8">
        {Array.from({ length: 5 }).map((_, col) => (
          <div key={col} className="space-y-1.5">
            {Array.from({ length: 7 }).map((_, row) => {
              const hit = (col === 1 && row === 3) || (col === 3 && row === 1) || (col === 0 && row === 5);
              const fresh = col === 1 && row === 3;
              return (
                <motion.div
                  key={row}
                  initial={fresh ? { scale: 0.6, opacity: 0 } : false}
                  animate={fresh ? { scale: 1, opacity: 1 } : undefined}
                  transition={{ delay: 0.5, type: "spring", stiffness: 300 }}
                  className={cn("h-10 rounded-md", hit ? "bg-brand-gradient" : "bg-brand-50")}
                />
              );
            })}
          </div>
        ))}
      </div>
    </motion.div>
  );
}

function Industries() {
  const items = [
    [Scissors, "Salons & spas"], [Wrench, "Plumbers & electricians"], [Stethoscope, "Clinics & dental"],
    [Utensils, "Restaurants"], [Store, "Shops"], [Smile, "Tutors & trainers"],
  ] as const;
  return (
    <section className="border-y bg-neutral-50/60">
      <div className="container flex flex-wrap items-center justify-center gap-x-8 gap-y-3 py-6 text-sm font-medium text-neutral-600">
        <span className="text-neutral-400">Built for</span>
        {items.map(([Icon, label]) => (
          <span key={label} className="inline-flex items-center gap-2"><Icon className="h-4 w-4 text-brand-600" />{label}</span>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { icon: MessageCircle, title: "Tell us about your business", body: "Chat with our AI for a minute — or upload your price list. It writes everything your agent needs to know." },
    { icon: Mic, title: "Pick a voice", body: "Choose from 30 natural voices and your default language. Hear each one before you decide." },
    { icon: QrCode, title: "Scan a QR code", body: "Link your WhatsApp number like WhatsApp Web. Your agent goes live instantly." },
  ];
  return (
    <section id="how" className="container py-20 lg:py-28">
      <motion.div {...fadeUp} className="mx-auto max-w-2xl text-center">
        <p className="text-sm font-semibold uppercase tracking-wider text-brand-600">How it works</p>
        <h2 className="mt-3 text-3xl font-semibold sm:text-5xl">Live in 10 minutes.</h2>
        <p className="mt-4 text-lg text-neutral-600">No scripts to write, no phone system to install.</p>
      </motion.div>
      <div className="mt-14 grid gap-6 md:grid-cols-3">
        {steps.map((s, i) => (
          <motion.div key={s.title} {...fadeUp} transition={{ ...fadeUp.transition, delay: i * 0.08 }} className="relative rounded-2xl border bg-white p-7 shadow-soft">
            <span className="absolute right-6 top-6 font-display text-5xl font-semibold text-neutral-100">{i + 1}</span>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-gradient text-white shadow-glow"><s.icon className="h-6 w-6" /></div>
            <h3 className="mt-6 text-xl font-semibold">{s.title}</h3>
            <p className="mt-2 text-neutral-600">{s.body}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function Features() {
  const items = [
    { icon: PhoneIncoming, title: "Answers every call", body: "Natural voice conversations on WhatsApp — day or night, never on hold." },
    { icon: MessageCircle, title: "Replies to every message", body: "Fast, accurate WhatsApp replies with your prices, hours and policies." },
    { icon: CalendarCheck, title: "Books into your calendar", body: "Checks real availability and books — no double bookings." },
    { icon: ShoppingBag, title: "Takes orders", body: "Correct totals, delivery fees and payment instructions every time." },
    { icon: Target, title: "Captures leads", body: "Qualifies inquiries and hands you warm leads with a summary." },
    { icon: Bell, title: "Human handoff alerts", body: "When a customer wants a person, you get a WhatsApp alert instantly." },
    { icon: Globe2, title: "Speaks their language", body: "Pick a default language — it adapts when customers switch." },
    { icon: Headphones, title: "Recordings & transcripts", body: "Every call summarised, recorded and searchable." },
  ];
  return (
    <section id="features" className="bg-neutral-50/70 py-20 lg:py-28">
      <div className="container">
        <motion.div {...fadeUp} className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-600">Everything included</p>
          <h2 className="mt-3 text-3xl font-semibold sm:text-5xl">A full front desk. On WhatsApp.</h2>
        </motion.div>
        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((f, i) => (
            <motion.div key={f.title} {...fadeUp} transition={{ ...fadeUp.transition, delay: (i % 4) * 0.05 }} className="rounded-2xl border bg-white p-6 transition-shadow hover:shadow-soft">
              <f.icon className="h-6 w-6 text-brand-600" />
              <h3 className="mt-4 font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm text-neutral-600">{f.body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CampaignBand() {
  return (
    <section className="relative overflow-hidden bg-[#0A0B0A] py-20 text-white lg:py-28">
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[880px] -translate-x-1/2 rounded-full bg-brand-500/20 blur-[120px]" />
      <div className="container relative grid items-center gap-12 lg:grid-cols-2">
        <motion.div {...fadeUp}>
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-300">Campaigns</p>
          <h2 className="mt-3 text-3xl font-semibold sm:text-5xl">Call your leads back in one click.</h2>
          <p className="mt-4 text-lg text-white/70">
            Upload a spreadsheet — or pick "everyone who inquired yesterday". Your AI calls each one at the right time, books them in and tells you how it went.
          </p>
          <ul className="mt-6 space-y-3 text-white/80">
            {["Import numbers from Excel, PDF or even a photo", "Calls only inside the hours you choose", "Retries, opt-outs and live progress built in"].map((t) => (
              <li key={t} className="flex items-start gap-3"><Check className="mt-0.5 h-5 w-5 text-brand-300" />{t}</li>
            ))}
          </ul>
        </motion.div>
        <motion.div {...fadeUp} className="grid gap-3 sm:grid-cols-2">
          {[
            [Phone, "Call last 24h leads", "12 contacts"],
            [CalendarCheck, "Confirm tomorrow's bookings", "9 contacts"],
            [PhoneIncoming, "Missed callers", "4 contacts"],
            [Megaphone, "Win back customers", "31 contacts"],
          ].map(([Icon, title, sub]) => {
            const I = Icon as typeof Phone;
            return (
              <div key={title as string} className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur transition-colors hover:border-brand-500/50">
                <I className="h-5 w-5 text-brand-300" />
                <p className="mt-3 font-semibold">{title as string}</p>
                <p className="text-sm text-white/60">{sub as string}</p>
              </div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}

function Pricing() {
  return (
    <section id="pricing" className="container py-20 lg:py-28">
      <motion.div {...fadeUp} className="mx-auto mb-14 max-w-2xl text-center">
        <p className="text-sm font-semibold uppercase tracking-wider text-brand-600">Pricing</p>
        <h2 className="mt-3 text-3xl font-semibold sm:text-5xl">Start free. Grow when you're ready.</h2>
        <p className="mt-4 text-lg text-neutral-600">Simple monthly credits. Cancel anytime.</p>
      </motion.div>
      <PricingCards />
    </section>
  );
}

function Faq() {
  const qa = [
    ["Do I keep my own WhatsApp number?", "Yes. You link your existing WhatsApp or WhatsApp Business number by scanning a QR code — just like WhatsApp Web."],
    ["Does my phone need to stay on?", "Your phone should come online at least every few days so the link stays active. Calls and messages are handled by your AI agent in the meantime."],
    ["What languages does it speak?", "Many — pick a default language and it adapts when a customer speaks another one."],
    ["What if a customer wants a real person?", "Your agent sends you a WhatsApp alert with the customer's details and a summary so you can take over."],
    ["Will it make things up?", "No. It only uses the information you give it. Prices, totals and available times come straight from your data."],
    ["Can I cancel anytime?", "Yes. Plans are monthly and you can cancel from your billing page at any time."],
  ];
  return (
    <section id="faq" className="bg-neutral-50/70 py-20 lg:py-28">
      <div className="container max-w-3xl">
        <h2 className="text-center text-3xl font-semibold sm:text-4xl">Questions, answered.</h2>
        <Accordion type="single" collapsible className="mt-10 rounded-2xl border bg-white px-6">
          {qa.map(([q, a]) => (
            <AccordionItem key={q} value={q}>
              <AccordionTrigger className="text-left text-base">{q}</AccordionTrigger>
              <AccordionContent className="text-neutral-600">{a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="container py-20 lg:py-24">
      <div className="relative overflow-hidden rounded-3xl bg-[#0A0B0A] px-6 py-14 text-center text-white sm:px-12">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_80%_at_50%_0%,rgba(139,224,64,0.25),transparent_70%)]" />
        <h2 className="relative text-3xl font-semibold sm:text-5xl">Never miss a customer again.</h2>
        <p className="relative mx-auto mt-4 max-w-xl text-lg text-white/70">Create your AI agent in minutes. Free to start.</p>
        <Button asChild size="lg" className="relative mt-8 h-12 bg-brand-gradient px-8 text-base text-white shadow-glow hover:opacity-95">
          <Link to="/signup">Create your agent free <ArrowRight className="ml-2 h-5 w-5" /></Link>
        </Button>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t">
      <div className="container flex flex-col items-center justify-between gap-4 py-8 text-sm text-neutral-500 sm:flex-row">
        <Logo tone="light" className="h-6" />
        <div className="flex gap-6">
          <Link to="/terms" className="hover:text-ink">Terms</Link>
          <Link to="/privacy" className="hover:text-ink">Privacy</Link>
          <a href="mailto:support@buildstart.io" className="hover:text-ink">Contact</a>
        </div>
        <p>© {new Date().getFullYear()} BuildStart</p>
      </div>
    </footer>
  );
}
