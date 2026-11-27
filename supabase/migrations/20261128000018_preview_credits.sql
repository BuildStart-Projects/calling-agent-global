-- Voice previews and preview-text translation are billed to the Orchestrator.
-- Previews were seeded at 0 credits; set a starting rate unless an admin has already priced them.
insert into public.credit_rules (meter, unit, credits, rounding)
select 'voice_preview', 'per_unit', 0.1, 'exact'
where coalesce((public.current_rate('voice_preview', 'per_unit')).credits, 0) = 0
  and not exists (select 1 from public.credit_rules where meter = 'voice_preview' and created_by is not null);

-- Short, single-purpose prompt (editable in Superadmin → Prompts).
insert into public.prompt_templates (key, version, active, body)
select 'preview.translate', 1, true,
$T$Translate the user's text into {{language_name}}. Keep the meaning and a natural, spoken phone tone. Use at most 10 words. Reply with only the translation.$T$
where not exists (select 1 from public.prompt_templates where key = 'preview.translate');
