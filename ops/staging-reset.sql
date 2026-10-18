-- Staging data reset (ops/staging-reset.sql)
-- Wipes all pilot data; staff users are re-provisioned automatically on next login.
-- Run: npx wrangler d1 execute cockpit-staging -e staging --remote --file ops/staging-reset.sql -y
DELETE FROM time_entries;
DELETE FROM audit_events;
DELETE FROM bookings;
DELETE FROM responses;
DELETE FROM outreach_entries;
DELETE FROM requests;
DELETE FROM services;
DELETE FROM companies;
DELETE FROM users;
