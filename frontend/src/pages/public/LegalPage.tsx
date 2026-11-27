import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Logo } from "@/components/brand/Logo";
import { COMPANY } from "@/config/company";

const C = COMPANY;
const SITE = "https://buildstart.io";
const EFFECTIVE = "28 November 2026";

type List = { list: ReactNode[] };
type Block = string | JSX.Element | List;
const isList = (b: Block): b is List => typeof b === "object" && b !== null && "list" in b;
type Section = { id: string; h: string; body: Block[] };
type Doc = { title: string; intro: ReactNode[]; sections: Section[] };

const mail = <a href={`mailto:${C.email}`} className="font-medium text-brand-700 underline-offset-2 hover:underline">{C.email}</a>;
const ext = (href: string, label: string) => <a href={href} target="_blank" rel="noreferrer" className="font-medium text-brand-700 underline-offset-2 hover:underline">{label}</a>;

/* ────────────────────────────── Terms of Service ────────────────────────────── */
const TERMS: Doc = {
  title: "Terms of Service",
  intro: [
    <>These Terms of Service (“Terms”) form a binding agreement between you and {C.legalName} (“{C.brand}”, “we”, “us” or “our”), a company incorporated in {C.country}. They govern your access to and use of the {C.brand} website at {SITE}, the {C.brand} web application, and the AI agents, integrations and related services we provide (together, the “Service”).</>,
    <>By creating an account, clicking to accept these Terms, or using the Service, you agree to these Terms and to our <Link to="/privacy" className="font-medium text-brand-700 underline-offset-2 hover:underline">Privacy Policy</Link>. If you use the Service on behalf of a business or other organisation, you confirm that you are authorised to accept these Terms on its behalf, and “you” refers to that organisation.</>,
  ],
  sections: [
    { id: "service", h: "1. The Service", body: [
      `${C.brand} lets businesses create AI agents that act on their behalf with their own customers. Depending on your setup and plan, the Service includes:`,
      { list: [
        "an Orchestrator that interviews you, reads the information and files you provide, and builds your agents' knowledge;",
        "a Calling Agent that answers voice calls on your linked WhatsApp number and, when you choose, calls customers back or places outbound campaign calls;",
        "a Messaging Agent that replies to WhatsApp messages;",
        "tools to manage bookings, availability, orders, leads, contacts, conversations, call recordings, transcripts and summaries;",
        "campaigns that call lists of contacts you choose or upload, at the times and pace you set;",
        "handoff alerts sent to your nominated WhatsApp number when a customer asks for a person;",
        "billing, credits, usage reporting and account settings.",
      ] },
      "We continually improve the Service and may add, change or remove features. If we remove a material feature from a paid plan you have already paid for, we will give you reasonable advance notice.",
    ] },
    { id: "eligibility", h: "2. Eligibility and accounts", body: [
      "You must be at least 18 years old and able to form a binding contract to use the Service. The Service is intended for business use.",
      "You must provide accurate and complete registration information, keep it up to date, and verify your email address before connecting WhatsApp, launching campaigns or making payments.",
      "You are responsible for keeping your login credentials confidential and for all activity under your account. Tell us immediately at the address in section 20 if you suspect unauthorised access.",
      "Each workspace has an owner who controls billing, deletion and other account-level decisions. Members you give access to act on your behalf, and you are responsible for their use of the Service.",
    ] },
    { id: "whatsapp", h: "3. WhatsApp and third-party services", body: [
      `To use the Calling Agent and Messaging Agent you link your own WhatsApp account to ${C.brand} by scanning a QR code, in the same way as a linked device. ${C.brand} is an independent service and is not affiliated with, endorsed by or sponsored by WhatsApp LLC or Meta Platforms, Inc.`,
      "You must comply with WhatsApp's Terms of Service, Business Policy and any other rules that apply to your WhatsApp account. WhatsApp may limit, suspend or ban numbers that it considers to be misused or that recipients report. We are not responsible for actions WhatsApp takes on your account, and those actions do not entitle you to a refund.",
      "The Service also relies on third-party providers such as AI model providers, payment processors, hosting providers and telecommunications networks. Their availability and performance are outside our control, and their terms may apply to your use of the features they power.",
    ] },
    { id: "plans", h: "4. Plans, credits and payment", body: [
      "Use of the AI agents consumes credits. The number of credits used depends on the activity, such as call time and the amount of AI processing, and is shown to you as credits used per agent in your Usage page. Credit balances have no cash value and cannot be transferred or exchanged.",
      { list: [
        <><strong>Free plan:</strong> includes a monthly allowance of free credits and the features and limits shown on our pricing page.</>,
        <><strong>Paid plans:</strong> are billed monthly in advance and renew automatically at the end of each billing period until cancelled. Each period includes the monthly credit allowance shown on the pricing page.</>,
        <><strong>No rollover:</strong> monthly plan credits are valid only for the billing period in which they are granted. Unused monthly credits expire at the end of that period.</>,
        <><strong>Top-ups:</strong> are one-time purchases of additional credits. Top-up credits are valid for 12 months from the date of purchase and are used after your monthly credits run out.</>,
      ] },
      "Payments are processed by Stripe. By providing a payment method you authorise us and Stripe to charge it for your plan, top-ups and any applicable taxes. Prices are shown before you pay. You are responsible for any taxes that apply to your purchases, other than taxes on our income.",
      "Upgrades take effect immediately: you receive the new plan's credits and pay a prorated amount for the rest of the current period. Downgrades and cancellations take effect at the end of the current billing period, and you keep your paid plan's features and credits until then.",
      "If a payment fails, we may retry it and may move your workspace to the Free plan if payment is not completed. When your credit balance reaches zero, your agents pause until you top up, upgrade or your next monthly allowance is granted.",
      "Except where required by applicable law, payments are non-refundable and we do not refund unused credits or partial periods. If a payment is refunded or reversed, including through a chargeback, the credits it purchased may be removed from your balance.",
      "We may change prices, credit allowances or plan features. For existing paid subscriptions, we will give you at least 30 days' notice before a price increase takes effect, and you may cancel before it applies.",
    ] },
    { id: "use", h: "5. Acceptable use", body: [
      "You must use the Service lawfully and responsibly. You must not, and must not allow anyone else to:",
      { list: [
        "use the Service to break any law or regulation, or to infringe anyone's rights;",
        "contact people without a lawful basis, send spam or unsolicited bulk communications, or ignore a person's request to stop being contacted;",
        "harass, threaten, defame, deceive or defraud anyone, or impersonate any person or organisation;",
        "promote or sell illegal, dangerous, counterfeit or age-restricted goods or services in breach of applicable law;",
        "collect, store or process personal data unlawfully, including sensitive data you have no right to process;",
        "use the agents to provide emergency services, or to give medical, legal, financial or other professional advice as a substitute for a qualified professional;",
        "attempt to gain unauthorised access to the Service, other accounts or our systems, or bypass usage limits, credit metering or security measures;",
        "interfere with or overload the Service, introduce malware, or reverse-engineer, copy or resell the Service except as the law expressly permits;",
        "use the Service or its outputs to build a competing product, or extract our prompts, models or data by automated means.",
      ] },
      "We may investigate suspected breaches of this section and may remove content, pause agents or campaigns, or suspend accounts where reasonably necessary to protect people, the Service or our providers.",
    ] },
    { id: "campaigns", h: "6. Campaigns, consent and calling rules", body: [
      "Campaigns place outbound calls, and optional WhatsApp messages, to contacts you choose, import or upload. You are solely responsible for every campaign you launch. In particular, you confirm that:",
      { list: [
        "every person you contact has given consent to be contacted by your business, or you otherwise have a lawful basis to contact them under the laws that apply to you and to them;",
        "you comply with all applicable telemarketing, consumer protection, anti-spam, privacy and call-recording laws, including any calling-hour restrictions and do-not-call registers that apply to you;",
        "you honour opt-out requests promptly and do not re-add people who have asked not to be contacted.",
      ] },
      "You confirm consent each time you launch a campaign. The Service includes safeguards such as quiet hours, daily limits, pacing, retry limits, do-not-contact lists and automatic pausing when failure rates are high. These safeguards help you operate responsibly but do not replace your own legal obligations.",
      "If someone asks an agent to stop contacting them, the agent records that request and the contact is excluded from future campaigns.",
    ] },
    { id: "recording", h: "7. Call recording and AI disclosure", body: [
      "Calls handled by your Calling Agent may be recorded and transcribed, and calls and conversations may be summarised by AI, so that you can review them. Recordings and transcripts are kept for the retention period of your plan and then deleted.",
      "Where the law requires it, you are responsible for informing callers and the people you contact that they are speaking with an automated AI assistant and that calls may be recorded, and for obtaining any consent that is required. You can configure your agents' greetings to include such notices.",
    ] },
    { id: "ai", h: "8. AI agents and outputs", body: [
      "Your agents respond using the business information you provide and that the Orchestrator collects from you. You are responsible for making sure that information, including prices, services, opening hours, policies and availability, is accurate, complete and up to date.",
      "Agents are designed to answer only from your business information, to decline questions unrelated to your business, and to hand over to you when a customer asks for a person. AI systems can still make mistakes or misunderstand people. You should review your agents' setup, monitor conversations and calls, and correct their knowledge when needed.",
      "You remain responsible for the commitments your business makes to its customers, including bookings, orders, quotes and the fulfilment of any offer an agent communicates on your behalf.",
    ] },
    { id: "data", h: "9. Your data", body: [
      <>“Your Data” means the content and information you or your users provide to the Service, and the data generated when your agents interact with your customers, including messages, call recordings, transcripts, summaries, contacts, bookings, orders and leads. As between you and us, you own Your Data.</>,
      "You grant us a non-exclusive, worldwide licence to host, store, copy, process, transmit and display Your Data only as needed to provide, maintain, secure and support the Service, to prevent abuse, and to comply with the law. We do not sell Your Data and we do not use it to train AI models for other customers.",
      "You are responsible for having all rights, notices and consents needed to provide Your Data to us and to have it processed through the Service, including your customers' personal data. For personal data about your customers, you act as the controller and we act as your processor, as described in our Privacy Policy.",
      "You can export Your Data at any time from Settings. We may use aggregated and de-identified information about how the Service is used, which does not identify you or any individual, to operate and improve the Service.",
    ] },
    { id: "ip", h: "10. Our intellectual property", body: [
      `The Service, including its software, prompts, designs, text, graphics, logos and the ${C.brand} name and brand, is owned by ${C.legalName} or its licensors and is protected by intellectual property laws. Subject to these Terms, we grant you a limited, non-exclusive, non-transferable, revocable right to use the Service for your internal business purposes during your subscription.`,
      "If you send us feedback or suggestions, we may use them without any obligation to you.",
    ] },
    { id: "confidentiality", h: "11. Confidentiality and security", body: [
      "Each party will protect the other's non-public information that it receives in connection with the Service using reasonable care, and use it only to perform under these Terms. We protect Your Data with technical and organisational security measures appropriate to the risk, as described in our Privacy Policy.",
    ] },
    { id: "availability", h: "12. Availability and support", body: [
      "We aim to keep the Service available at all times but do not guarantee uninterrupted or error-free operation. We may carry out maintenance, which we try to schedule at times of low use. Support is provided by email and, depending on your plan, through additional support channels described on our pricing page.",
    ] },
    { id: "termination", h: "13. Cancellation, suspension and deletion", body: [
      "You can cancel your paid plan at any time from the Billing page; cancellation takes effect at the end of the current billing period. You can delete an agent, or your whole workspace, from the app.",
      "When the owner deletes a workspace, its agents are taken offline and WhatsApp is disconnected immediately, campaigns are cancelled, and future renewals are stopped. The workspace and its data are permanently erased 30 days later. Within those 30 days you may ask us to restore the workspace.",
      "We may suspend or terminate your access, with notice where reasonably possible, if you materially breach these Terms, fail to pay, create a risk to other people, the Service or our providers, or if we are required to do so by law. Where a breach can be remedied, we will give you a reasonable opportunity to do so before terminating.",
      "Sections that by their nature should survive termination, including sections 4 (as to amounts owed), 9, 10, 14, 15, 16 and 18, survive.",
    ] },
    { id: "warranties", h: "14. Disclaimers", body: [
      `To the fullest extent permitted by law, the Service is provided “as is” and “as available”. ${C.brand} disclaims all warranties not expressly stated in these Terms, whether express or implied, including warranties of merchantability, fitness for a particular purpose, non-infringement and accuracy of AI outputs. We do not warrant that the Service will meet every requirement you have, that WhatsApp or other third-party services will remain available, or that every call or message will be delivered or answered.`,
    ] },
    { id: "liability", h: "15. Limitation of liability", body: [
      `To the fullest extent permitted by law, neither ${C.brand} nor its directors, employees or suppliers will be liable for any indirect, incidental, special, consequential or punitive damages, or for any loss of profits, revenue, business, goodwill, bookings, orders or data, arising out of or in connection with the Service or these Terms, even if advised of the possibility of such damages.`,
      `To the fullest extent permitted by law, ${C.brand}'s total liability for all claims arising out of or in connection with the Service or these Terms is limited to the greater of the amounts you paid us in the three months before the event giving rise to the claim, or USD 50.`,
      "Nothing in these Terms excludes or limits liability that cannot be excluded or limited under applicable law, including liability for fraud or for death or personal injury caused by negligence.",
    ] },
    { id: "indemnity", h: "16. Indemnity", body: [
      `You will defend, indemnify and hold harmless ${C.brand} and its directors, employees and suppliers from and against any claims, damages, penalties, losses and costs (including reasonable legal fees) arising from Your Data, your campaigns and other communications sent through the Service, your breach of these Terms, or your violation of any law or the rights of any third party.`,
    ] },
    { id: "changes", h: "17. Changes to these Terms", body: [
      "We may update these Terms from time to time. If we make material changes, we will notify you by email or in the app at least 14 days before they take effect. If you do not agree to the changes, you may cancel before they take effect. Continuing to use the Service after that date means you accept the updated Terms.",
    ] },
    { id: "law", h: "18. Governing law and disputes", body: [
      `These Terms are governed by the laws of the Democratic Socialist Republic of ${C.country}. The courts of Colombo, ${C.country}, have exclusive jurisdiction over any dispute arising out of or in connection with these Terms or the Service, except that nothing in this section deprives you of any mandatory consumer protection rights you have under the laws of your country of residence.`,
      "Before starting formal proceedings, both parties agree to try in good faith to resolve the dispute informally for at least 30 days after one party notifies the other in writing.",
    ] },
    { id: "general", h: "19. General", body: [
      { list: [
        "These Terms, together with the Privacy Policy and any plan details shown at purchase, are the entire agreement between you and us about the Service.",
        "If any provision is held unenforceable, the rest of these Terms remain in effect.",
        "Our failure to enforce a provision is not a waiver of our right to do so later.",
        "You may not assign these Terms without our written consent. We may assign them to an affiliate or in connection with a merger, acquisition or sale of assets.",
        "Neither party is liable for delays or failures caused by events beyond its reasonable control.",
        "We may send notices to the email address associated with your account or in the app. You may send notices to the address below.",
      ] },
    ] },
    { id: "contact", h: "20. Contact us", body: [
      <>{C.legalName}, {C.country}. Email: {mail}</>,
    ] },
  ],
};

/* ────────────────────────────── Privacy Policy ────────────────────────────── */
const PRIVACY: Doc = {
  title: "Privacy Policy",
  intro: [
    <>This Privacy Policy explains how {C.legalName} (“{C.brand}”, “we”, “us” or “our”) collects, uses, shares and protects personal data when you visit {SITE}, create an account, or use the {C.brand} application and AI agents (the “Service”). It also explains the choices and rights you have.</>,
    <>We handle personal data in line with the Personal Data Protection Act, No. 9 of 2022 of Sri Lanka and, where they apply to you, the EU and UK General Data Protection Regulations and other applicable privacy laws.</>,
  ],
  sections: [
    { id: "roles", h: "1. Who is responsible for your data", body: [
      { list: [
        <><strong>Account and website data.</strong> For the personal data of our customers and website visitors, such as your name, email address and billing details, {C.legalName} is the controller.</>,
        <><strong>Your customers' data.</strong> When a business uses {C.brand}, its agents handle calls, messages and records of that business's own customers. For that data the business is the controller, and {C.brand} processes it on the business's behalf and according to its instructions as a processor. If you are a customer of a business that uses {C.brand}, please contact that business about your data; we will help it respond.</>,
      ] },
    ] },
    { id: "collect", h: "2. Personal data we collect", body: [
      { list: [
        <><strong>Account data:</strong> your name, email address, password (stored only as a secure hash), business name, country, time zone, language, role in your workspace, and preferences such as theme and product-news choices.</>,
        <><strong>Google sign-in data:</strong> if you choose “Continue with Google”, we receive your name, email address, profile picture and Google account identifier from Google (see section 5).</>,
        <><strong>Business information:</strong> what you tell the Orchestrator and enter in the app, such as services, prices, opening hours, availability, policies, FAQs, catalogue items, handoff phone number and agent settings, and the files and images you upload so we can extract that information.</>,
        <><strong>WhatsApp connection data:</strong> the phone number and account identifier of the WhatsApp account you link, and its connection status.</>,
        <><strong>Customer interaction data (processed for businesses):</strong> phone numbers, WhatsApp names and profile names, message content and media, call audio recordings, transcripts, AI-generated summaries and outcomes, bookings, orders, leads, notes, tags, do-not-contact choices, and contact lists that businesses import for campaigns.</>,
        <><strong>Billing data:</strong> your plan, subscription status, credit balance and history, invoices and payment status. Card and payment details are collected and stored by Stripe; we never receive or store full card numbers.</>,
        <><strong>Usage and technical data:</strong> credits used per agent, feature usage, IP address, browser and device type, log records, and error information, which we use to operate, secure and troubleshoot the Service.</>,
        <><strong>Communications:</strong> messages you send to our support team and the details you provide in them.</>,
      ] },
    ] },
    { id: "use", h: "3. How we use personal data", body: [
      { list: [
        "To provide the Service: create and run your agents, answer calls and messages, make bookings and take orders, run campaigns you launch, send handoff alerts, show your dashboard, and keep your agents' knowledge up to date.",
        "To manage your account, authenticate you, verify your email address and protect your account, including two-factor authentication for administrators.",
        "To process payments, grant and track credits, send receipts and billing notices, and prevent fraud.",
        "To send service communications, such as security notices, low-credit and expiry alerts, and changes to the Service or these policies.",
        "To provide support and respond to your requests.",
        "To keep the Service safe and reliable: monitor for abuse, enforce our Terms, enforce campaign safeguards such as quiet hours and do-not-contact lists, and debug problems.",
        "To improve the Service using aggregated and de-identified statistics that do not identify you or your customers.",
        "To send occasional product news, only if you opt in. You can opt out at any time in Settings or by contacting us.",
        "To comply with legal obligations and to establish, exercise or defend legal claims.",
      ] },
      `We do not sell personal data, we do not use it for advertising, and we do not use your data or your customers' data to train AI models for other customers.`,
    ] },
    { id: "basis", h: "4. Legal bases", body: [
      "Where the law requires a legal basis, we rely on: performance of our contract with you (to provide the Service); our legitimate interests (to secure, support and improve the Service, and to prevent fraud and abuse, balanced against your rights); compliance with legal obligations (such as tax and accounting); and your consent (for optional product news and any other processing where we ask for it). You can withdraw consent at any time without affecting processing that has already taken place.",
    ] },
    { id: "google", h: "5. Google user data", body: [
      `When you sign in with Google, we request only the basic profile scopes (openid, email and profile). We use the name, email address and profile picture we receive solely to create your ${C.brand} account, sign you in and display your profile in the app.`,
      `We do not access your Gmail, Google Drive, Google Contacts, Google Calendar or any other Google service data. We do not sell Google user data, use it for advertising, transfer it to others except the service providers that help us run the Service, or use it to train AI models.`,
      <>{C.brand}'s use and transfer of information received from Google APIs adheres to the {ext("https://developers.google.com/terms/api-services-user-data-policy", "Google API Services User Data Policy")}, including the Limited Use requirements.</>,
      "You can disconnect Google sign-in at any time from your Google Account permissions page. To delete the data we hold, delete your workspace in Settings or contact us (see sections 9 and 10).",
    ] },
    { id: "ai", h: "6. AI processing", body: [
      "The Service uses AI models to understand and respond to calls and messages, extract information from the files you upload, write campaign scripts, and summarise calls and conversations. To do this, the relevant content is sent securely to our AI model providers, including Google's Gemini models, which process it to return a result. Our providers are bound by contract to use this content only to provide their services to us.",
      "Where possible, we extract text from your uploaded files in your own browser and send only the extracted text for processing, rather than the whole file.",
    ] },
    { id: "share", h: "7. How we share personal data", body: [
      "We share personal data only as described here:",
      { list: [
        <><strong>Service providers (sub-processors)</strong> that process data on our behalf under contracts requiring confidentiality and security: Hetzner Online GmbH (server hosting for our application, database, files and call recordings); Google LLC (Gemini AI models for conversations, calls, voice and document understanding); our AI model gateway provider; Stripe, Inc. (payment processing); Vercel Inc. (website hosting and delivery); and our email delivery provider (account and service emails).</>,
        <><strong>WhatsApp and Meta</strong>, because calls and messages are carried through the WhatsApp account that a business links to the Service, and are subject to WhatsApp's own terms and privacy policy.</>,
        <><strong>The business you interact with.</strong> If you contact a business that uses {C.brand}, that business can see your conversation, call recording, transcript, summary and any booking, order or lead created.</>,
        <><strong>Legal and safety reasons:</strong> to comply with the law or a valid legal request, to enforce our Terms, or to protect the rights, property and safety of our users, the public or {C.brand}.</>,
        <><strong>Business transfers:</strong> in connection with a merger, acquisition or sale of assets, subject to this Privacy Policy.</>,
      ] },
    ] },
    { id: "transfers", h: "8. International transfers", body: [
      `${C.brand} operates from ${C.country}, and our service providers operate in other countries, including countries in the European Union and the United States. When personal data is transferred across borders, we take steps to ensure it remains protected, such as using providers that offer appropriate safeguards, including standard contractual clauses where required.`,
    ] },
    { id: "retention", h: "9. How long we keep data", body: [
      { list: [
        <><strong>Account and business information:</strong> for as long as your workspace is active.</>,
        <><strong>Call recordings and transcripts:</strong> for the retention period of the plan the workspace is on (30 days on Free, 90 days on Pro and 365 days on Enterprise), after which they are deleted. Call summaries remain available to the business while the workspace is active.</>,
        <><strong>Messages, contacts, bookings, orders and leads:</strong> for as long as the workspace is active, unless the business deletes them earlier.</>,
        <><strong>Deleted agents:</strong> an agent's knowledge, files, conversations, calls and bookings are deleted when the agent is deleted.</>,
        <><strong>Deleted workspaces:</strong> disabled immediately and permanently erased 30 days after the owner requests deletion, together with its files, recordings, conversations and the owner's sign-in account.</>,
        <><strong>Billing and payment records:</strong> for as long as required by tax and accounting laws.</>,
        <><strong>Security logs:</strong> for a limited period needed to protect the Service.</>,
      ] },
    ] },
    { id: "rights", h: "10. Your rights and choices", body: [
      "Depending on where you live, you may have the right to access, correct, update or delete your personal data; to receive a copy of it in a portable format; to object to or restrict certain processing; to withdraw consent; and to lodge a complaint with a data protection authority, such as the Data Protection Authority of Sri Lanka or your local authority.",
      { list: [
        <><strong>Export:</strong> Settings → Your data → Export my data.</>,
        <><strong>Correct:</strong> update your profile and business details in Settings, and your agents' knowledge in the Knowledge section.</>,
        <><strong>Delete:</strong> delete an agent from the Agents page, or your whole workspace from Settings → Delete workspace.</>,
        <><strong>Marketing:</strong> turn product news on or off in Settings.</>,
        <><strong>Customers of our users:</strong> ask the business's agent to stop contacting you at any time, or contact the business directly. You can also contact us and we will pass your request to the business.</>,
      ] },
      <>For any other request, email {mail}. We will respond within the time required by applicable law and may need to verify your identity first.</>,
    ] },
    { id: "security", h: "11. Security", body: [
      "We protect personal data with technical and organisational measures appropriate to the risk, including encryption in transit, private storage for files and recordings, separation of each workspace's data with database access controls, hashed passwords, signed and verified connections between our systems, restricted administrative access with two-factor authentication, audit logs of administrative actions, and regular review of our safeguards.",
      "No method of transmission or storage is completely secure. If we become aware of a personal data breach that affects you, we will notify you and the relevant authorities as required by law.",
    ] },
    { id: "cookies", h: "12. Cookies and similar technologies", body: [
      `${C.brand} uses only the browser storage needed to run the Service, such as keeping you signed in and remembering preferences like light or dark mode and sidebar layout. We do not use advertising cookies or third-party tracking for advertising.`,
      "Our website loads fonts and some processing libraries from third-party content delivery networks, which receive your IP address and browser information when delivering those files. Payment pages are provided by Stripe, which uses its own cookies to process payments and prevent fraud.",
    ] },
    { id: "children", h: "13. Children", body: [
      `The Service is intended for businesses and is not directed at children. We do not knowingly collect personal data from children under 18 for account purposes. If you believe a child has provided us with personal data, contact us and we will delete it.`,
    ] },
    { id: "changes", h: "14. Changes to this Privacy Policy", body: [
      "We may update this Privacy Policy from time to time. We will post the updated version on this page with a new effective date and, if the changes are material, notify you by email or in the app before they take effect.",
    ] },
    { id: "contact", h: "15. Contact us", body: [
      <>{C.legalName}, {C.country}. For privacy questions, requests or complaints, email {mail}.</>,
    ] },
  ],
};

function Body({ b }: { b: Block }) {
  if (!isList(b)) return <p className="mt-3 leading-relaxed text-neutral-700">{b}</p>;
  return <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed text-neutral-700 marker:text-brand-600">{b.list.map((li, i) => <li key={i}>{li}</li>)}</ul>;
}

export default function LegalPage({ kind }: { kind: "terms" | "privacy" }) {
  const c = kind === "terms" ? TERMS : PRIVACY;
  useEffect(() => { document.title = `${c.title} · ${C.brand}`; window.scrollTo(0, 0); }, [c.title]);
  return (
    <div className="min-h-dvh bg-white text-neutral-800">
      <header className="border-b">
        <div className="container flex h-16 items-center justify-between">
          <Link to="/" aria-label={`${C.brand} home`}><Logo tone="light" className="h-7" /></Link>
          <Link to={kind === "terms" ? "/privacy" : "/terms"} className="text-sm text-neutral-500 hover:text-neutral-900">{kind === "terms" ? "Privacy Policy" : "Terms of Service"}</Link>
        </div>
      </header>
      <main className="container max-w-3xl py-12 sm:py-16">
        <h1 className="text-3xl font-semibold text-neutral-950 sm:text-4xl">{c.title}</h1>
        <p className="mt-2 text-sm text-neutral-500">Effective {EFFECTIVE}</p>
        {c.intro.map((p, i) => <p key={i} className="mt-5 leading-relaxed">{p}</p>)}
        <nav aria-label="Contents" className="mt-8 rounded-xl border bg-neutral-50 p-5">
          <p className="text-sm font-semibold text-neutral-900">Contents</p>
          <ol className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
            {c.sections.map((s) => <li key={s.id}><a href={`#${s.id}`} className="text-neutral-600 hover:text-brand-700">{s.h}</a></li>)}
          </ol>
        </nav>
        {c.sections.map((s) => (
          <section key={s.id} id={s.id} className="mt-10 scroll-mt-6">
            <h2 className="text-lg font-semibold text-neutral-950">{s.h}</h2>
            {s.body.map((b, i) => <Body key={i} b={b} />)}
          </section>
        ))}
      </main>
      <footer className="border-t">
        <div className="container py-8 text-sm text-neutral-500">© {new Date().getFullYear()} {C.legalName} · {mail}</div>
      </footer>
    </div>
  );
}
