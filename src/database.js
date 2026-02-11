const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'scheduled_messages.db'));

// Create the table if it doesn't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS scheduled_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    message TEXT NOT NULL,
    send_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    user_display_name TEXT,
    user_avatar_url TEXT
  )
`);

// Migrate: add columns if they don't exist (for existing databases)
try {
  db.exec(`ALTER TABLE scheduled_messages ADD COLUMN user_display_name TEXT`);
} catch (_) { /* column already exists */ }
try {
  db.exec(`ALTER TABLE scheduled_messages ADD COLUMN user_avatar_url TEXT`);
} catch (_) { /* column already exists */ }

/**
 * Save a new scheduled message to the database.
 * @returns The inserted row's id.
 */
function addScheduledMessage({ guildId, channelId, userId, message, sendAt, userDisplayName, userAvatarUrl }) {
  const stmt = db.prepare(`
    INSERT INTO scheduled_messages (guild_id, channel_id, user_id, message, send_at, user_display_name, user_avatar_url)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(guildId, channelId, userId, message, Math.floor(sendAt.getTime() / 1000), userDisplayName, userAvatarUrl);
  return result.lastInsertRowid;
}

/**
 * Get all messages that are due to be sent (send_at <= now).
 */
function getDueMessages() {
  const now = Math.floor(Date.now() / 1000);
  const stmt = db.prepare(`SELECT * FROM scheduled_messages WHERE send_at <= ?`);
  return stmt.all(now);
}

/**
 * Delete a message by its id (after it's been sent).
 */
function deleteMessage(id) {
  const stmt = db.prepare(`DELETE FROM scheduled_messages WHERE id = ?`);
  stmt.run(id);
}

/**
 * Get all pending messages for a specific user in a guild.
 */
function getUserMessages(guildId, userId) {
  const stmt = db.prepare(`
    SELECT * FROM scheduled_messages
    WHERE guild_id = ? AND user_id = ?
    ORDER BY send_at ASC
  `);
  return stmt.all(guildId, userId);
}

/**
 * Cancel a scheduled message by id (only if the user owns it).
 * @returns true if a row was deleted, false otherwise.
 */
function cancelMessage(id, userId) {
  const stmt = db.prepare(`DELETE FROM scheduled_messages WHERE id = ? AND user_id = ?`);
  const result = stmt.run(id, userId);
  return result.changes > 0;
}

module.exports = {
  addScheduledMessage,
  getDueMessages,
  deleteMessage,
  getUserMessages,
  cancelMessage,
};
