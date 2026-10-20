CREATE TABLE `availability_declarations` (
	`id` text PRIMARY KEY NOT NULL,
	`companyId` text NOT NULL,
	`trade` text NOT NULL,
	`workersCount` integer NOT NULL,
	`dateFrom` text NOT NULL,
	`dateTo` text NOT NULL,
	`channel` text DEFAULT 'booking_system' NOT NULL,
	`lastConfirmedAt` text NOT NULL,
	`notes` text,
	`createdBy` text,
	`createdAt` text,
	FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `availability_company_trade_idx` ON `availability_declarations` (`companyId`,`trade`);--> statement-breakpoint
CREATE INDEX `availability_confirmed_idx` ON `availability_declarations` (`lastConfirmedAt`);--> statement-breakpoint
CREATE TABLE `request_trades` (
	`id` text PRIMARY KEY NOT NULL,
	`requestId` text NOT NULL,
	`trade` text NOT NULL,
	`isPrimary` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`requestId`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `request_trades_request_trade_unique` ON `request_trades` (`requestId`,`trade`);--> statement-breakpoint
CREATE INDEX `request_trades_trade_idx` ON `request_trades` (`trade`);--> statement-breakpoint
ALTER TABLE `bookings` ADD `trade` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `bookings_company_trade_idx` ON `bookings` (`companyId`,`trade`);--> statement-breakpoint
ALTER TABLE `outreach_entries` ADD `trade` text;--> statement-breakpoint
ALTER TABLE `outreach_entries` ADD `matchScore` real;--> statement-breakpoint
ALTER TABLE `outreach_entries` ADD `matchFactorsJson` text;--> statement-breakpoint
-- Backfill: every existing request's primary trade becomes its request_trades row (Decision 3).
INSERT INTO `request_trades` (`id`, `requestId`, `trade`, `isPrimary`)
SELECT
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
  `id`,
  `trade`,
  1
FROM `requests`;