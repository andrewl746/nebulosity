-- Code search: one row per chunk, rowid = chunks.id. A regular FTS5 table (it keeps its own copy
-- of the text) so snippet() can quote the matching lines. porter: "rendered" finds "render".
CREATE VIRTUAL TABLE `code_fts` USING fts5(path, name, name_split, text, tokenize = 'porter unicode61');
--> statement-breakpoint
-- bm25 column weights (path, name, name_split, text): a word in a declaration's name says far more
-- about the chunk than the same word somewhere in its body. Stored as the table's rank.
INSERT INTO `code_fts`(`code_fts`, `rank`) VALUES ('rank', 'bm25(2.0, 10.0, 6.0, 1.0)');
--> statement-breakpoint
CREATE TRIGGER `chunks_fts_insert` AFTER INSERT ON `chunks` BEGIN
  INSERT INTO `code_fts`(rowid, path, name, name_split, text)
  VALUES (new.id, (SELECT path FROM files WHERE id = new.file_id), new.name, new.name_split, new.text);
END;
--> statement-breakpoint
-- Fires however a chunk disappears: a re-parse, a deleted file, a deleted repository
-- (ON DELETE CASCADE runs triggers too), or the old Phase 2 pipeline.
CREATE TRIGGER `chunks_fts_delete` AFTER DELETE ON `chunks` BEGIN
  DELETE FROM `code_fts` WHERE rowid = old.id;
END;
--> statement-breakpoint
-- Summary search: one row per summary that has text, rowid = summaries.id.
CREATE VIRTUAL TABLE `summary_fts` USING fts5(path, tagline, summary, tokenize = 'porter unicode61');
--> statement-breakpoint
-- bm25 column weights (path, tagline, summary)
INSERT INTO `summary_fts`(`summary_fts`, `rank`) VALUES ('rank', 'bm25(1.0, 4.0, 2.0)');
--> statement-breakpoint
CREATE TRIGGER `summaries_fts_insert` AFTER INSERT ON `summaries` WHEN new.tagline IS NOT NULL BEGIN
  INSERT INTO `summary_fts`(rowid, path, tagline, summary) VALUES (new.id, new.target_path, new.tagline, new.summary);
END;
--> statement-breakpoint
-- Only when the text changes: status-only updates (a batch id, a new status) leave the index alone.
CREATE TRIGGER `summaries_fts_update` AFTER UPDATE OF tagline, summary ON `summaries` BEGIN
  DELETE FROM `summary_fts` WHERE rowid = old.id;
  INSERT INTO `summary_fts`(rowid, path, tagline, summary)
  SELECT new.id, new.target_path, new.tagline, new.summary WHERE new.tagline IS NOT NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `summaries_fts_delete` AFTER DELETE ON `summaries` BEGIN
  DELETE FROM `summary_fts` WHERE rowid = old.id;
END;
--> statement-breakpoint
-- Chunks written before this migration have no code_fts rows. Clearing every content hash makes
-- the next `npm run index` re-parse each file once, so the insert trigger fills the index
-- (and files.language is re-derived for .js files).
UPDATE `files` SET `content_hash` = '';