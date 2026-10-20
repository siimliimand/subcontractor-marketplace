-- Phase 4 (focused expansion): trade/region catalogs, calendar feeds,
-- reviews, pilot agreements, provider accounts, planner plans, and the
-- partner entity for monetization gating.

-- Trade catalog: adding a trade becomes a data change, not a deploy. Seeded
-- with the six pilot trades and their per-trade pilot minimums (details/07);
-- application code falls back to the built-in list when the table is empty.
CREATE TABLE `trades` (
	`slug` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`pilotMinimum` integer NOT NULL DEFAULT 4,
	`active` integer NOT NULL DEFAULT 1,
	`createdAt` text
);--> statement-breakpoint
INSERT OR IGNORE INTO `trades` (`slug`, `label`, `pilotMinimum`, `active`) VALUES
	('electrical', 'Electrical', 6, 1),
	('plumbing', 'Plumbing', 5, 1),
	('hvac', 'HVAC', 4, 1),
	('drywall', 'Drywall', 5, 1),
	('flooring', 'Flooring', 4, 1),
	('painting', 'Painting', 6, 1);--> statement-breakpoint
CREATE TABLE `regions` (
	`slug` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`active` integer NOT NULL DEFAULT 1,
	`createdAt` text
);--> statement-breakpoint
CREATE TABLE `service_regions` (
	`id` text PRIMARY KEY NOT NULL,
	`companyId` text NOT NULL,
	`regionSlug` text NOT NULL,
	`createdAt` text,
	FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`regionSlug`) REFERENCES `regions`(`slug`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX `service_regions_company_region_unique` ON `service_regions` (`companyId`,`regionSlug`);--> statement-breakpoint
CREATE INDEX `service_regions_region_idx` ON `service_regions` (`regionSlug`);--> statement-breakpoint
-- Partner entity (phase 4 monetization): PM-side design partners were only
-- free-text pmName; agreements and booking-interface gating key off this.
CREATE TABLE `partners` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`notes` text,
	`createdAt` text
);--> statement-breakpoint
CREATE UNIQUE INDEX `partners_slug_unique` ON `partners` (`slug`);--> statement-breakpoint
CREATE TABLE `calendar_feeds` (
	`id` text PRIMARY KEY NOT NULL,
	`companyId` text NOT NULL,
	`url` text NOT NULL,
	`label` text,
	`state` text NOT NULL DEFAULT 'active',
	`failCount` integer NOT NULL DEFAULT 0,
	`nextAttemptAt` text,
	`lastFetchAt` text,
	`lastSuccessAt` text,
	`lastStatus` text,
	`unparsedCount` integer NOT NULL DEFAULT 0,
	`createdBy` text,
	`createdAt` text,
	`updatedAt` text,
	FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `calendar_feeds_company_idx` ON `calendar_feeds` (`companyId`);--> statement-breakpoint
CREATE TABLE `calendar_busy_intervals` (
	`id` text PRIMARY KEY NOT NULL,
	`feedId` text NOT NULL,
	`companyId` text NOT NULL,
	`startUtc` text NOT NULL,
	`endUtc` text NOT NULL,
	`createdAt` text,
	FOREIGN KEY (`feedId`) REFERENCES `calendar_feeds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `calendar_busy_company_start_idx` ON `calendar_busy_intervals` (`companyId`,`startUtc`);--> statement-breakpoint
CREATE INDEX `calendar_busy_feed_idx` ON `calendar_busy_intervals` (`feedId`);--> statement-breakpoint
-- Reviews tied to completed bookings: one per booking, disputable, author
-- recorded. Disputed reviews stay stored but hidden from display and metrics.
CREATE TABLE `booking_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`bookingId` text NOT NULL,
	`companyId` text NOT NULL,
	`rating` integer NOT NULL,
	`comment` text,
	`disputedAt` text,
	`disputeReason` text,
	`disputedBy` text,
	`createdBy` text NOT NULL,
	`createdAt` text,
	`updatedAt` text,
	FOREIGN KEY (`bookingId`) REFERENCES `bookings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`disputedBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `booking_reviews_booking_unique` ON `booking_reviews` (`bookingId`);--> statement-breakpoint
CREATE INDEX `booking_reviews_company_idx` ON `booking_reviews` (`companyId`);--> statement-breakpoint
CREATE TABLE `pilot_agreements` (
	`id` text PRIMARY KEY NOT NULL,
	`partnerId` text NOT NULL,
	`plan` text NOT NULL DEFAULT 'booking_pilot',
	`monthlyEur` real,
	`startsAt` text NOT NULL,
	`endsAt` text,
	`status` text NOT NULL DEFAULT 'active',
	`notes` text,
	`createdBy` text NOT NULL,
	`createdAt` text,
	`updatedAt` text,
	FOREIGN KEY (`partnerId`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `pilot_agreements_partner_idx` ON `pilot_agreements` (`partnerId`);--> statement-breakpoint
-- Provider company accounts: named people per company with roles. Login is
-- via single-use email tokens (separate table — the outreach email_tokens
-- table is keyed to outreach entries and does not fit invites).
CREATE TABLE `provider_users` (
	`id` text PRIMARY KEY NOT NULL,
	`companyId` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL DEFAULT 'coordinator',
	`status` text NOT NULL DEFAULT 'invited',
	`invitedBy` text,
	`lastLoginAt` text,
	`createdAt` text,
	`updatedAt` text,
	FOREIGN KEY (`companyId`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invitedBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX `provider_users_email_unique` ON `provider_users` (`email`);--> statement-breakpoint
CREATE INDEX `provider_users_company_idx` ON `provider_users` (`companyId`);--> statement-breakpoint
CREATE TABLE `provider_user_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`jti` text NOT NULL,
	`purpose` text NOT NULL,
	`expiresAt` text NOT NULL,
	`usedAt` text,
	`createdAt` text,
	FOREIGN KEY (`userId`) REFERENCES `provider_users`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE UNIQUE INDEX `provider_user_tokens_jti_unique` ON `provider_user_tokens` (`jti`);--> statement-breakpoint
CREATE INDEX `provider_user_tokens_user_idx` ON `provider_user_tokens` (`userId`);--> statement-breakpoint
-- Planner AI drafts: the generated plan, its grounding metadata, and the
-- staff feedback that builds the evaluation dataset.
CREATE TABLE `project_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`requestId` text NOT NULL,
	`planJson` text NOT NULL,
	`model` text NOT NULL,
	`promptHash` text,
	`grounding` text,
	`feedback` text,
	`feedbackComment` text,
	`feedbackAt` text,
	`createdBy` text NOT NULL,
	`createdAt` text,
	FOREIGN KEY (`requestId`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `project_plans_request_idx` ON `project_plans` (`requestId`);--> statement-breakpoint
ALTER TABLE `requests` ADD `region` text;--> statement-breakpoint
ALTER TABLE `requests` ADD `partnerId` text REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE set null;