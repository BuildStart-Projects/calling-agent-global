import { assert, assertFalse } from "jsr:@std/assert@1";
import { signEngine, verifyEngine } from "./hmac.ts";

Deno.test("valid signature verifies", async () => {
  const body = JSON.stringify({ event: "call.completed" });
  const sig = await signEngine("s3cret", body);
  assert(await verifyEngine("s3cret", sig, body));
});

Deno.test("tampered body, wrong secret and stale timestamps are rejected", async () => {
  const body = "{}";
  const sig = await signEngine("s3cret", body);
  assertFalse(await verifyEngine("s3cret", sig, "{ }"));
  assertFalse(await verifyEngine("other", sig, body));
  const old = await signEngine("s3cret", body, Math.floor(Date.now() / 1000) - 3600);
  assertFalse(await verifyEngine("s3cret", old, body));
  assertFalse(await verifyEngine("s3cret", null, body));
});
