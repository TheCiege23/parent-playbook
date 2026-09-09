-- Minimal, parent-approved snapshot of the child shared for a booking
-- (first name, age band, sport). The trainer reads this off the booking they
-- already have access to — never the live athlete record.
alter table bookings add column if not exists child_shared jsonb;;
