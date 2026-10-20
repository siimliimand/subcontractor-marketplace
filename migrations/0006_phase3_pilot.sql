-- Phase 3 (repeatable pilot): verification badges, reschedule flow,
-- runtime ranking weights, booking cancellation attribution, and the
-- dashboard aggregate indexes.

CREATE TABLE `company_verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`companyId` text NOT NULL,
	`type` text NOT NULL,
	`trade` text,
	`status` text NOT NULL,
	`checkedAt` text NOT NULL,
	`sourceDataset` text NOT NULL,
	`sourceLicence` text NOT NULL,
	`detailJson` text,
	`createdAt` text,
	FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- COALESCE in the key: `trade` is NULL for company-wide checks, and SQLite
-- UNIQUE treats NULLs as distinct — a plain (companyId, type, trade) index
-- would let re-imports duplicate registry badges forever.
CREATE UNIQUE INDEX `company_verifications_unique` ON `company_verifications` (`companyId`,`type`,COALESCE(`trade`,''));--> statement-breakpoint
CREATE TABLE `booking_reschedules` (
	`id` text PRIMARY KEY NOT NULL,
	`bookingId` text NOT NULL,
	`startDate` text NOT NULL,
	`endDate` text NOT NULL,
	`workersCount` integer NOT NULL,
	`state` text DEFAULT 'proposed' NOT NULL,
	`reason` text,
	`proposedBy` text NOT NULL,
	`resolvedBy` text,
	`createdAt` text,
	`updatedAt` text,
	FOREIGN KEY (`bookingId`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`proposedBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolvedBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `booking_reschedules_booking_idx` ON `booking_reschedules` (`bookingId`);--> statement-breakpoint
-- Append-only: the effective weight per factor is the latest row. Every
-- change carries a reason so pilot tuning stays auditable.
CREATE TABLE `match_weights` (
	`id` text PRIMARY KEY NOT NULL,
	`factor` text NOT NULL,
	`weight` real NOT NULL,
	`reason` text NOT NULL,
	`setBy` text NOT NULL,
	`createdAt` text,
	FOREIGN KEY (`setBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `match_weights_factor_idx` ON `match_weights` (`factor`,`createdAt`);--> statement-breakpoint
ALTER TABLE `bookings` ADD `cancelledBy` text;--> statement-breakpoint
ALTER TABLE `bookings` ADD `cancelReason` text;--> statement-breakpoint
ALTER TABLE `bookings` ADD `cancelledAt` text;--> statement-breakpoint
-- Reschedule must honour the same first-confirmed-wins invariant as insert:
-- moving a booking's window cannot silently double-commit provider capacity.
-- The insert trigger does not fire on UPDATE, so this symmetric trigger is
-- the database-level guarantee for reschedules; it ignores the booking's own
-- row and compares only against live (outcome IS NULL) bookings.
CREATE TRIGGER bookings_no_capacity_overlap_update
BEFORE UPDATE ON `bookings`
WHEN EXISTS (
  SELECT 1
  FROM `bookings` b
  WHERE b.`id` <> NEW.`id`
    AND b.`companyId` = NEW.`companyId`
    AND b.`trade` = NEW.`trade`
    AND b.`outcome` IS NULL
    AND b.`startDate` <= NEW.`endDate`
    AND b.`endDate` >= NEW.`startDate`
)
BEGIN
  SELECT RAISE(ABORT, 'capacity_conflict');
END;--> statement-breakpoint
-- Dashboard aggregates filter audit events by action within a time range;
-- the existing single-column indexes force one range + filter, the composite
-- serves `WHERE action = ? AND occurredAt BETWEEN ? AND ?` directly.
CREATE INDEX `audit_events_action_time_idx` ON `audit_events` (`action`,`occurredAt`);--> statement-breakpoint
CREATE INDEX `outreach_entries_request_idx` ON `outreach_entries` (`requestId`);
