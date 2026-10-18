CREATE TABLE `email_suppressions` (
	`email` text PRIMARY KEY NOT NULL,
	`reason` text NOT NULL,
	`createdAt` text
);
--> statement-breakpoint
CREATE TABLE `email_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`jti` text NOT NULL,
	`outreachEntryId` text NOT NULL,
	`purpose` text NOT NULL,
	`expiresAt` text NOT NULL,
	`usedAt` text,
	`createdAt` text,
	FOREIGN KEY (`outreachEntryId`) REFERENCES `outreach_entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_tokens_jti_unique` ON `email_tokens` (`jti`);--> statement-breakpoint
CREATE INDEX `email_tokens_entry_idx` ON `email_tokens` (`outreachEntryId`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_responses` (
	`id` text PRIMARY KEY NOT NULL,
	`requestId` text NOT NULL,
	`companyId` text NOT NULL,
	`type` text NOT NULL,
	`workersCount` integer,
	`availableFrom` text,
	`reason` text,
	`receivedAt` text,
	`createdBy` text,
	FOREIGN KEY (`requestId`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_responses`("id", "requestId", "companyId", "type", "workersCount", "availableFrom", "reason", "receivedAt", "createdBy") SELECT "id", "requestId", "companyId", "type", "workersCount", "availableFrom", "reason", "receivedAt", "createdBy" FROM `responses`;--> statement-breakpoint
DROP TABLE `responses`;--> statement-breakpoint
ALTER TABLE `__new_responses` RENAME TO `responses`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `responses_request_idx` ON `responses` (`requestId`);--> statement-breakpoint
ALTER TABLE `outreach_entries` ADD `emailStatus` text;--> statement-breakpoint
ALTER TABLE `outreach_entries` ADD `emailSkippedReason` text;--> statement-breakpoint
CREATE INDEX `outreach_email_status_idx` ON `outreach_entries` (`emailStatus`);