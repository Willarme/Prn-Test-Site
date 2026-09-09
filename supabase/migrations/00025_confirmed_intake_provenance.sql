-- Homeowner confirmation is an existing application provenance value.
-- The original 00005 constraint predated it and rejected hosted confirmations.
-- Keep the three historical values; do not change rows, RLS, or grants.
alter table public.intake_answer drop constraint intake_answer_source_check;
alter table public.intake_answer add constraint intake_answer_source_check
  check (source in ('auto_detected', 'typed', 'photo', 'confirmed'));

notify pgrst, 'reload schema';
