// Human replies from the Inbox, sent through the agent's WhatsApp number.
import { z } from "npm:zod@3.25.76";
import { serveHandler, HttpError, json, readJson } from "../_shared/http.ts";
import { requireAgentAccess, serviceClient } from "../_shared/supabase.ts";
import { engine } from "../_shared/engine.ts";

const Body = z.object({ conversation_id: z.string().uuid(), text: z.string().trim().min(1).max(4000), pause_ai: z.boolean().default(true) });

serveHandler("inbox-send", async (req) => {
  const body = Body.parse(await readJson(req));
  const { data: convo } = await serviceClient().from("conversations").select("*, contact:contacts(*)").eq("id", body.conversation_id).maybeSingle();
  if (!convo) throw new HttpError(404, "not_found", "Conversation not found.");
  const { db, agent } = await requireAgentAccess(req, convo.agent_id);
  if (convo.is_test) throw new HttpError(400, "test_conversation", "This is a test conversation.");
  if (agent.wa_status !== "connected" || !agent.engine_session_id) throw new HttpError(409, "not_connected", "WhatsApp is disconnected. Reconnect to send messages.");
  const to = convo.contact.phone_e164 ?? convo.contact.wa_jid;
  const sent = await engine.sendText(agent.engine_session_id, to, body.text);
  const { data: msg } = await db.from("messages").insert({ conversation_id: convo.id, direction: "out", sender: "human", text: body.text, wa_message_id: sent.message_id, status: "sent" }).select("*").single();
  await db.from("conversations").update({
    last_message_at: new Date().toISOString(), last_message_preview: body.text.slice(0, 140), unread_count: 0, needs_attention: false,
    ...(body.pause_ai ? { ai_paused: true, paused_by: "inbox", paused_until: null } : {}),
  }).eq("id", convo.id);
  return json(req, { message: msg });
});
