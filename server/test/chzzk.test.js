import assert from "node:assert/strict";
import test from "node:test";

import { createCollector, messageDedupeKey } from "../src/collector.js";
import { messagesFromFrame, parseChannelId } from "../src/chzzk.js";

test("parseChannelId accepts an ID and live/chat URLs", () => {
  const id = "afff6e3cc8c1487bc4135bc896811dcc";
  assert.equal(parseChannelId(id), id);
  assert.equal(parseChannelId(`https://chzzk.naver.com/live/${id}/chat`), id);
  assert.equal(parseChannelId(`https://chzzk.naver.com/chat/${id}`), id);
});

test("parseChannelId rejects a non-CHZZK URL", () => {
  assert.throws(() => parseChannelId("https://example.com/live/afff6e3cc8c1487bc4135bc896811dcc"));
});

test("messagesFromFrame reads regular chat only", () => {
  const messages = messagesFromFrame({
    cmd: 15101,
    bdy: { messageList: [
      { userId: "streamer-id", content: "hello", messageTypeCode: 1, messageTime: 1_700_000_000_000, profile: '{"nickname":"테스터"}' },
      { userId: "streamer-id", content: "donation", messageTypeCode: 10, messageTime: 1_700_000_000_000, profile: "{}" },
    ] },
  });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].authorName, "테스터");
  assert.equal(messages[0].sentAt.toISOString(), "2023-11-14T22:13:20.000Z");
});

test("messageDedupeKey is stable and room-scoped", () => {
  const message = { roomChannelId: "room-a", authorId: "user", content: "same", sentAt: new Date("2026-01-01T00:00:00Z") };
  assert.equal(messageDedupeKey(message), messageDedupeKey(message));
  assert.notEqual(messageDedupeKey(message), messageDedupeKey({ ...message, roomChannelId: "room-b" }));
});

test("collector saves only messages written by configured targets", async () => {
  const inserted = [];
  const collector = createCollector({
    repositories: { messages: { insertIgnoringDuplicates: async (items) => { inserted.push(...items); return items.length; } } },
    dependencies: {
      getLiveStatus: async () => ({ status: "OPEN", chatActive: true, chatChannelId: "chat-room" }),
      getReadToken: async () => ({ accessToken: "read-token" }),
      requestRecentMessages: async () => [
        { authorId: "target-id", authorName: "대상", content: "찾아야 할 채팅", sentAt: new Date("2026-01-01T00:00:00Z") },
        { authorId: "other-id", authorName: "다른 사람", content: "제외", sentAt: new Date("2026-01-01T00:00:01Z") },
      ],
    },
  });
  const result = await collector.collectRoom(
    { channelId: "room-id", name: "조회방", avatarUrl: null },
    [{ channelId: "target-id", name: "수집 대상", avatarUrl: null }],
  );
  assert.equal(result.inserted, 1);
  assert.deepEqual(inserted.map((item) => [item.targetChannelId, item.roomChannelId, item.content]), [["target-id", "room-id", "찾아야 할 채팅"]]);
});
