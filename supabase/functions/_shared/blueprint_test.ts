import { assertEquals } from "jsr:@std/assert@1";
import { mergePatch, readiness, type KnowledgeSnapshot } from "./blueprint.ts";

Deno.test("mergePatch applies nested fields and skips locked paths", () => {
  const target: Record<string, unknown> = { business: { name: "Old", industry: "salon" } };
  const r = mergePatch(target, { business: { name: "New", description: "Hair salon" }, tone: "friendly" }, new Set(["business.name"]));
  assertEquals((target.business as Record<string, string>).name, "Old");
  assertEquals((target.business as Record<string, string>).description, "Hair salon");
  assertEquals(r.skipped, ["business.name"]);
  assertEquals(r.applied.sort(), ["business.description", "tone"]);
});

Deno.test("readiness scores booking requirements", () => {
  const k: KnowledgeSnapshot = {
    blueprint: { business: { name: "Bella", description: "Salon", address: "Main St" }, collect_fields: ["name"] },
    catalog: [{ ref: "s1", kind: "service", name: "Cut", price_minor: 4000, price_from: false, currency: "USD", duration_minutes: 45, description: null, locked: false }],
    faqs: [], availabilityDays: 5, handoffPhone: null, lockedFields: [],
  };
  const r = readiness("booking", k);
  assertEquals(r.score, 85);
  assertEquals(r.missing, ["handoff phone number"]);
});
