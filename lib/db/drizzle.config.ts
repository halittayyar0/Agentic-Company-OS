import { defineConfig } from "drizzle-kit";
import { readdirSync } from "node:fs";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  // Point Drizzle Kit at the concrete table modules. An export-only index is
  // not discovered reliably across Drizzle Kit/Node versions.
  schema: readdirSync("./src/schema")
    .filter((name) => name.endsWith(".ts") && name !== "index.ts")
    .map((name) => `./src/schema/${name}`),
  out: "./src/generated-sql",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
