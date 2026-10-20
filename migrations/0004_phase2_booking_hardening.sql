CREATE TABLE `booking_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`requestId` text NOT NULL,
	`responseId` text,
	`holdId` text,
	`companyId` text NOT NULL,
	`trade` text NOT NULL,
	`startDate` text NOT NULL,
	`endDate` text NOT NULL,
	`workersCount` integer NOT NULL,
	`state` text DEFAULT 'requested' NOT NULL,
	`requestedBy` text NOT NULL,
	`confirmedBy` text,
	`createdAt` text,
	`updatedAt` text,
	FOREIGN KEY (`requestId`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`responseId`) REFERENCES `responses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requestedBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`confirmedBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `booking_requests_request_idx` ON `booking_requests` (`requestId`);--> statement-breakpoint
CREATE TABLE `holds` (
	`id` text PRIMARY KEY NOT NULL,
	`requestId` text NOT NULL,
	`companyId` text NOT NULL,
	`trade` text NOT NULL,
	`startDate` text NOT NULL,
	`endDate` text NOT NULL,
	`workersCount` integer NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`releasedReason` text,
	`expiresAt` text NOT NULL,
	`createdBy` text NOT NULL,
	`createdAt` text,
	`updatedAt` text,
	FOREIGN KEY (`requestId`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `holds_company_trade_idx` ON `holds` (`companyId`,`trade`);--> statement-breakpoint
CREATE INDEX `holds_request_idx` ON `holds` (`requestId`);--> statement-breakpoint
-- First-confirmed-wins (project invariant): the same provider capacity
-- (company + trade + overlapping active booking dates) must not be committed
-- twice. SQLite has no exclusion constraints, so a BEFORE INSERT trigger is
-- the database-level guarantee; the application layer duplicates the check
-- for a friendly 409 and this trigger is the last line of defence.
CREATE TRIGGER bookings_no_capacity_overlap
BEFORE INSERT ON `bookings`
WHEN EXISTS (
  SELECT 1
  FROM `bookings` b
  WHERE b.`companyId` = NEW.`companyId`
    AND b.`trade` = NEW.`trade`
    AND b.`outcome` IS NULL
    AND b.`startDate` <= NEW.`endDate`
    AND b.`endDate` >= NEW.`startDate`
)
BEGIN
  SELECT RAISE(ABORT, 'capacity_conflict');
END;
