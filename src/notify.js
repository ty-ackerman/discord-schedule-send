const https = require('https');
const http = require('http');

const NTFY_TOPIC = process.env.NTFY_TOPIC;
const NTFY_SERVER = process.env.NTFY_SERVER || 'https://ntfy.sh';

function isEnabled() {
  return Boolean(NTFY_TOPIC);
}

/**
 * Send a push notification via ntfy.
 *
 * @param {string} title   - Notification title
 * @param {string} message - Notification body
 * @param {object} [opts]
 * @param {string} [opts.priority] - "min" | "low" | "default" | "high" | "urgent"
 * @param {string[]} [opts.tags]   - Emoji shortcodes, e.g. ["warning", "robot"]
 */
function send(title, message, opts = {}) {
  if (!isEnabled()) return;

  const url = new URL(`/${NTFY_TOPIC}`, NTFY_SERVER);
  const transport = url.protocol === 'https:' ? https : http;

  const headers = {
    'Title': title,
    'Content-Type': 'text/plain',
  };
  if (opts.priority) headers['Priority'] = opts.priority;
  if (opts.tags?.length) headers['Tags'] = opts.tags.join(',');

  const req = transport.request(url, { method: 'POST', headers }, (res) => {
    if (res.statusCode >= 400) {
      console.error(`ntfy alert failed (HTTP ${res.statusCode})`);
    }
    res.resume();
  });

  req.on('error', (err) => {
    console.error(`ntfy alert failed: ${err.message}`);
  });

  req.end(message);
}

module.exports = { send, isEnabled };
