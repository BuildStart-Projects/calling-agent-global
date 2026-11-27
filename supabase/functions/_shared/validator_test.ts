import { assertEquals } from "jsr:@std/assert@1";
import { validateReply } from "./validator.ts";

const KB = "Haircut (45 min): 40 USD\nColour (120 min): from 120 USD\nHours: Tue–Sat 09:00–18:00\nPhone +1 512 555 0199";

Deno.test("grounded replies pass", () => {
  assertEquals(validateReply("A *Haircut* is 40 USD and takes 45 minutes.", KB), []);
  assertEquals(validateReply("We're open until 6pm on Saturday.", KB), []);
});

Deno.test("invented prices, times, numbers and links are caught", () => {
  assertEquals(validateReply("A haircut is $35 today!", KB).map((i) => i.kind), ["amount"]);
  assertEquals(validateReply("Come at 7:15pm", KB).map((i) => i.kind), ["time"]);
  assertEquals(validateReply("Call us on +1 512 555 7777", KB).map((i) => i.kind), ["number"]);
  assertEquals(validateReply("Book at https://bella.example/book", KB).map((i) => i.kind), ["url"]);
});
