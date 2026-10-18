CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actorUserId` text,
	`actorEmail` text,
	`occurredAt` text,
	`entity` text NOT NULL,
	`entityId` text,
	`action` text NOT NULL,
	`payloadJson` text,
	`channel` text DEFAULT 'manual' NOT NULL,
	FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_events_entity_idx` ON `audit_events` (`entity`,`entityId`);--> statement-breakpoint
CREATE INDEX `audit_events_action_idx` ON `audit_events` (`action`);--> statement-breakpoint
CREATE INDEX `audit_events_occurred_idx` ON `audit_events` (`occurredAt`);--> statement-breakpoint
CREATE TABLE `bookings` (
	`id` text PRIMARY KEY NOT NULL,
	`requestId` text NOT NULL,
	`responseId` text NOT NULL,
	`companyId` text NOT NULL,
	`startDate` text NOT NULL,
	`endDate` text NOT NULL,
	`workersCount` integer NOT NULL,
	`outcome` text,
	`outcomeReason` text,
	`outcomeAt` text,
	`createdBy` text NOT NULL,
	`createdAt` text,
	FOREIGN KEY (`requestId`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`responseId`) REFERENCES `responses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bookings_requestId_unique` ON `bookings` (`requestId`);--> statement-breakpoint
CREATE INDEX `bookings_company_idx` ON `bookings` (`companyId`);--> statement-breakpoint
CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`legalName` text NOT NULL,
	`registrationIdentifier` text NOT NULL,
	`contactEmail` text NOT NULL,
	`contactPhone` text,
	`status` text DEFAULT 'active' NOT NULL,
	`statusReason` text,
	`statusChangedAt` text,
	`createdAt` text,
	`updatedAt` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companies_registration_identifier_unique` ON `companies` (`registrationIdentifier`);--> statement-breakpoint
CREATE INDEX `companies_status_idx` ON `companies` (`status`);--> statement-breakpoint
CREATE TABLE `outreach_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`requestId` text NOT NULL,
	`companyId` text NOT NULL,
	`batchNumber` text NOT NULL,
	`contactedBy` text NOT NULL,
	`channel` text DEFAULT 'manual' NOT NULL,
	`sentAt` text,
	`notes` text,
	FOREIGN KEY (`requestId`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contactedBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outreach_request_company_unique` ON `outreach_entries` (`requestId`,`companyId`);--> statement-breakpoint
CREATE INDEX `outreach_batch_idx` ON `outreach_entries` (`batchNumber`);--> statement-breakpoint
CREATE TABLE `requests` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`location` text NOT NULL,
	`trade` text NOT NULL,
	`startDate` text NOT NULL,
	`crewSize` integer NOT NULL,
	`budget` text,
	`duration` text,
	`notes` text,
	`pmName` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`cancelledBy` text,
	`cancelReason` text,
	`createdBy` text NOT NULL,
	`createdAt` text,
	`updatedAt` text,
	FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `requests_status_idx` ON `requests` (`status`);--> statement-breakpoint
CREATE INDEX `requests_trade_idx` ON `requests` (`trade`);--> statement-breakpoint
CREATE TABLE `responses` (
	`id` text PRIMARY KEY NOT NULL,
	`requestId` text NOT NULL,
	`companyId` text NOT NULL,
	`type` text NOT NULL,
	`workersCount` integer,
	`availableFrom` text,
	`reason` text,
	`receivedAt` text,
	`createdBy` text NOT NULL,
	FOREIGN KEY (`requestId`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `responses_request_idx` ON `responses` (`requestId`);--> statement-breakpoint
CREATE TABLE `services` (
	`id` text PRIMARY KEY NOT NULL,
	`companyId` text NOT NULL,
	`trade` text NOT NULL,
	`skills` text,
	`serviceArea` text NOT NULL,
	`pricingApproach` text,
	`pricingModel` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`statusReason` text,
	`statusChangedAt` text,
	`createdAt` text,
	`updatedAt` text,
	FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `services_company_idx` ON `services` (`companyId`);--> statement-breakpoint
CREATE INDEX `services_trade_idx` ON `services` (`trade`);--> statement-breakpoint
CREATE TABLE `time_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`requestId` text NOT NULL,
	`userId` text NOT NULL,
	`minutes` integer NOT NULL,
	`note` text,
	`createdAt` text,
	FOREIGN KEY (`requestId`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `time_entries_request_idx` ON `time_entries` (`requestId`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'staff' NOT NULL,
	`createdAt` text,
	`lastLoginAt` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);