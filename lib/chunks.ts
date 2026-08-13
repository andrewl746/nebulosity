import ts from "typescript";
import crypto from "crypto";
import fs from "fs";

import { getDb } from "./db/client";
import { files, chunks, meta } from "./db/schema";
import { eq, and, count } from "drizzle-orm";
import type { CodeChunk } from "./contracts";

