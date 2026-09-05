-- 051 — the single-property form's inputs, on a bulk run (2026-09-04).
--
-- Bulk valuation is the comp-report tool now (the single form's Tools row is
-- gone), so the inputs that form asks for have to ride a bulk job: the
-- sales / leases / both focus, and the per-property facts — property SF,
-- asking price, NOI, cap rate, the per-type details (units, clear height...).
--
-- Two columns, on two tables, because the two inputs have two scopes:
--
--   bulk_jobs.tx_focus is the JOB's, like property_type and months: one list
--   is one kind of search. 'both' is what every job before this ran, so the
--   default keeps every existing row honest.
--
--   bulk_job_items.subject is the ROW's: a one-address run carries the form's
--   own fields for that property; a list carries whatever the upload's
--   columns said for each row (asking_price, noi, cap_rate, and the type's
--   detail columns). jsonb rather than columns, for the reason org_comps
--   stores jsonb where broker_comps stores columns (030): the per-type field
--   set changes with TYPE_COMP_FIELDS and a new field must not need a
--   migration here. Its shape is index.html's meta.subject minus the size,
--   which already has its own column (size_sqft) and its own precedence.
--
-- Nothing in `subject` reaches the model or the cache: the worker hands
-- runCompSearch only the sanitized per-type DETAILS (as /api/comps does), and
-- the asking price, NOI and cap rate travel into the stored recent search's
-- meta.subject for the report's own client-side income approach — the same
-- place a hand-run report keeps them (portfolio_items).
--
-- Additive; run BEFORE deploying the code that names these columns. The
-- insert names `tx_focus` and `subject` only when they carry a non-default
-- value, so a default run still starts against the old schema — but a run
-- with a focus or details 400s at PostgREST and the member reads "Could not
-- start that run" until this has run.

alter table bulk_jobs
  add column if not exists tx_focus text not null default 'both';

alter table bulk_job_items
  add column if not exists subject jsonb;

comment on column bulk_jobs.tx_focus is 'both | sales | leases — the whole job''s transaction focus, as the single form''s Focus select.';
comment on column bulk_job_items.subject is 'The row''s own property facts: {asking, noi, capRate, details:{…}}. Never reaches the model; travels into the recent search''s meta.subject.';
