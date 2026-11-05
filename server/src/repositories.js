export async function ensureIndexes(db) {
  await Promise.all([
    db.collection("targets").createIndex({ channelId: 1 }, { unique: true }),
    db.collection("rooms").createIndex({ channelId: 1 }, { unique: true }),
    db.collection("messages").createIndex({ dedupeKey: 1 }, { unique: true }),
    db.collection("messages").createIndex({ targetChannelId: 1, sentAt: -1 }),
    db.collection("messages").createIndex({ roomChannelId: 1, sentAt: -1 }),
  ]);
}

function configurationRepository(collection) {
  return {
    async list() {
      return collection.find({}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray();
    },
    async add(channel) {
      const document = { ...channel, createdAt: new Date() };
      await collection.updateOne({ channelId: channel.channelId }, { $setOnInsert: document }, { upsert: true });
      return document;
    },
    async remove(channelId) {
      return collection.deleteOne({ channelId });
    },
  };
}

export function createRepositories(db) {
  const messages = db.collection("messages");
  return {
    targets: configurationRepository(db.collection("targets")),
    rooms: configurationRepository(db.collection("rooms")),
    messages: {
      async insertIgnoringDuplicates(documents) {
        if (!documents.length) return 0;
        try {
          const result = await messages.insertMany(documents, { ordered: false });
          return result.insertedCount;
        } catch (error) {
          if (error?.code === 11000 || error?.writeErrors?.every((item) => item.code === 11000)) {
            return error.result?.insertedCount ?? 0;
          }
          throw error;
        }
      },
      async list({ targetChannelId, roomChannelId, query, before, limit = 100 }) {
        const filter = {};
        if (targetChannelId) filter.targetChannelId = targetChannelId;
        if (roomChannelId) filter.roomChannelId = roomChannelId;
        if (query) filter.content = { $regex: query, $options: "i" };
        if (before) filter.sentAt = { $lt: new Date(before) };
        return messages.find(filter, { projection: { _id: 0, dedupeKey: 0 } }).sort({ sentAt: -1 }).limit(limit).toArray();
      },
    },
  };
}
