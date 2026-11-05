const CHANNEL_ID_PATTERN = /^[a-zA-Z0-9]{8,64}$/;
const USER_AGENT = "ChzzkChatCollector/1.0 (+https://github.com/your-account/chzzk-chat-collector)";

export function parseChannelId(source) {
  const value = String(source ?? "").trim();
  if (CHANNEL_ID_PATTERN.test(value)) return value;

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("치지직 채널 URL 또는 채널 ID를 입력하세요.");
  }

  if (url.hostname !== "chzzk.naver.com") {
    throw new Error("chzzk.naver.com 주소만 사용할 수 있습니다.");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  const marker = parts.findIndex((part) => part === "live" || part === "chat");
  const channelId = marker >= 0 ? parts[marker + 1] : undefined;
  if (!channelId || !CHANNEL_ID_PATTERN.test(channelId)) {
    throw new Error("URL에서 채널 ID를 찾을 수 없습니다.");
  }
  return channelId;
}

async function getJson(url) {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`치지직 API 요청 실패 (${response.status})`);
  const body = await response.json();
  if (body.code !== 200 || !body.content) throw new Error("치지직 API가 유효한 데이터를 반환하지 않았습니다.");
  return body.content;
}

export async function getChannelMetadata(channelId) {
  const content = await getJson(`https://api.chzzk.naver.com/service/v1/channels/${channelId}`);
  return {
    channelId: content.channelId,
    name: content.channelName,
    avatarUrl: content.channelImageUrl ?? null,
  };
}

export async function getLiveStatus(channelId) {
  return getJson(`https://api.chzzk.naver.com/polling/v2/channels/${channelId}/live-status`);
}

export async function getReadToken(chatChannelId) {
  return getJson(
    `https://comm-api.game.naver.com/nng_main/v1/chats/access-token?channelId=${encodeURIComponent(chatChannelId)}&chatType=STREAMING`,
  );
}

function parseProfile(profile) {
  if (typeof profile !== "string") return {};
  try {
    return JSON.parse(profile);
  } catch {
    return {};
  }
}

export function messagesFromFrame(frame) {
  if (![15101, 93101].includes(frame?.cmd)) return [];
  const entries = Array.isArray(frame.bdy) ? frame.bdy : frame.bdy?.messageList;
  if (!Array.isArray(entries)) return [];

  return entries
    .filter((entry) => entry && typeof (entry.msg ?? entry.content) === "string" && Number(entry.msgTypeCode ?? entry.messageTypeCode) === 1)
    .map((entry) => {
      const profile = parseProfile(entry.profile);
      return {
        authorId: entry.uid ?? entry.userId,
        authorName: profile.nickname ?? "알 수 없음",
        authorAvatarUrl: profile.profileImageUrl ?? null,
        content: entry.msg ?? entry.content,
        sentAt: new Date(Number(entry.msgTime ?? entry.messageTime ?? entry.createTime)),
      };
    })
    .filter((entry) => entry.authorId && !Number.isNaN(entry.sentAt.valueOf()));
}
