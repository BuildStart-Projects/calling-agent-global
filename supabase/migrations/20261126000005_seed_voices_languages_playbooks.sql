-- Gemini Live prebuilt voices (verify against current Google docs; editable in superadmin).
insert into public.voices (name, display_name, descriptor, tags, sort) values
('Aoede','Aoede','Breezy','{warm,friendly}',1),('Kore','Kore','Firm','{clear,professional}',2),('Puck','Puck','Upbeat','{energetic}',3),
('Charon','Charon','Informative','{clear,deep}',4),('Zephyr','Zephyr','Bright','{energetic,friendly}',5),('Leda','Leda','Youthful','{friendly}',6),
('Orus','Orus','Firm','{deep,professional}',7),('Fenrir','Fenrir','Excitable','{energetic}',8),('Callirrhoe','Callirrhoe','Easy-going','{warm}',9),
('Autonoe','Autonoe','Bright','{clear}',10),('Enceladus','Enceladus','Breathy','{warm}',11),('Iapetus','Iapetus','Clear','{clear}',12),
('Umbriel','Umbriel','Easy-going','{warm}',13),('Algieba','Algieba','Smooth','{warm,deep}',14),('Despina','Despina','Smooth','{warm}',15),
('Erinome','Erinome','Clear','{clear}',16),('Algenib','Algenib','Gravelly','{deep}',17),('Rasalgethi','Rasalgethi','Informative','{clear,professional}',18),
('Laomedeia','Laomedeia','Upbeat','{energetic}',19),('Achernar','Achernar','Soft','{warm,gentle}',20),('Alnilam','Alnilam','Firm','{professional}',21),
('Schedar','Schedar','Even','{professional}',22),('Gacrux','Gacrux','Mature','{deep}',23),('Pulcherrima','Pulcherrima','Forward','{energetic}',24),
('Achird','Achird','Friendly','{friendly,warm}',25),('Zubenelgenubi','Zubenelgenubi','Casual','{friendly}',26),('Vindemiatrix','Vindemiatrix','Gentle','{gentle,warm}',27),
('Sadachbia','Sadachbia','Lively','{energetic}',28),('Sadaltager','Sadaltager','Knowledgeable','{professional}',29),('Sulafat','Sulafat','Warm','{warm,gentle}',30);

-- Languages for the Calling Agent default (verify Gemini Live support at build time; editable in superadmin).
insert into public.languages (code, label, native_label, sort) values
('en-US','English (US)','English (US)',1),('en-GB','English (UK)','English (UK)',2),('en-IN','English (India)','English (India)',3),
('en-AU','English (Australia)','English (Australia)',4),('es-ES','Spanish (Spain)','Español (España)',10),('es-US','Spanish (Latin America)','Español (Latinoamérica)',11),
('fr-FR','French','Français',12),('de-DE','German','Deutsch',13),('it-IT','Italian','Italiano',14),('pt-BR','Portuguese (Brazil)','Português (Brasil)',15),
('pt-PT','Portuguese (Portugal)','Português (Portugal)',16),('nl-NL','Dutch','Nederlands',17),('pl-PL','Polish','Polski',18),('ro-RO','Romanian','Română',19),
('ru-RU','Russian','Русский',20),('uk-UA','Ukrainian','Українська',21),('tr-TR','Turkish','Türkçe',22),('ar-EG','Arabic (Egypt)','العربية (مصر)',23),
('ar-SA','Arabic (Gulf)','العربية',24),('hi-IN','Hindi','हिन्दी',25),('bn-IN','Bengali','বাংলা',26),('mr-IN','Marathi','मराठी',27),
('ta-IN','Tamil','தமிழ்',28),('te-IN','Telugu','తెలుగు',29),('si-LK','Sinhala','සිංහල',30),('ur-PK','Urdu','اردو',31),
('id-ID','Indonesian','Bahasa Indonesia',32),('ms-MY','Malay','Bahasa Melayu',33),('th-TH','Thai','ไทย',34),('vi-VN','Vietnamese','Tiếng Việt',35),
('ja-JP','Japanese','日本語',36),('ko-KR','Korean','한국어',37),('cmn-CN','Chinese (Mandarin)','中文（普通话）',38),('fil-PH','Filipino','Filipino',39),
('sw-KE','Swahili','Kiswahili',40),('af-ZA','Afrikaans','Afrikaans',41);

insert into public.industry_playbooks (key, label, match_keywords, defaults, campaign_defaults, template_key) values
('salon','Salon & beauty','{salon,hair,barber,beauty,spa,nail,makeup,lash,brow,massage}',
 '{"collect_fields":["name","preferred_staff"],"goal":"appointment","tone":"friendly"}','{"quick":["confirm_tomorrow","win_back"]}','playbook.salon'),
('home_services','Home services','{plumb,electric,carpent,handyman,clean,hvac,roof,paint,locksmith,pest,repair,install}',
 '{"collect_fields":["name","address","problem_description","preferred_time"],"goal":"book_visit","tone":"friendly","emergency_rule":"For gas smells, sparking, flooding near electrics or similar danger, tell the customer to stay safe and contact local emergency services first, then offer the earliest visit."}',
 '{"quick":["follow_up_inquiries","missed_callers"]}','playbook.home_services'),
('dental','Dental','{dental,dentist,orthodont,teeth,tooth}',
 '{"collect_fields":["name","new_or_returning","reason_for_visit"],"goal":"appointment","tone":"reassuring","emergency_rule":"Never give medical advice or a diagnosis. For severe pain, swelling or bleeding, advise contacting local emergency services or the clinic''s emergency line."}',
 '{"quick":["confirm_tomorrow","feedback"]}','playbook.dental'),
('clinic','Clinic & health','{clinic,doctor,physio,therap,medical,health,chiropract,psycholog,vet}',
 '{"collect_fields":["name","new_or_returning","reason_for_visit"],"goal":"appointment","tone":"reassuring","emergency_rule":"Never give medical advice or a diagnosis. In an emergency, tell the caller to contact local emergency services immediately."}',
 '{"quick":["confirm_tomorrow","feedback"]}','playbook.clinic'),
('restaurant','Restaurant & food','{restaurant,cafe,bakery,food,pizza,burger,kitchen,catering,cake,coffee}',
 '{"collect_fields":["name","address","delivery_time"],"goal":"order","tone":"friendly"}','{"quick":["win_back"]}','playbook.restaurant'),
('retail','Retail & shop','{shop,store,boutique,retail,florist,flower,gift,clothing,electronics}',
 '{"collect_fields":["name","address"],"goal":"order","tone":"friendly"}','{"quick":["win_back","follow_up_inquiries"]}','playbook.retail'),
('fitness_tutoring','Fitness & tutoring','{gym,fitness,trainer,yoga,pilates,tutor,lesson,class,coach,school}',
 '{"collect_fields":["name","goal_or_level"],"goal":"appointment","tone":"energetic"}','{"quick":["follow_up_inquiries"]}','playbook.fitness_tutoring'),
('generic','General business','{}','{"collect_fields":["name"],"goal":"callback","tone":"friendly"}','{"quick":["follow_up_inquiries"]}','playbook.generic');
