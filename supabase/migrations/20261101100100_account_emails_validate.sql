-- Validates the two checks that 20261101100000 added not valid. Validation takes a lock that lets the notifications be
-- written meanwhile.
alter table public.notifications validate constraint notifications_kind_check;
alter table public.notifications validate constraint notifications_check;
