import "dotenv/config";
import { MongoClient } from "mongodb";

import { createApp } from "./app.js";
import { createCollector } from "./collector.js";
import { createRepositories, ensureIndexes } from "./repositories.js";

const port = Number(process.env.PORT ?? 3000);
const databaseName = process.env.MONGODB_DATABASE ?? "chzzk_collector";
const intervalMs = 60_000;
const recentMessageCount = Math.min(Math.max(Number(process.env.RECENT_MESSAGE_COUNT ?? 100), 1), 100);

if (!process.env.MONGODB_URI || !process.env.ADMIN_API_KEY) {
  throw new Error("MONGODB_URI와 ADMIN_API_KEY 환경변수가 필요합니다.");
}

const mongo = new MongoClient(process.env.MONGODB_URI);
await mongo.connect();
const database = mongo.db(databaseName);
await ensureIndexes(database);

const repositories = createRepositories(database);
const collector = createCollector({ repositories, recentMessageCount });
const app = createApp({
  repositories,
  collector,
  adminApiKey: process.env.ADMIN_API_KEY,
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
});

let collecting = false;
async function runCollection() {
  if (collecting) return;
  collecting = true;
  try {
    const results = await collector.collectAll();
    console.info("collection", results.map((result) => result.status));
  } catch (error) {
    console.error("collection failed", error);
  } finally {
    collecting = false;
  }
}

setInterval(runCollection, intervalMs);
void runCollection();

const server = app.listen(port, () => console.info(`collector server listening on ${port}`));
async function shutdown() {
  server.close();
  await mongo.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
