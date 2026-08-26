-- =============================================================================
-- SkoolPartner - 012 - Foto's per workshopsoort
-- =============================================================================
-- De foto's staan op skoolworkshop.nl zelf. Hier leggen we alleen vast welke
-- foto bij welke workshopnaam hoort. Aanpasbaar via Admin > Instellingen,
-- zonder programmeerwerk: het is gewoon een lijstje sleutel naar adres.
--
-- De sleutel wordt gezocht in de workshopnaam van de boeking. De langste
-- passende sleutel wint, zodat "light graffiti" niet de gewone graffitifoto
-- pakt. Staat er niets bij, dan toont het portaal een rustig vlak in de
-- huisstijl in plaats van een verkeerde foto.
-- =============================================================================

insert into public.app_settings (key, value, label, description, group_name, value_type, is_public, sort_order) values
  ('workshop_images', '{
  "3d printerpen": "https://skoolworkshop.nl/wp-content/uploads/2024/07/MDC05556-scaled-e1781612569521-1024x382.jpg",
  "bodypercussie": "https://skoolworkshop.nl/wp-content/uploads/2020/07/Workshop-Ghetto-Drums-10-1024x683.jpg",
  "bootcamp": "https://skoolworkshop.nl/wp-content/uploads/2026/06/Workshop-Bootcamp-e1781614313226-1024x416.jpg",
  "breakdance": "https://skoolworkshop.nl/wp-content/uploads/2020/07/Website-fotos-Hersteld_0008s_0008_6L6A5965-Verbeterd-NR-1024x576.jpg",
  "caribbean drums": "https://skoolworkshop.nl/wp-content/uploads/2020/10/6-Workshop-Carribean-Drums-1024x576.jpg",
  "cultuurdag": "https://skoolworkshop.nl/wp-content/uploads/2020/07/Cultuurdag-op-school-1024x683.jpg",
  "dans": "https://skoolworkshop.nl/wp-content/uploads/2019/12/Dans-Website-1024x683.jpg",
  "dj": "https://skoolworkshop.nl/wp-content/uploads/2023/02/2-Workshop-Dj-Skills-1024x576.jpg",
  "dj skills": "https://skoolworkshop.nl/wp-content/uploads/2023/02/2-Workshop-Dj-Skills-1024x576.jpg",
  "flashmob": "https://skoolworkshop.nl/wp-content/uploads/2026/06/Workshop-Flashmob-1024x576.jpg",
  "freerunning": "https://skoolworkshop.nl/wp-content/uploads/2020/07/Website-fotos-Hersteld_0006s_0000_Workshop-ISL-30-1024x576.jpg",
  "ghetto drums": "https://skoolworkshop.nl/wp-content/uploads/2020/07/Workshop-Ghetto-Drums-12-1024x683.jpg",
  "graffiti": "https://skoolworkshop.nl/wp-content/uploads/2020/06/0006s_0000_8-Montessori-Lyceum-Rotterdam-1024x576.jpg",
  "hiphop": "https://skoolworkshop.nl/wp-content/uploads/2019/12/Dans-Website-1024x683.jpg",
  "kickboksen": "https://skoolworkshop.nl/wp-content/uploads/2020/07/6L6A5932-Verbeterd-NR-1024x576.jpg",
  "korte film": "https://skoolworkshop.nl/wp-content/uploads/2020/07/0004s_0000_15-Workshops-British-School-1024x576.jpg",
  "liedje maken": "https://skoolworkshop.nl/wp-content/uploads/2025/10/5-Workshop-Rap-Zang-1.jpg",
  "light graffiti": "https://skoolworkshop.nl/wp-content/uploads/2020/07/1-Wrokshop-Light-Graffiti--1024x576.jpg",
  "live looping": "https://skoolworkshop.nl/wp-content/uploads/2025/10/1-Workshop-Rap-Zang.jpg",
  "pannavoetbal": "https://skoolworkshop.nl/wp-content/uploads/2026/06/Workshop-Pannavoetbal-1024x576.jpg",
  "podcast": "https://skoolworkshop.nl/wp-content/uploads/2023/02/Website-fotos_0000s_0001_14-Introductiedag-Curio-Breda-1024x576.jpg",
  "popstar": "https://skoolworkshop.nl/wp-content/uploads/2025/10/5-Workshop-Rap-Zang-1.jpg",
  "rap": "https://skoolworkshop.nl/wp-content/uploads/2020/07/Website-fotos-Hersteld_0010s_0001_17-Comenius-College-Hilversum-1024x576.jpg",
  "smartphone fotografie": "https://skoolworkshop.nl/wp-content/uploads/2020/11/Foto-6-1024x682.jpg",
  "soap acteren": "https://skoolworkshop.nl/wp-content/uploads/2026/06/Workshop-Soap-1024x576.jpg",
  "stage fighting": "https://skoolworkshop.nl/wp-content/uploads/2020/07/Website-fotos-Hersteld_0009s_0001_3-Workshopdag-Curio-Roosendaal-1024x576.jpg",
  "stop motion": "https://skoolworkshop.nl/wp-content/uploads/2020/07/0008s_0002_MDC05818-1024x576.jpg",
  "streetdance": "https://skoolworkshop.nl/wp-content/uploads/2020/09/hele-groep-1024x517.jpg",
  "t shirt ontwerpen": "https://skoolworkshop.nl/wp-content/uploads/2020/07/23-Workshops-British-School-1024x683.jpg",
  "theatersport": "https://skoolworkshop.nl/wp-content/uploads/2019/12/Theater.jpg",
  "videoclip": "https://skoolworkshop.nl/wp-content/uploads/2025/07/Videoclip-Maken_0007_Workshop-ISL-16-1024x576.jpg",
  "vloggen": "https://skoolworkshop.nl/wp-content/uploads/2021/04/Vloggen-workshop-1024x801.jpg",
  "zelfverdediging": "https://skoolworkshop.nl/wp-content/uploads/2020/07/6L6A6020-Verbeterd-NR-1024x576.jpg"
}'::jsonb, 'Foto per workshopsoort',
   'Een lijst met workshopnaam en het adres van de foto. De foto''s staan op skoolworkshop.nl, dus een nieuwe foto op de website betekent automatisch een nieuwe foto in het portaal.',
   'programma', 'json', true, 270)
on conflict (key) do nothing;
