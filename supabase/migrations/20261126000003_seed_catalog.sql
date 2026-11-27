-- Initial plans, top-up packs, credit rules and platform settings. All editable in superadmin.

insert into public.plans (key, name, tagline, price_minor, monthly_credits, limits, features, badge, cta_label, sort) values
('free', 'Free', 'Try your AI agent on your own number.', 0, 15,
 '{"max_agents":1,"max_active_campaigns":1,"max_campaign_targets_per_month":100,"max_concurrent_campaign_calls":1,"voice_preview_daily":10,"recording_retention_days":30,"max_call_seconds":600}',
 '[{"label":"AI calling & messaging agent","included":true},{"label":"WhatsApp QR connect","included":true},{"label":"Bookings, orders & leads","included":true},{"label":"Email support (best effort)","included":true},{"label":"Campaigns (100 contacts / month)","included":true},{"label":"Priority support","included":false}]',
 null, 'Start free', 1),
('pro', 'Pro', 'For growing businesses that live on WhatsApp.', 1900, 100,
 '{"max_agents":3,"max_active_campaigns":5,"max_campaign_targets_per_month":2000,"max_concurrent_campaign_calls":2,"voice_preview_daily":40,"recording_retention_days":90,"max_call_seconds":900}',
 '[{"label":"Everything in Free","included":true},{"label":"Up to 3 agents","included":true,"highlight":true},{"label":"Campaigns & quick campaigns","included":true},{"label":"Call recordings & transcripts (90 days)","included":true},{"label":"Email support · 24h response","included":true},{"label":"Guided onboarding","included":true}]',
 'Most popular', 'Get Pro', 2),
('enterprise', 'Enterprise', 'For busy teams and multiple locations.', 4900, 300,
 '{"max_agents":10,"max_active_campaigns":1000,"max_campaign_targets_per_month":10000,"max_concurrent_campaign_calls":3,"voice_preview_daily":100,"recording_retention_days":365,"max_call_seconds":1200}',
 '[{"label":"Everything in Pro","included":true},{"label":"Up to 10 agents","included":true,"highlight":true},{"label":"Unlimited active campaigns","included":true},{"label":"Priority support · chat & WhatsApp, 4h response","included":true,"highlight":true},{"label":"Dedicated onboarding call","included":true},{"label":"Early access to new features","included":true}]',
 null, 'Get Enterprise', 3);

insert into public.topup_packs (name, credits, price_minor, validity_days, badge, active, sort) values
('Starter', 50, 1000, 365, null, true, 1),
('Standard', 100, 2000, 365, null, true, 2),
('Bulk', 250, 4500, 365, 'Best value', false, 3);

-- Seed credit rules (calibrate in superadmin). 1 credit ≈ 1 call minute ≈ ~10 chat replies.
insert into public.credit_rules (meter, unit, credits, rounding) values
('call_minutes', 'per_minute', 1, 'ceil_second'),
('campaign_call_minutes', 'per_minute', 1, 'ceil_second'),
('call_analysis_tokens', 'per_1m_input_tokens', 5, 'exact'),
('call_analysis_tokens', 'per_1m_output_tokens', 20, 'exact'),
('voice_preview', 'per_unit', 0, 'exact'),
('messaging_tokens', 'per_1m_input_tokens', 25, 'exact'),
('messaging_tokens', 'per_1m_output_tokens', 100, 'exact'),
('messaging_units', 'per_unit', 0, 'exact'),
('playground_tokens', 'per_1m_input_tokens', 25, 'exact'),
('playground_tokens', 'per_1m_output_tokens', 100, 'exact'),
('orchestrator_tokens', 'per_1m_input_tokens', 25, 'exact'),
('orchestrator_tokens', 'per_1m_output_tokens', 100, 'exact'),
('doc_extraction_tokens', 'per_1m_input_tokens', 25, 'exact'),
('doc_extraction_tokens', 'per_1m_output_tokens', 100, 'exact');

insert into public.platform_settings (key, value) values
('models', '{"orchestrator":"google/gemini-3-flash-preview","messaging":"google/gemini-3-flash-preview","extractor":"google/gemini-2.5-flash-lite","summarizer":"google/gemini-3-flash-preview","light":"google/gemini-2.5-flash-lite","live_preview":"models/gemini-3.1-flash-live-preview"}'),
('orchestrator_max_questions', '5'),
('first_agent_setup_free', 'true'),
('negative_balance_floor', '-20'),
('low_credit_threshold_pct', '20'),
('upload_limits', '{"max_mb":10,"per_turn":5,"per_agent":20}'),
('campaign_safety', '{"quiet_start":"21:00","quiet_end":"08:00","default_daily_cap":80,"max_daily_cap":300,"failure_pause_ratio":0.4,"failure_window":20}'),
('feature_flags', '{"campaigns_live":false,"voice_tools_enabled":true}'),
('maintenance_banner', 'null');
