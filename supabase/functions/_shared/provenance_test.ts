import { assert, assertFalse } from "jsr:@std/assert@1";
import { Provenance } from "./provenance.ts";

Deno.test("prices, durations and times must come from the owner's words", () => {
  const p = new Provenance("Haircut is $40 and takes 45 minutes, colour 2 hours from 120. Open 9 to 6, Sat 10-2. Call me on 0771234567");
  assert(p.price(40));
  assertFalse(p.price(45.5));
  assert(p.duration(45));
  assert(p.duration(120));
  assertFalse(p.duration(50));
  assert(p.time("09:00"));
  assert(p.time("18:00"));
  assert(p.time("14:00"));
  assertFalse(p.time("20:00"));
  assert(p.phone("+94771234567"));
  assertFalse(p.phone("+15550001111"));
  assert(p.text("A haircut costs 40"));
  assertFalse(p.text("A haircut costs 55"));
});

Deno.test("number words count as stated values", () => {
  const p = new Provenance("We have two chairs and a dozen nail colours");
  assert(p.hasNumber(2));
  assert(p.hasNumber(12));
  assertFalse(p.hasNumber(3));
});
