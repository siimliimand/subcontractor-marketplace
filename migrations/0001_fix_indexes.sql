PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actorUserId` text,
	`actorEmail` text,
	`occurredAt` text,
	`entity` text NOT NULL,
	`entityId` text,
	`action` text NOT NULL,
	`payloadJson` text,
	`channel` text DEFAULT 'manual' NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_audit_events`("id", "actorUserId", "actorEmail", "occurredAt", "entity", "entityId", "action", "payloadJson", "channel") SELECT "id", "actorUserId", "actorEmail", "occurredAt", "entity", "entityId", "action", "payloadJson", "channel" FROM `audit_events`;--> statement-breakpoint
DROP TABLE `audit_events`;--> statement-breakpoint
ALTER TABLE `__new_audit_events` RENAME TO `audit_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `audit_events_entity_idx` ON `audit_events` (`entity`,`entityId`);--> statement-breakpoint
CREATE INDEX `audit_events_action_idx` ON `audit_events` (`action`);--> statement-breakpoint
CREATE INDEX `audit_events_occurred_idx` ON `audit_events` (`occurredAt`);