import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  // Point Drizzle Kit at the concrete table modules. An export-only index is
  // not discovered reliably across Drizzle Kit/Node versions.
  schema: "./src/schema/*.ts",
  out: "./src/generated-sql",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
