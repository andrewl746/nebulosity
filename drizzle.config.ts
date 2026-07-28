import { defineConfig } from "drizzle-kit";

// Config for drizzle-kit (schema push + migration tooling).
// The database is derived data — it lives under .nebulosity/ (gitignored),
// same place the app opens it at runtime.
export default defineConfig({
  dialect: "sqlite",
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  dbCredentials: {
    url: ".nebulosity/nebulosity.db",
  },
});
