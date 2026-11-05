import crypto from "node:crypto";
import WebSocket from "ws";

import { getLiveStatus, getReadToken, messagesFromFrame } from "./chzzk.js";

const CHAT_SOCKET_URL = "wss://kr-ss2.chat.naver.com/chat";

export function messageDedupeKey({ roomChannelId, authorId, content, sentAt }) {
  return crypto
    .createHash("sha256")
    .update(`${roomChannelId}\u0000${authorId}\u0000${sentAt.toISOString()}\u0000${content}`)
    .digest("hex");
}

export function requestRecentMessages({ chatChannelId, accessToken, count, createSocket = (url) => new WebSocket(url) }) {
  return new Promise((resolve, reject) => {
    const socket = createSocket(CHAT_SOCKET_URL);
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.close();
      callback(value);
    };
    const timeout = setTimeout(() => finish(reject, new Error("치지직 채팅 응답 시간이 초과되었습니다.")), 15_000);

    socket.on("open", () => {
      socket.send(JSON.stringify({
        ver: "2",
        cmd: 100,
        svcid: "game",
        cid: chatChannelId,
        tid: 1,
        bdy: { uid: null, devType: 2001, accTkn: accessToken, auth: "READ" },
      }));
    });

    socket.on("message", (raw) => {
      let frame;
      try {
        frame = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (frame.cmd === 10100) {
        socket.send(JSON.stringify({
          ver: "2",
          cmd: 5101,
          svcid: "game",
          cid: chatChannelId,
          tid: 2,
          sid: frame.bdy?.sid,
          bdy: { recentMessageCount: count },
        }));
      } else if (frame.cmd === 15101) {
        finish(resolve, messagesFromFrame(frame));
      } else if (frame.cmd === 0) {
        socket.send(JSON.stringify({ ver: "2", cmd: 10000 }));
      }
    });

    socket.on("error", (error) => finish(reject, error));
  });
}

export function createCollector({ repositories, recentMessageCount = 100, dependencies = {} }) {
  const loadLiveStatus = dependencies.getLiveStatus ?? getLiveStatus;
  const loadReadToken = dependencies.getReadToken ?? getReadToken;
  const loadRecentMessages = dependencies.requestRecentMessages ?? requestRecentMessages;

  async function collectRoom(room, targets) {
    const live = await loadLiveStatus(room.channelId);
    if (live.status !== "OPEN" || !live.chatActive || !live.chatChannelId) {
      return { roomChannelId: room.channelId, status: "offline", inserted: 0 };
    }

    const token = await loadReadToken(live.chatChannelId);
    const messages = await loadRecentMessages({
      chatChannelId: live.chatChannelId,
      accessToken: token.accessToken,
      count: recentMessageCount,
    });
    const targetsById = new Map(targets.map((target) => [target.channelId, target]));
    const capturedAt = new Date();
    const collected = messages.flatMap((message) => {
      const target = targetsById.get(message.authorId);
      if (!target) return [];
      return [{
        dedupeKey: messageDedupeKey({ roomChannelId: room.channelId, ...message }),
        targetChannelId: target.channelId,
        targetName: target.name,
        targetAvatarUrl: target.avatarUrl,
        roomChannelId: room.channelId,
        roomName: room.name,
        roomAvatarUrl: room.avatarUrl,
        authorId: message.authorId,
        authorName: message.authorName,
        authorAvatarUrl: message.authorAvatarUrl,
        content: message.content,
        sentAt: message.sentAt,
        capturedAt,
      }];
    });
    const inserted = await repositories.messages.insertIgnoringDuplicates(collected);
    return { roomChannelId: room.channelId, status: "collected", inserted };
  }

  async function collectAll() {
    const [rooms, targets] = await Promise.all([repositories.rooms.list(), repositories.targets.list()]);
    if (!rooms.length || !targets.length) return [];
    return Promise.allSettled(rooms.map((room) => collectRoom(room, targets)));
  }

  return { collectAll, collectRoom };
}
