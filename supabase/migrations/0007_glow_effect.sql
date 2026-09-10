-- Valfri, manuellt positionerad "glow overlay"-effekt (t.ex. en tatuering/symbol som ska se
-- ut att glöda). Statisk position under ett tidsintervall i klippets FÄRDIGA tidslinje —
-- INGEN AI-baserad objektspårning. Se render-clip.ts (glowClips) och Klippstudio
-- (positioneringsrutan).
alter table clips add column if not exists glow_effect jsonb;
