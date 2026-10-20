const redisClient = require('../redis/client');

// Matches connect-redis' default key prefix.
const SESSION_PREFIX = 'sess:';

// Deletes every stored session that belongs to a user. Pass the session id of
// the request to keep that one alive (so changing your own password does not
// sign out the device you are using). Used after password change/reset so
// stolen or shared sessions cannot outlive the old password.
//
// KEYS is intentional here: it only runs on a password change/reset and Telos
// session counts are small. Failure is non-fatal; the password change itself
// has already succeeded.
async function invalidateUserSessions(userId, exceptSessionId = null) {
  if (userId === undefined || userId === null) return 0;

  let keys;
  try {
    keys = await redisClient.keys(`${SESSION_PREFIX}*`);
  } catch (error) {
    console.error('Could not list sessions for invalidation:', error.message);
    return 0;
  }

  let removed = 0;
  for (const key of keys || []) {
    if (exceptSessionId && key === `${SESSION_PREFIX}${exceptSessionId}`) continue;

    let raw;
    try {
      raw = await redisClient.get(key);
    } catch {
      continue;
    }
    if (!raw) continue;

    let session;
    try {
      session = JSON.parse(raw);
    } catch {
      continue;
    }
    if (String(session?.passport?.user) !== String(userId)) continue;

    try {
      await redisClient.del(key);
      removed += 1;
    } catch (error) {
      console.error(`Could not invalidate session ${key}:`, error.message);
    }
  }
  return removed;
}

module.exports = { SESSION_PREFIX, invalidateUserSessions };
