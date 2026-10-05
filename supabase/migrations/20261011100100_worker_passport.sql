-- Candidate profile, the CHARA Passport (FR-B1; ARCHITECTURE.md sections 4, 5; OPEN_QUESTIONS.md D13). One worker_profiles
-- row per candidate, created only by create_worker_passport and private by default; the owner reads and edits it and its
-- four child tables through the Data API under row level security. Nothing here stores an identity number, a date of
-- birth, an age, a nationality, a gender, a religion or a marital status: work authorisation is a country and an optional
-- expiry date (NFR-C1). Employers see a candidate only through the application snapshot (FR-B3, a later unit), staff and
-- service_role have no path to these tables.

create type public.worker_availability as enum ('now', 'from_date', 'unavailable');
create type public.cefr_level as enum ('A1', 'A2', 'B1', 'B2', 'C1', 'C2');

-- Proposed defaults, owner-changeable data: the list limits and the date windows (FR-B1 open points).
insert into private.settings (key, value) values
  ('worker_skills_max', '30'),
  ('worker_languages_max', '15'),
  ('worker_preferred_countries_max', '20'),
  ('availability_window_months', '24'),
  ('work_authorization_expiry_max_years', '50');

-- A name is trimmed and made of letters and combining marks (Unicode categories L and M), spaces, hyphens, apostrophes
-- and full stops, starting with a letter or a mark. The letters and marks are explicit code point ranges, listed from the
-- Unicode 17 tables, rather than a POSIX class, so the rule does not depend on the locale of the database; digits,
-- symbols, punctuation and invisible characters are outside them. The web tier applies the same rule with the Unicode
-- property classes \p{L} and \p{M} (apps/web/lib/validation/passport.ts).
create function private.is_person_name(p_name text) returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_letters constant text :=
    '\u0041-\u005a\u0061-\u007a\u00aa\u00b5\u00ba\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u02c1\u02c6-\u02d1' ||
    '\u02e0-\u02e4\u02ec\u02ee\u0300-\u0374\u0376-\u0377\u037a-\u037d\u037f\u0386\u0388-\u038a\u038c' ||
    '\u038e-\u03a1\u03a3-\u03f5\u03f7-\u0481\u0483-\u052f\u0531-\u0556\u0559\u0560-\u0588\u0591-\u05bd' ||
    '\u05bf\u05c1-\u05c2\u05c4-\u05c5\u05c7\u05d0-\u05ea\u05ef-\u05f2\u0610-\u061a\u0620-\u065f' ||
    '\u066e-\u06d3\u06d5-\u06dc\u06df-\u06e8\u06ea-\u06ef\u06fa-\u06fc\u06ff\u0710-\u074a\u074d-\u07b1' ||
    '\u07ca-\u07f5\u07fa\u07fd\u0800-\u082d\u0840-\u085b\u0860-\u086a\u0870-\u0887\u0889-\u088f' ||
    '\u0897-\u08e1\u08e3-\u0963\u0971-\u0983\u0985-\u098c\u098f-\u0990\u0993-\u09a8\u09aa-\u09b0\u09b2' ||
    '\u09b6-\u09b9\u09bc-\u09c4\u09c7-\u09c8\u09cb-\u09ce\u09d7\u09dc-\u09dd\u09df-\u09e3\u09f0-\u09f1' ||
    '\u09fc\u09fe\u0a01-\u0a03\u0a05-\u0a0a\u0a0f-\u0a10\u0a13-\u0a28\u0a2a-\u0a30\u0a32-\u0a33' ||
    '\u0a35-\u0a36\u0a38-\u0a39\u0a3c\u0a3e-\u0a42\u0a47-\u0a48\u0a4b-\u0a4d\u0a51\u0a59-\u0a5c\u0a5e' ||
    '\u0a70-\u0a75\u0a81-\u0a83\u0a85-\u0a8d\u0a8f-\u0a91\u0a93-\u0aa8\u0aaa-\u0ab0\u0ab2-\u0ab3' ||
    '\u0ab5-\u0ab9\u0abc-\u0ac5\u0ac7-\u0ac9\u0acb-\u0acd\u0ad0\u0ae0-\u0ae3\u0af9-\u0aff\u0b01-\u0b03' ||
    '\u0b05-\u0b0c\u0b0f-\u0b10\u0b13-\u0b28\u0b2a-\u0b30\u0b32-\u0b33\u0b35-\u0b39\u0b3c-\u0b44' ||
    '\u0b47-\u0b48\u0b4b-\u0b4d\u0b55-\u0b57\u0b5c-\u0b5d\u0b5f-\u0b63\u0b71\u0b82-\u0b83\u0b85-\u0b8a' ||
    '\u0b8e-\u0b90\u0b92-\u0b95\u0b99-\u0b9a\u0b9c\u0b9e-\u0b9f\u0ba3-\u0ba4\u0ba8-\u0baa\u0bae-\u0bb9' ||
    '\u0bbe-\u0bc2\u0bc6-\u0bc8\u0bca-\u0bcd\u0bd0\u0bd7\u0c00-\u0c0c\u0c0e-\u0c10\u0c12-\u0c28' ||
    '\u0c2a-\u0c39\u0c3c-\u0c44\u0c46-\u0c48\u0c4a-\u0c4d\u0c55-\u0c56\u0c58-\u0c5a\u0c5c-\u0c5d' ||
    '\u0c60-\u0c63\u0c80-\u0c83\u0c85-\u0c8c\u0c8e-\u0c90\u0c92-\u0ca8\u0caa-\u0cb3\u0cb5-\u0cb9' ||
    '\u0cbc-\u0cc4\u0cc6-\u0cc8\u0cca-\u0ccd\u0cd5-\u0cd6\u0cdc-\u0cde\u0ce0-\u0ce3\u0cf1-\u0cf3' ||
    '\u0d00-\u0d0c\u0d0e-\u0d10\u0d12-\u0d44\u0d46-\u0d48\u0d4a-\u0d4e\u0d54-\u0d57\u0d5f-\u0d63' ||
    '\u0d7a-\u0d7f\u0d81-\u0d83\u0d85-\u0d96\u0d9a-\u0db1\u0db3-\u0dbb\u0dbd\u0dc0-\u0dc6\u0dca' ||
    '\u0dcf-\u0dd4\u0dd6\u0dd8-\u0ddf\u0df2-\u0df3\u0e01-\u0e3a\u0e40-\u0e4e\u0e81-\u0e82\u0e84' ||
    '\u0e86-\u0e8a\u0e8c-\u0ea3\u0ea5\u0ea7-\u0ebd\u0ec0-\u0ec4\u0ec6\u0ec8-\u0ece\u0edc-\u0edf\u0f00' ||
    '\u0f18-\u0f19\u0f35\u0f37\u0f39\u0f3e-\u0f47\u0f49-\u0f6c\u0f71-\u0f84\u0f86-\u0f97\u0f99-\u0fbc' ||
    '\u0fc6\u1000-\u103f\u1050-\u108f\u109a-\u109d\u10a0-\u10c5\u10c7\u10cd\u10d0-\u10fa\u10fc-\u1248' ||
    '\u124a-\u124d\u1250-\u1256\u1258\u125a-\u125d\u1260-\u1288\u128a-\u128d\u1290-\u12b0\u12b2-\u12b5' ||
    '\u12b8-\u12be\u12c0\u12c2-\u12c5\u12c8-\u12d6\u12d8-\u1310\u1312-\u1315\u1318-\u135a\u135d-\u135f' ||
    '\u1380-\u138f\u13a0-\u13f5\u13f8-\u13fd\u1401-\u166c\u166f-\u167f\u1681-\u169a\u16a0-\u16ea' ||
    '\u16f1-\u16f8\u1700-\u1715\u171f-\u1734\u1740-\u1753\u1760-\u176c\u176e-\u1770\u1772-\u1773' ||
    '\u1780-\u17d3\u17d7\u17dc-\u17dd\u180b-\u180d\u180f\u1820-\u1878\u1880-\u18aa\u18b0-\u18f5' ||
    '\u1900-\u191e\u1920-\u192b\u1930-\u193b\u1950-\u196d\u1970-\u1974\u1980-\u19ab\u19b0-\u19c9' ||
    '\u1a00-\u1a1b\u1a20-\u1a5e\u1a60-\u1a7c\u1a7f\u1aa7\u1ab0-\u1add\u1ae0-\u1aeb\u1b00-\u1b4c' ||
    '\u1b6b-\u1b73\u1b80-\u1baf\u1bba-\u1bf3\u1c00-\u1c37\u1c4d-\u1c4f\u1c5a-\u1c7d\u1c80-\u1c8a' ||
    '\u1c90-\u1cba\u1cbd-\u1cbf\u1cd0-\u1cd2\u1cd4-\u1cfa\u1d00-\u1f15\u1f18-\u1f1d\u1f20-\u1f45' ||
    '\u1f48-\u1f4d\u1f50-\u1f57\u1f59\u1f5b\u1f5d\u1f5f-\u1f7d\u1f80-\u1fb4\u1fb6-\u1fbc\u1fbe' ||
    '\u1fc2-\u1fc4\u1fc6-\u1fcc\u1fd0-\u1fd3\u1fd6-\u1fdb\u1fe0-\u1fec\u1ff2-\u1ff4\u1ff6-\u1ffc\u2071' ||
    '\u207f\u2090-\u209c\u20d0-\u20f0\u2102\u2107\u210a-\u2113\u2115\u2119-\u211d\u2124\u2126\u2128' ||
    '\u212a-\u212d\u212f-\u2139\u213c-\u213f\u2145-\u2149\u214e\u2183-\u2184\u2c00-\u2ce4\u2ceb-\u2cf3' ||
    '\u2d00-\u2d25\u2d27\u2d2d\u2d30-\u2d67\u2d6f\u2d7f-\u2d96\u2da0-\u2da6\u2da8-\u2dae\u2db0-\u2db6' ||
    '\u2db8-\u2dbe\u2dc0-\u2dc6\u2dc8-\u2dce\u2dd0-\u2dd6\u2dd8-\u2dde\u2de0-\u2dff\u2e2f\u3005-\u3006' ||
    '\u302a-\u302f\u3031-\u3035\u303b-\u303c\u3041-\u3096\u3099-\u309a\u309d-\u309f\u30a1-\u30fa' ||
    '\u30fc-\u30ff\u3105-\u312f\u3131-\u318e\u31a0-\u31bf\u31f0-\u31ff\u3400-\u4dbf\u4e00-\ua48c' ||
    '\ua4d0-\ua4fd\ua500-\ua60c\ua610-\ua61f\ua62a-\ua62b\ua640-\ua672\ua674-\ua67d\ua67f-\ua6e5' ||
    '\ua6f0-\ua6f1\ua717-\ua71f\ua722-\ua788\ua78b-\ua7dc\ua7f1-\ua827\ua82c\ua840-\ua873\ua880-\ua8c5' ||
    '\ua8e0-\ua8f7\ua8fb\ua8fd-\ua8ff\ua90a-\ua92d\ua930-\ua953\ua960-\ua97c\ua980-\ua9c0\ua9cf' ||
    '\ua9e0-\ua9ef\ua9fa-\ua9fe\uaa00-\uaa36\uaa40-\uaa4d\uaa60-\uaa76\uaa7a-\uaac2\uaadb-\uaadd' ||
    '\uaae0-\uaaef\uaaf2-\uaaf6\uab01-\uab06\uab09-\uab0e\uab11-\uab16\uab20-\uab26\uab28-\uab2e' ||
    '\uab30-\uab5a\uab5c-\uab69\uab70-\uabea\uabec-\uabed\uac00-\ud7a3\ud7b0-\ud7c6\ud7cb-\ud7fb' ||
    '\uf900-\ufa6d\ufa70-\ufad9\ufb00-\ufb06\ufb13-\ufb17\ufb1d-\ufb28\ufb2a-\ufb36\ufb38-\ufb3c\ufb3e' ||
    '\ufb40-\ufb41\ufb43-\ufb44\ufb46-\ufbb1\ufbd3-\ufd3d\ufd50-\ufd8f\ufd92-\ufdc7\ufdf0-\ufdfb' ||
    '\ufe00-\ufe0f\ufe20-\ufe2f\ufe70-\ufe74\ufe76-\ufefc\uff21-\uff3a\uff41-\uff5a\uff66-\uffbe' ||
    '\uffc2-\uffc7\uffca-\uffcf\uffd2-\uffd7\uffda-\uffdc\U00010000-\U0001000b\U0001000d-\U00010026' ||
    '\U00010028-\U0001003a\U0001003c-\U0001003d\U0001003f-\U0001004d\U00010050-\U0001005d' ||
    '\U00010080-\U000100fa\U000101fd\U00010280-\U0001029c\U000102a0-\U000102d0\U000102e0' ||
    '\U00010300-\U0001031f\U0001032d-\U00010340\U00010342-\U00010349\U00010350-\U0001037a' ||
    '\U00010380-\U0001039d\U000103a0-\U000103c3\U000103c8-\U000103cf\U00010400-\U0001049d' ||
    '\U000104b0-\U000104d3\U000104d8-\U000104fb\U00010500-\U00010527\U00010530-\U00010563' ||
    '\U00010570-\U0001057a\U0001057c-\U0001058a\U0001058c-\U00010592\U00010594-\U00010595' ||
    '\U00010597-\U000105a1\U000105a3-\U000105b1\U000105b3-\U000105b9\U000105bb-\U000105bc' ||
    '\U000105c0-\U000105f3\U00010600-\U00010736\U00010740-\U00010755\U00010760-\U00010767' ||
    '\U00010780-\U00010785\U00010787-\U000107b0\U000107b2-\U000107ba\U00010800-\U00010805\U00010808' ||
    '\U0001080a-\U00010835\U00010837-\U00010838\U0001083c\U0001083f-\U00010855\U00010860-\U00010876' ||
    '\U00010880-\U0001089e\U000108e0-\U000108f2\U000108f4-\U000108f5\U00010900-\U00010915' ||
    '\U00010920-\U00010939\U00010940-\U00010959\U00010980-\U000109b7\U000109be-\U000109bf' ||
    '\U00010a00-\U00010a03\U00010a05-\U00010a06\U00010a0c-\U00010a13\U00010a15-\U00010a17' ||
    '\U00010a19-\U00010a35\U00010a38-\U00010a3a\U00010a3f\U00010a60-\U00010a7c\U00010a80-\U00010a9c' ||
    '\U00010ac0-\U00010ac7\U00010ac9-\U00010ae6\U00010b00-\U00010b35\U00010b40-\U00010b55' ||
    '\U00010b60-\U00010b72\U00010b80-\U00010b91\U00010c00-\U00010c48\U00010c80-\U00010cb2' ||
    '\U00010cc0-\U00010cf2\U00010d00-\U00010d27\U00010d4a-\U00010d65\U00010d69-\U00010d6d' ||
    '\U00010d6f-\U00010d85\U00010e80-\U00010ea9\U00010eab-\U00010eac\U00010eb0-\U00010eb1' ||
    '\U00010ec2-\U00010ec7\U00010efa-\U00010f1c\U00010f27\U00010f30-\U00010f50\U00010f70-\U00010f85' ||
    '\U00010fb0-\U00010fc4\U00010fe0-\U00010ff6\U00011000-\U00011046\U00011070-\U00011075' ||
    '\U0001107f-\U000110ba\U000110c2\U000110d0-\U000110e8\U00011100-\U00011134\U00011144-\U00011147' ||
    '\U00011150-\U00011173\U00011176\U00011180-\U000111c4\U000111c9-\U000111cc\U000111ce-\U000111cf' ||
    '\U000111da\U000111dc\U00011200-\U00011211\U00011213-\U00011237\U0001123e-\U00011241' ||
    '\U00011280-\U00011286\U00011288\U0001128a-\U0001128d\U0001128f-\U0001129d\U0001129f-\U000112a8' ||
    '\U000112b0-\U000112ea\U00011300-\U00011303\U00011305-\U0001130c\U0001130f-\U00011310' ||
    '\U00011313-\U00011328\U0001132a-\U00011330\U00011332-\U00011333\U00011335-\U00011339' ||
    '\U0001133b-\U00011344\U00011347-\U00011348\U0001134b-\U0001134d\U00011350\U00011357' ||
    '\U0001135d-\U00011363\U00011366-\U0001136c\U00011370-\U00011374\U00011380-\U00011389\U0001138b' ||
    '\U0001138e\U00011390-\U000113b5\U000113b7-\U000113c0\U000113c2\U000113c5\U000113c7-\U000113ca' ||
    '\U000113cc-\U000113d3\U000113e1-\U000113e2\U00011400-\U0001144a\U0001145e-\U00011461' ||
    '\U00011480-\U000114c5\U000114c7\U00011580-\U000115b5\U000115b8-\U000115c0\U000115d8-\U000115dd' ||
    '\U00011600-\U00011640\U00011644\U00011680-\U000116b8\U00011700-\U0001171a\U0001171d-\U0001172b' ||
    '\U00011740-\U00011746\U00011800-\U0001183a\U000118a0-\U000118df\U000118ff-\U00011906\U00011909' ||
    '\U0001190c-\U00011913\U00011915-\U00011916\U00011918-\U00011935\U00011937-\U00011938' ||
    '\U0001193b-\U00011943\U000119a0-\U000119a7\U000119aa-\U000119d7\U000119da-\U000119e1' ||
    '\U000119e3-\U000119e4\U00011a00-\U00011a3e\U00011a47\U00011a50-\U00011a99\U00011a9d' ||
    '\U00011ab0-\U00011af8\U00011b60-\U00011b67\U00011bc0-\U00011be0\U00011c00-\U00011c08' ||
    '\U00011c0a-\U00011c36\U00011c38-\U00011c40\U00011c72-\U00011c8f\U00011c92-\U00011ca7' ||
    '\U00011ca9-\U00011cb6\U00011d00-\U00011d06\U00011d08-\U00011d09\U00011d0b-\U00011d36\U00011d3a' ||
    '\U00011d3c-\U00011d3d\U00011d3f-\U00011d47\U00011d60-\U00011d65\U00011d67-\U00011d68' ||
    '\U00011d6a-\U00011d8e\U00011d90-\U00011d91\U00011d93-\U00011d98\U00011db0-\U00011ddb' ||
    '\U00011ee0-\U00011ef6\U00011f00-\U00011f10\U00011f12-\U00011f3a\U00011f3e-\U00011f42\U00011f5a' ||
    '\U00011fb0\U00012000-\U00012399\U00012480-\U00012543\U00012f90-\U00012ff0\U00013000-\U0001342f' ||
    '\U00013440-\U00013455\U00013460-\U000143fa\U00014400-\U00014646\U00016100-\U0001612f' ||
    '\U00016800-\U00016a38\U00016a40-\U00016a5e\U00016a70-\U00016abe\U00016ad0-\U00016aed' ||
    '\U00016af0-\U00016af4\U00016b00-\U00016b36\U00016b40-\U00016b43\U00016b63-\U00016b77' ||
    '\U00016b7d-\U00016b8f\U00016d40-\U00016d6c\U00016e40-\U00016e7f\U00016ea0-\U00016eb8' ||
    '\U00016ebb-\U00016ed3\U00016f00-\U00016f4a\U00016f4f-\U00016f87\U00016f8f-\U00016f9f' ||
    '\U00016fe0-\U00016fe1\U00016fe3-\U00016fe4\U00016ff0-\U00016ff3\U00017000-\U00018cd5' ||
    '\U00018cff-\U00018d1e\U00018d80-\U00018df2\U0001aff0-\U0001aff3\U0001aff5-\U0001affb' ||
    '\U0001affd-\U0001affe\U0001b000-\U0001b122\U0001b132\U0001b150-\U0001b152\U0001b155' ||
    '\U0001b164-\U0001b167\U0001b170-\U0001b2fb\U0001bc00-\U0001bc6a\U0001bc70-\U0001bc7c' ||
    '\U0001bc80-\U0001bc88\U0001bc90-\U0001bc99\U0001bc9d-\U0001bc9e\U0001cf00-\U0001cf2d' ||
    '\U0001cf30-\U0001cf46\U0001d165-\U0001d169\U0001d16d-\U0001d172\U0001d17b-\U0001d182' ||
    '\U0001d185-\U0001d18b\U0001d1aa-\U0001d1ad\U0001d242-\U0001d244\U0001d400-\U0001d454' ||
    '\U0001d456-\U0001d49c\U0001d49e-\U0001d49f\U0001d4a2\U0001d4a5-\U0001d4a6\U0001d4a9-\U0001d4ac' ||
    '\U0001d4ae-\U0001d4b9\U0001d4bb\U0001d4bd-\U0001d4c3\U0001d4c5-\U0001d505\U0001d507-\U0001d50a' ||
    '\U0001d50d-\U0001d514\U0001d516-\U0001d51c\U0001d51e-\U0001d539\U0001d53b-\U0001d53e' ||
    '\U0001d540-\U0001d544\U0001d546\U0001d54a-\U0001d550\U0001d552-\U0001d6a5\U0001d6a8-\U0001d6c0' ||
    '\U0001d6c2-\U0001d6da\U0001d6dc-\U0001d6fa\U0001d6fc-\U0001d714\U0001d716-\U0001d734' ||
    '\U0001d736-\U0001d74e\U0001d750-\U0001d76e\U0001d770-\U0001d788\U0001d78a-\U0001d7a8' ||
    '\U0001d7aa-\U0001d7c2\U0001d7c4-\U0001d7cb\U0001da00-\U0001da36\U0001da3b-\U0001da6c\U0001da75' ||
    '\U0001da84\U0001da9b-\U0001da9f\U0001daa1-\U0001daaf\U0001df00-\U0001df1e\U0001df25-\U0001df2a' ||
    '\U0001e000-\U0001e006\U0001e008-\U0001e018\U0001e01b-\U0001e021\U0001e023-\U0001e024' ||
    '\U0001e026-\U0001e02a\U0001e030-\U0001e06d\U0001e08f\U0001e100-\U0001e12c\U0001e130-\U0001e13d' ||
    '\U0001e14e\U0001e290-\U0001e2ae\U0001e2c0-\U0001e2ef\U0001e4d0-\U0001e4ef\U0001e5d0-\U0001e5f0' ||
    '\U0001e6c0-\U0001e6de\U0001e6e0-\U0001e6f5\U0001e6fe-\U0001e6ff\U0001e7e0-\U0001e7e6' ||
    '\U0001e7e8-\U0001e7eb\U0001e7ed-\U0001e7ee\U0001e7f0-\U0001e7fe\U0001e800-\U0001e8c4' ||
    '\U0001e8d0-\U0001e8d6\U0001e900-\U0001e94b\U0001ee00-\U0001ee03\U0001ee05-\U0001ee1f' ||
    '\U0001ee21-\U0001ee22\U0001ee24\U0001ee27\U0001ee29-\U0001ee32\U0001ee34-\U0001ee37\U0001ee39' ||
    '\U0001ee3b\U0001ee42\U0001ee47\U0001ee49\U0001ee4b\U0001ee4d-\U0001ee4f\U0001ee51-\U0001ee52' ||
    '\U0001ee54\U0001ee57\U0001ee59\U0001ee5b\U0001ee5d\U0001ee5f\U0001ee61-\U0001ee62\U0001ee64' ||
    '\U0001ee67-\U0001ee6a\U0001ee6c-\U0001ee72\U0001ee74-\U0001ee77\U0001ee79-\U0001ee7c\U0001ee7e' ||
    '\U0001ee80-\U0001ee89\U0001ee8b-\U0001ee9b\U0001eea1-\U0001eea3\U0001eea5-\U0001eea9' ||
    '\U0001eeab-\U0001eebb\U00020000-\U0002a6df\U0002a700-\U0002b81d\U0002b820-\U0002cead' ||
    '\U0002ceb0-\U0002ebe0\U0002ebf0-\U0002ee5d\U0002f800-\U0002fa1d\U00030000-\U0003134a' ||
    '\U00031350-\U00033479\U000e0100-\U000e01ef';
begin
  return p_name = btrim(p_name) and length(p_name) between 1 and 80
    and p_name ~ ('^[' || v_letters || '][' || v_letters || ' ''’.-]*$');
end;
$$;

revoke all on function private.is_person_name(text) from public, anon, authenticated, service_role;
grant execute on function private.is_person_name(text) to authenticated;

create table public.worker_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  first_name text not null check (private.is_person_name(first_name)),
  last_name text not null check (private.is_person_name(last_name)),
  headline text check (
    headline = btrim(headline) and length(headline) between 1 and 120 and headline !~ '[[:cntrl:]]'
  ),
  current_country text not null references public.countries (code),
  occupation_id text references public.occupations (code),
  years_experience smallint check (years_experience between 0 and 60),
  availability public.worker_availability,
  available_from date,
  searchable boolean not null default false check (not searchable),
  created_at timestamptz not null default now(),
  check (coalesce(availability = 'from_date', false) = (available_from is not null))
);

comment on table public.worker_profiles is
  'The candidate passport. Created only by create_worker_passport; searchable stays false in Phase 1.';
comment on column public.worker_profiles.occupation_id is 'ISCO-08 unit group code; no free-text occupation.';
comment on column public.worker_profiles.available_from is
  'Set exactly when availability is from_date; checked against the availability window when either column changes.';

create table public.worker_skills (
  id uuid primary key default gen_random_uuid(),
  worker_user_id uuid not null references public.worker_profiles (user_id) on delete cascade,
  skill text not null check (skill = btrim(skill) and length(skill) between 1 and 50 and skill !~ '[[:cntrl:]]')
);

create unique index worker_skills_candidate_skill on public.worker_skills (worker_user_id, lower(skill));

create table public.worker_languages (
  worker_user_id uuid not null references public.worker_profiles (user_id) on delete cascade,
  language_code text not null references public.languages (code),
  cefr_level public.cefr_level not null,
  primary key (worker_user_id, language_code)
);

create table public.worker_preferred_countries (
  worker_user_id uuid not null references public.worker_profiles (user_id) on delete cascade,
  country_code text not null references public.countries (code),
  primary key (worker_user_id, country_code)
);

create table public.worker_work_authorizations (
  worker_user_id uuid not null references public.worker_profiles (user_id) on delete cascade,
  country_code text not null references public.countries (code),
  expires_on date,
  primary key (worker_user_id, country_code)
);

comment on column public.worker_work_authorizations.expires_on is 'Null means the right to work does not expire.';

-- Definer rights: the count must see all of the candidate's rows and the lock must not depend on the caller's policies.
-- Locking the profile row serialises concurrent inserts of one candidate, so the limit cannot be passed by a race. A
-- missing or null setting refuses the insert instead of lifting the limit.
create function private.worker_list_limit() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max integer := (select (value #>> '{}')::integer from private.settings where key = tg_argv[0]);
  v_count integer;
begin
  perform 1 from public.worker_profiles p where p.user_id = new.worker_user_id for no key update;
  execute format('select count(*) from %I.%I where worker_user_id = $1', tg_table_schema, tg_table_name)
    into v_count using new.worker_user_id;
  if v_count >= coalesce(v_max, 0) then
    raise exception 'CHARA_LIMIT_REACHED' using detail = tg_table_name;
  end if;
  return new;
end;
$$;

revoke all on function private.worker_list_limit() from public, anon, authenticated, service_role;

create trigger worker_skills_limit before insert on public.worker_skills
  for each row execute function private.worker_list_limit('worker_skills_max');
create trigger worker_languages_limit before insert on public.worker_languages
  for each row execute function private.worker_list_limit('worker_languages_max');
create trigger worker_preferred_countries_limit before insert on public.worker_preferred_countries
  for each row execute function private.worker_list_limit('worker_preferred_countries_max');

alter table public.worker_skills enable always trigger worker_skills_limit;
alter table public.worker_languages enable always trigger worker_languages_limit;
alter table public.worker_preferred_countries enable always trigger worker_preferred_countries_limit;

-- The window is checked when the date or the availability changes, never for an unrelated edit of a profile whose date has
-- since passed. Dates are UTC. Definer rights only to read the settings, which the API roles cannot.
create function private.worker_profiles_check_available_from() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_months integer := (select (value #>> '{}')::integer from private.settings where key = 'availability_window_months');
begin
  if tg_op = 'UPDATE'
     and new.availability is not distinct from old.availability
     and new.available_from is not distinct from old.available_from then
    return new;
  end if;
  if new.available_from is not null
     and new.available_from not between v_today and (v_today + make_interval(months => coalesce(v_months, 0)))::date then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'available_from';
  end if;
  return new;
end;
$$;

revoke all on function private.worker_profiles_check_available_from() from public, anon, authenticated, service_role;

create trigger worker_profiles_check_available_from
  before insert or update of availability, available_from on public.worker_profiles
  for each row execute function private.worker_profiles_check_available_from();

alter table public.worker_profiles enable always trigger worker_profiles_check_available_from;

create function private.worker_authorizations_check_expiry() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_years integer := (select (value #>> '{}')::integer from private.settings where key = 'work_authorization_expiry_max_years');
begin
  if tg_op = 'UPDATE' and new.expires_on is not distinct from old.expires_on then
    return new;
  end if;
  if new.expires_on is not null
     and new.expires_on not between v_today and (v_today + make_interval(years => coalesce(v_years, 0)))::date then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'expires_on';
  end if;
  return new;
end;
$$;

revoke all on function private.worker_authorizations_check_expiry() from public, anon, authenticated, service_role;

create trigger worker_authorizations_check_expiry
  before insert or update of expires_on on public.worker_work_authorizations
  for each row execute function private.worker_authorizations_check_expiry();

alter table public.worker_work_authorizations enable always trigger worker_authorizations_check_expiry;

alter table public.worker_profiles enable row level security;
alter table public.worker_profiles force row level security;
alter table public.worker_skills enable row level security;
alter table public.worker_skills force row level security;
alter table public.worker_languages enable row level security;
alter table public.worker_languages force row level security;
alter table public.worker_preferred_countries enable row level security;
alter table public.worker_preferred_countries force row level security;
alter table public.worker_work_authorizations enable row level security;
alter table public.worker_work_authorizations force row level security;

-- user_id, searchable and created_at have no update grant, and nobody can insert or delete a profile row: it is created by
-- create_worker_passport and removed with the account. A child row can never be moved to another candidate:
-- worker_user_id has no update grant either. The child tables are granted update because the acceptance criteria give the
-- candidate the right to change own rows; the passport screens remove and add an item instead of editing it (OPEN_QUESTIONS D41).
-- Suspended and deletion-pending accounts keep read and change access to their own rows: the account decides sign-in, the
-- passport stays the person's own data (D41).
grant select on public.worker_profiles to authenticated;
grant update (first_name, last_name, headline, current_country, occupation_id, years_experience, availability, available_from)
  on public.worker_profiles to authenticated;
grant select, insert, delete on public.worker_skills, public.worker_languages,
  public.worker_preferred_countries, public.worker_work_authorizations to authenticated;
grant update (skill) on public.worker_skills to authenticated;
grant update (language_code, cefr_level) on public.worker_languages to authenticated;
grant update (country_code) on public.worker_preferred_countries to authenticated;
grant update (country_code, expires_on) on public.worker_work_authorizations to authenticated;

create policy worker_profiles_select_own on public.worker_profiles
  for select to authenticated using (user_id = (select auth.uid()));
create policy worker_profiles_update_own on public.worker_profiles
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy worker_skills_select_own on public.worker_skills
  for select to authenticated using (worker_user_id = (select auth.uid()));
create policy worker_skills_insert_own on public.worker_skills
  for insert to authenticated with check (worker_user_id = (select auth.uid()));
create policy worker_skills_update_own on public.worker_skills
  for update to authenticated
  using (worker_user_id = (select auth.uid())) with check (worker_user_id = (select auth.uid()));
create policy worker_skills_delete_own on public.worker_skills
  for delete to authenticated using (worker_user_id = (select auth.uid()));

create policy worker_languages_select_own on public.worker_languages
  for select to authenticated using (worker_user_id = (select auth.uid()));
create policy worker_languages_insert_own on public.worker_languages
  for insert to authenticated with check (worker_user_id = (select auth.uid()));
create policy worker_languages_update_own on public.worker_languages
  for update to authenticated
  using (worker_user_id = (select auth.uid())) with check (worker_user_id = (select auth.uid()));
create policy worker_languages_delete_own on public.worker_languages
  for delete to authenticated using (worker_user_id = (select auth.uid()));

create policy worker_preferred_countries_select_own on public.worker_preferred_countries
  for select to authenticated using (worker_user_id = (select auth.uid()));
create policy worker_preferred_countries_insert_own on public.worker_preferred_countries
  for insert to authenticated with check (worker_user_id = (select auth.uid()));
create policy worker_preferred_countries_update_own on public.worker_preferred_countries
  for update to authenticated
  using (worker_user_id = (select auth.uid())) with check (worker_user_id = (select auth.uid()));
create policy worker_preferred_countries_delete_own on public.worker_preferred_countries
  for delete to authenticated using (worker_user_id = (select auth.uid()));

create policy worker_work_authorizations_select_own on public.worker_work_authorizations
  for select to authenticated using (worker_user_id = (select auth.uid()));
create policy worker_work_authorizations_insert_own on public.worker_work_authorizations
  for insert to authenticated with check (worker_user_id = (select auth.uid()));
create policy worker_work_authorizations_update_own on public.worker_work_authorizations
  for update to authenticated
  using (worker_user_id = (select auth.uid())) with check (worker_user_id = (select auth.uid()));
create policy worker_work_authorizations_delete_own on public.worker_work_authorizations
  for delete to authenticated using (worker_user_id = (select auth.uid()));

-- Creates the caller's passport once: the caller must hold an active worker account. A second call fails on the primary
-- key (unique_violation). English is the only interface language in Phase 1. The audit row carries no name.
create function public.create_worker_passport(
  p_first_name text,
  p_last_name text,
  p_current_country text,
  p_preferred_lang text default 'en'
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_profile public.profiles;
begin
  if v_uid is null then
    raise exception 'CHARA_FORBIDDEN';
  end if;

  select * into v_profile from public.profiles p where p.id = v_uid for no key update;
  if not found or v_profile.account_kind is distinct from 'worker' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'worker_account_required';
  end if;
  if v_profile.status <> 'active' then
    raise exception 'CHARA_FORBIDDEN' using detail = 'profile_not_active';
  end if;
  if p_preferred_lang is distinct from 'en' then
    raise exception 'CHARA_INVALID_INPUT' using detail = 'preferred_lang';
  end if;

  insert into public.worker_profiles (user_id, first_name, last_name, current_country)
  values (v_uid, btrim(p_first_name), btrim(p_last_name), p_current_country);
  update public.profiles set preferred_lang = p_preferred_lang where id = v_uid;

  perform audit.record('passport.created', 'worker_profiles', v_uid::text);
end;
$$;

revoke all on function public.create_worker_passport(text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.create_worker_passport(text, text, text, text) to authenticated;

-- The owner-changeable values the forms quote and check (the skills limit and the two date windows), so the web tier holds
-- no copy of them. The settings are not readable by the API roles, so this returns only these three keys; the triggers
-- above stay the authority.
create function public.passport_limits() returns table (
  skills_max integer,
  availability_window_months integer,
  work_authorization_expiry_max_years integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select (value #>> '{}')::integer from private.settings where key = 'worker_skills_max'),
    (select (value #>> '{}')::integer from private.settings where key = 'availability_window_months'),
    (select (value #>> '{}')::integer from private.settings where key = 'work_authorization_expiry_max_years')
  where (select auth.uid()) is not null;
$$;

revoke all on function public.passport_limits() from public, anon, authenticated, service_role;
grant execute on function public.passport_limits() to authenticated;
