// JSON action protocol for the Orchestrator (the ai-generate transport has no native function calling).

export type Envelope = {
  reply?: string;
  actions?: Array<{ tool: string; args?: Record<string, unknown> }>;
  question?: { text?: string; suggestions?: string[]; topic?: string } | null;
  finish?: { summary?: string; defaults_applied?: string[]; recommended_next?: string[] } | null;
  off_topic?: boolean;
};

export const PROTOCOL = (actions: string, allowQuestion: boolean, allowFinish: boolean) => `
OUTPUT FORMAT (MANDATORY)
Reply with ONE JSON object and nothing else:
{"reply": string, "actions": [{"tool": string, "args": object}], "question": {"text": string, "suggestions": [string], "topic": string} | null, "finish": {"summary": string, "defaults_applied": [string], "recommended_next": [string]} | null, "off_topic": boolean}
- "reply": your short message to the owner (confirm what you saved). Do NOT put your question here.
- "actions": the tools to run now (may be empty). Available actions:
${actions}
- "question": ${allowQuestion ? "this is how you ask_question — exactly one question with 2–4 short suggestions, or null." : "must be null (no questions allowed now)."}
- "finish": ${allowFinish ? "this is finish_onboarding — fill it when setup is complete or no questions remain, else null." : "must be null."}
- "off_topic": true is decline_off_topic — set it when the request is unrelated (then reply, actions, question and finish are ignored).
Use plain text in strings (no markdown). Never include anything outside the JSON object.`;

