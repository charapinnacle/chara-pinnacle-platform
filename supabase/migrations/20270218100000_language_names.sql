-- CLDR names Twi "Akan", the name of ak as well, and Tagalog only "Filipino", so a member searching the language list
-- for Twi or Tagalog found nothing. The seeds carry the same names (scripts/gen-ref-seeds.mjs, LANGUAGE_NAMES).
update public.languages set name = 'Twi' where code = 'tw';
update public.languages set name = 'Filipino (Tagalog)' where code = 'tl';
