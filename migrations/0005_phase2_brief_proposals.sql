CREATE TABLE `brief_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`requestId` text,
	`sourceText` text NOT NULL,
	`proposedJson` text NOT NULL,
	`missingFields` text,
	`finalJson` text,
	`model` text NOT NULL,
	`state` text DEFAULT 'drafted' NOT NULL,
	`createdBy` text NOT NULL,
	`createdAt` text,
	`updatedAt` text,
	FOREIGN KEY (`requestId`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `brief_proposals_request_idx` ON `brief_proposals` (`requestId`);