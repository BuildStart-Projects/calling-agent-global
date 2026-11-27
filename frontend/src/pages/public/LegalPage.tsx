import { Link } from "react-router-dom";
import { Logo } from "@/components/brand/Logo";

const CONTENT = {
  terms: {
    title: "Terms of Service",
    body: [
      "These Terms govern your use of BuildStart. By creating an account you agree to them.",
      "You are responsible for the information you give your AI agents and for having your customers' consent before contacting them, including through campaigns.",
      "Plans renew monthly until cancelled. Monthly credits do not roll over; top-up credits are valid for 12 months from purchase.",
      "This page is a placeholder and must be replaced with reviewed legal text before launch.",
    ],
  },
  privacy: {
    title: "Privacy Policy",
    body: [
      "BuildStart processes the business information you provide and the conversations your agents have on your behalf in order to provide the service.",
      "Call recordings and transcripts are stored privately and retained according to your plan. You can export or delete your data at any time from Settings.",
      "This page is a placeholder and must be replaced with reviewed legal text before launch.",
    ],
  },
} as const;

export default function LegalPage({ kind }: { kind: keyof typeof CONTENT }) {
  const c = CONTENT[kind];
  return (
    <div className="min-h-dvh bg-white">
      <header className="border-b"><div className="container flex h-16 items-center"><Link to="/"><Logo tone="light" className="h-7" /></Link></div></header>
      <main className="container max-w-3xl py-14">
        <h1 className="text-4xl font-semibold">{c.title}</h1>
        <div className="prose prose-neutral mt-8">{c.body.map((p) => <p key={p}>{p}</p>)}</div>
      </main>
    </div>
  );
}
