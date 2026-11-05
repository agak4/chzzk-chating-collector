import cors from "cors";
import express from "express";

import { getChannelMetadata, parseChannelId } from "./chzzk.js";

function adminOnly(adminApiKey) {
  return (request, response, next) => {
    if (!adminApiKey || request.get("x-admin-key") !== adminApiKey) {
      return response.status(401).json({ error: "관리자 키가 필요합니다." });
    }
    return next();
  };
}

function asLimit(value) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.min(Math.max(number, 1), 100) : 50;
}

export function createApp({ repositories, collector, adminApiKey, corsOrigin = "*" }) {
  const app = express();
  app.use(cors({ origin: corsOrigin === "*" ? true : corsOrigin }));
  app.use(express.json());

  app.get("/health", (_request, response) => response.json({ ok: true }));
  app.get("/api/configuration", async (_request, response, next) => {
    try {
      const [targets, rooms] = await Promise.all([repositories.targets.list(), repositories.rooms.list()]);
      response.json({ targets, rooms });
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/messages", async (request, response, next) => {
    try {
      const messages = await repositories.messages.list({
        targetChannelId: request.query.target,
        roomChannelId: request.query.room,
        query: request.query.q,
        before: request.query.before,
        limit: asLimit(request.query.limit),
      });
      response.json({ messages, nextCursor: messages.at(-1)?.sentAt ?? null });
    } catch (error) {
      next(error);
    }
  });

  const protect = adminOnly(adminApiKey);
  for (const [path, repository] of [["targets", repositories.targets], ["rooms", repositories.rooms]]) {
    app.post(`/api/admin/${path}`, protect, async (request, response, next) => {
      try {
        const channelId = parseChannelId(request.body?.source);
        const channel = await getChannelMetadata(channelId);
        await repository.add(channel);
        response.status(201).json(channel);
      } catch (error) {
        next(error);
      }
    });
    app.delete(`/api/admin/${path}/:channelId`, protect, async (request, response, next) => {
      try {
        await repository.remove(request.params.channelId);
        response.status(204).end();
      } catch (error) {
        next(error);
      }
    });
  }
  app.post("/api/admin/collect", protect, async (_request, response, next) => {
    try {
      response.json({ results: await collector.collectAll() });
    } catch (error) {
      next(error);
    }
  });

  app.use((error, _request, response, _next) => {
    console.error(error);
    response.status(400).json({ error: error.message ?? "요청을 처리하지 못했습니다." });
  });
  return app;
}
