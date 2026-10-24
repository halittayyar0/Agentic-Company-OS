-- Harmless CVE-2026-6464 regression; only a session-local temporary table.
CREATE TEMP TABLE runtime_security_sentinel(value text);
COPY pg_temp.runtime_security_missing(value) FROM STDIN;
INSERT INTO runtime_security_sentinel VALUES ('inline-data-executed');
\.
SELECT 'runtime-security-sentinel=' || count(*) FROM runtime_security_sentinel;
