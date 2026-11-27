import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Logo } from "@/components/brand/Logo";
import { COMPANY } from "@/config/company";

type Doc = { title: string; intro: string; sections: Array<{ h: string; p: string[] }> };
const C = COMPANY;

const TERMS: Doc = {
  title: "Terms of Service",
  intro: `These Terms are an agreement between you and ${C.legalName} ("${C.brand}", "we", "us"), a company registered in ${C.country}. They apply when you create an account or use the ${C.brand} website, app and AI agents (the "Service"). If you use the Service for a business, you accept these Terms on its behalf.`,
  sections: [
    { h: "1. The Service", p: [
      `${C.brand} lets you create AI agents that answer phone calls and messages on your WhatsApp number, take bookings and orders, capture leads and make outbound call campaigns. You link your own WhatsApp account by scanning a QR code. ${C.brand} is not affiliated with or endorsed by WhatsApp or Meta.`,
      "We may improve, change or remove features. If we remove something important to a paid plan, we'll tell you in advance.",
    ] },
    { h: "2. Your account", p: [
      "You must be at least 18 and give accurate information. Keep your password safe; you're responsible for activity in your account.",
      "You can invite only people you trust to your workspace. The workspace owner controls billing and deletion.",
    ] },
    { h: "3. Plans, credits and payment", p: [
      "Your agents use credits. Paid plans renew monthly until cancelled and include a monthly credit allowance. Monthly credits don't roll over: unused monthly credits expire at the end of each billing period.",
      "Top-up credits are a one-time purchase and are valid for 12 months from the purchase date. They are used after your monthly credits run out.",
      "Payments are processed by Stripe. Prices are shown before you pay and may include taxes where required. Upgrades take effect immediately and are prorated; downgrades and cancellations take effect at the end of the current period.",
      "Except where the law requires otherwise, payments and unused credits are non-refundable. If a payment is refunded or disputed, the credits it bought may be removed.",
      "When credits run out, your agents pause until you top up or your plan renews. We may change prices or credit allowances with at least 30 days' notice for existing subscriptions.",
    ] },
    { h: "4. Acceptable use", p: [
      "Don't use the Service to break the law, harass or deceive people, send spam, impersonate others, collect data unlawfully, or sell anything illegal or dangerous.",
      "Don't try to break, overload, reverse-engineer or get around the limits or security of the Service, or resell it without our written permission.",
      "You must follow WhatsApp's terms and policies. WhatsApp may restrict or ban numbers that are reported or misused; we aren't responsible for actions WhatsApp takes on your number.",
    ] },
    { h: "5. Campaigns, consent and call recording", p: [
      "You may only call or message people who have agreed to be contacted by your business, or where the law otherwise allows it. You confirm this each time you launch a campaign, and you're responsible for following the telemarketing, consumer and privacy laws that apply to you and the people you contact.",
      "We add safeguards such as quiet hours, daily limits and do-not-contact lists, but they don't replace your own legal obligations. Honour every request to stop contacting someone.",
      "Calls handled by your agents may be recorded and transcribed. Where the law requires it, you must tell callers that they're speaking with an AI assistant and that the call may be recorded.",
    ] },
    { h: "6. AI agents and your information", p: [
      "Your agents answer using the business information you provide. Keep it accurate and up to date. AI can make mistakes: review your agent's setup, monitor its conversations and don't rely on it for emergencies, medical, legal or financial advice.",
      "Agents are designed to refuse questions outside your business and to hand over to you when a customer asks for a human. You remain responsible for the commitments your business makes to its customers.",
    ] },
    { h: "7. Your content and data", p: [
      `You own the content you upload and the conversations your agents have ("Your Data"). You give us permission to store and process Your Data only to provide, secure and support the Service. We don't use Your Data to train AI models for anyone else, and we don't sell it.`,
      "You're responsible for having the right to share Your Data with us, including your customers' personal data. Our Privacy Policy explains how we handle personal data.",
    ] },
    { h: "8. Suspension and ending the Service", p: [
      "You can cancel your plan at any time from Billing, and delete your workspace from Settings. A deleted workspace is disabled immediately and permanently erased after 30 days; within that time you can ask support to restore it.",
      "We may suspend or close an account that breaks these Terms, puts others at risk or hasn't paid, and we'll tell you why where we can.",
    ] },
    { h: "9. Liability", p: [
      `The Service is provided "as is". We work hard to keep it reliable but can't promise it will be uninterrupted or error-free, as it depends on third parties such as WhatsApp, telecom networks and AI providers.`,
      `To the extent the law allows, ${C.brand} is not liable for indirect or consequential losses, lost profits, lost bookings or lost data, and our total liability for any claim is limited to the amount you paid us in the 3 months before the claim. Nothing in these Terms limits liability that can't be limited by law.`,
      "You'll compensate us for claims made against us because of how you used the Service, including campaigns you sent without consent.",
    ] },
    { h: "10. Changes and law", p: [
      "We may update these Terms. If a change is significant, we'll notify you by email or in the app at least 14 days before it takes effect. Continuing to use the Service means you accept the new Terms.",
      `These Terms are governed by the laws of ${C.country}, and the courts of ${C.country} have jurisdiction, unless the consumer laws of your country give you the right to bring a claim locally.`,
    ] },
    { h: "11. Contact", p: [`${C.legalName}, ${C.country}. Email: ${C.email}`] },
  ],
};

const PRIVACY: Doc = {
  title: "Privacy Policy",
  intro: `This policy explains how ${C.legalName} ("${C.brand}", "we") collects and uses personal data when you use our website, app and AI agents. We follow the Personal Data Protection Act No. 9 of 2022 of Sri Lanka and, where it applies, the EU and UK GDPR.`,
  sections: [
    { h: "1. Two roles", p: [
      "For your account (your name, email, billing), we decide how the data is used. We are the controller.",
      "For your customers' data (their calls, messages, numbers, bookings and orders handled by your agents), we act on your instructions as your processor. Your business is the controller and is responsible for telling its customers how their data is used.",
    ] },
    { h: "2. What we collect", p: [
      "Account data: name, email, password (stored hashed), country, time zone, business name and settings.",
      "Sign in with Google: we receive your name, email address and profile picture from Google only to create and sign in to your account. We don't access your Gmail, contacts, Drive or anything else, and we use this data in line with the Google API Services User Data Policy, including its Limited Use requirements.",
      "Business content: information you give the Orchestrator, files you upload (we extract text in your browser where possible), your agents' configuration and knowledge.",
      "Customer conversations: WhatsApp messages, call recordings, transcripts and summaries, contact numbers and names, bookings, orders and leads created by your agents, and numbers you import into campaigns.",
      "Billing: plan, credits and payment history. Card details are handled by Stripe; we never see or store full card numbers.",
      "Technical data: IP address, device and browser type, and logs used for security and troubleshooting.",
    ] },
    { h: "3. How we use it", p: [
      "To run the Service: answer calls and messages, make bookings, run campaigns, show your dashboard and send you alerts.",
      "To bill you, prevent fraud and abuse, keep the Service secure, provide support and meet legal obligations.",
      "To improve the Service using aggregated, de-identified usage statistics. We don't sell personal data, don't use it for advertising, and don't use your or your customers' data to train AI models for others.",
      "With your consent only, to send occasional product news. You can opt out at any time in Settings.",
    ] },
    { h: "4. Who we share it with", p: [
      "Service providers that process data for us under contract: Supabase (database, storage and authentication), Google (Gemini AI models for conversations, calls and voice), Stripe (payments), Vercel (website hosting) and our own servers that connect to WhatsApp.",
      "WhatsApp/Meta, because messages and calls travel through the WhatsApp account you link.",
      "Authorities, when the law requires it, or to protect people's rights and safety.",
      "Some of these providers are outside Sri Lanka. When data is transferred, we use providers with appropriate safeguards such as standard contractual clauses.",
    ] },
    { h: "5. How long we keep it", p: [
      "Account and business data: while your account is active.",
      "Call recordings and transcripts: for the retention period of your plan, then deleted.",
      "Deleted workspaces: disabled immediately and permanently erased after 30 days, including recordings, conversations, files and your sign-in account.",
      "Billing records: as long as tax and accounting laws require.",
    ] },
    { h: "6. Your rights", p: [
      "You can access, correct, export or delete your data. Most of this is self-serve: export from Settings → Your data, and delete from Settings → Delete workspace.",
      "You can also object to or restrict certain processing, withdraw consent, and complain to your data protection authority (in Sri Lanka, the Data Protection Authority).",
      "If you're a customer of a business that uses BuildStart, contact that business first. We'll help them respond to your request. You can also ask the agent to stop contacting you at any time.",
    ] },
    { h: "7. Security", p: [
      "We encrypt data in transit, keep files private, separate each workspace's data, require two-factor authentication for our administrators and log administrative actions. No system is perfectly secure; if a breach affects your data, we'll tell you without undue delay.",
    ] },
    { h: "8. Children", p: ["The Service is for businesses and isn't directed at children under 18."] },
    { h: "9. Changes", p: ["We'll post updates here and tell you about significant changes by email or in the app."] },
    { h: "10. Contact", p: [`${C.legalName}, ${C.country}. For privacy questions or requests, email ${C.email}.`] },
  ],
};

export default function LegalPage({ kind }: { kind: "terms" | "privacy" }) {
  const c = kind === "terms" ? TERMS : PRIVACY;
  useEffect(() => { document.title = `${c.title} · ${C.brand}`; }, [c.title]);
  return (
    <div className="min-h-dvh bg-white text-neutral-800">
      <header className="border-b"><div className="container flex h-16 items-center justify-between"><Link to="/" aria-label={`${C.brand} home`}><Logo tone="light" className="h-7" /></Link><Link to={kind === "terms" ? "/privacy" : "/terms"} className="text-sm text-neutral-500 hover:text-neutral-900">{kind === "terms" ? "Privacy Policy" : "Terms of Service"}</Link></div></header>
      <main className="container max-w-3xl py-12 sm:py-16">
        <h1 className="text-3xl font-semibold text-neutral-950 sm:text-4xl">{c.title}</h1>
        <p className="mt-2 text-sm text-neutral-500">Last updated {C.legalUpdated}</p>
        <p className="mt-6 leading-relaxed">{c.intro}</p>
        {c.sections.map((s) => (
          <section key={s.h} className="mt-9">
            <h2 className="text-lg font-semibold text-neutral-950">{s.h}</h2>
            {s.p.map((p) => <p key={p} className="mt-3 leading-relaxed text-neutral-700">{p}</p>)}
          </section>
        ))}
      </main>
      <footer className="border-t"><div className="container py-8 text-sm text-neutral-500">© {new Date().getFullYear()} {C.legalName} · <a href={`mailto:${C.email}`} className="hover:text-neutral-900">{C.email}</a></div></footer>
    </div>
  );
}
