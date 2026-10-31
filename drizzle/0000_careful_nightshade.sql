CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "revision_positive" CHECK("documents"."revision">0)
);
--> statement-breakpoint
CREATE INDEX `document_workspace_cursor` ON `documents` (`workspace_id`,`id`);--> statement-breakpoint
CREATE TABLE `quotas` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_token` ON `workspaces` (`token_hash`);--> statement-breakpoint
CREATE INDEX `workspace_expiry` ON `workspaces` (`expires_at`);--> statement-breakpoint
CREATE VIRTUAL TABLE documents_fts USING fts5(title, body, document_id UNINDEXED, workspace_id UNINDEXED, tokenize='unicode61 remove_diacritics 2');
--> statement-breakpoint
CREATE TRIGGER documents_fts_insert AFTER INSERT ON documents BEGIN INSERT INTO documents_fts(rowid,title,body,document_id,workspace_id) VALUES(new.rowid,new.title,new.body,new.id,new.workspace_id); END;
--> statement-breakpoint
CREATE TRIGGER documents_fts_update AFTER UPDATE ON documents BEGIN DELETE FROM documents_fts WHERE rowid=old.rowid; INSERT INTO documents_fts(rowid,title,body,document_id,workspace_id) VALUES(new.rowid,new.title,new.body,new.id,new.workspace_id); END;
--> statement-breakpoint
CREATE TRIGGER documents_fts_delete AFTER DELETE ON documents BEGIN DELETE FROM documents_fts WHERE rowid=old.rowid; END;
