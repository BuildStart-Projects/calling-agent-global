// Legal entity and public contact details used on the landing page, legal pages and support links.
export const COMPANY = {
  brand: "BuildStart",
  legalName: "BuildStart (Pvt) Ltd",
  country: "Sri Lanka",
  email: "hello@buildstart.io",
  /** Public site address. Set VITE_SITE_URL in Vercel when the custom domain is live. */
  siteUrl: (import.meta.env.VITE_SITE_URL as string | undefined)?.replace(/\/$/, "") || (typeof window !== "undefined" ? window.location.origin : ""),
  legalUpdated: "27 November 2026",
} as const;
