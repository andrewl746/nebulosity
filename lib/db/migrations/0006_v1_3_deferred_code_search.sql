-- A bulk structure run can defer code search (ADR-031, amended): while this meta row exists the chunk trigger
-- indexes nothing, and one INSERT … SELECT fills code_fts after the structure stage, about three times faster
-- than a trigger per chunk. The delete trigger is unchanged.
DROP TRIGGER `chunks_fts_insert`;
--> statement-breakpoint
CREATE TRIGGER `chunks_fts_insert` AFTER INSERT ON `chunks`
WHEN NOT EXISTS (SELECT 1 FROM `meta` WHERE `key` = 'codeSearchDeferred')
BEGIN
  INSERT INTO `code_fts`(rowid, path, name, name_split, text)
  VALUES (new.id, (SELECT path FROM files WHERE id = new.file_id), new.name, new.name_split, new.text);
END;
