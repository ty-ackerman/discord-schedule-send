# Discord Schedule Send Bot

A Discord bot that lets you type something like `/schedule message: Happy birthday! time: tomorrow at 9am` and the bot will send that message at the right time — even if you're offline.

## What it does

- **`/schedule`** — Schedule a message to be sent later. You type the message, pick a time in plain English, and optionally choose a channel.
- **`/schedule-list`** — See all your upcoming scheduled messages, with **Edit** and **Cancel** buttons right on each one.
- **`/schedule-cancel`** — Cancel a scheduled message by its ID (also available as a button on `/schedule-list`).
- **`/schedule-timezone`** *(optional)* — Override the server's default timezone with your own. Most people won't need this — it's only for someone in a different timezone than the rest of the team.

The bot checks every 15 seconds for messages that are due and sends them automatically.

## Quick start (run it on your computer)

### 1. Set up your Discord bot

If you haven't already:

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and create a new Application.
2. Go to the **Bot** tab, click **Reset Token**, and copy the token.
3. Go to **OAuth2 > URL Generator**:
   - Check `bot` and `applications.commands` under Scopes
   - Check `Send Messages` and `Manage Webhooks` under Bot Permissions
   - Copy the generated URL and paste it into your browser to invite the bot to your server
4. You'll need three values for the next step:
   - **Bot Token** — from step 2
   - **Application ID** — on the General Information page
   - **Guild ID** — right-click your server name in Discord (with Developer Mode on) and click Copy Server ID

### 2. Create your `.env` file

Create a file called `.env` in the project root:

```
DISCORD_TOKEN=your-bot-token
CLIENT_ID=your-application-id
GUILD_ID=your-server-id
DEFAULT_TIMEZONE=America/New_York
```

The `DEFAULT_TIMEZONE` is the timezone used for all users by default. Set this to wherever most of your team is located. Common values: `America/New_York` (Eastern), `America/Chicago` (Central), `America/Denver` (Mountain), `America/Los_Angeles` (Pacific). Full list: [IANA timezone names](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones).

### 3. Install dependencies

```bash
npm install
```

### 4. Register the slash commands

You only need to do this once (or whenever you change the commands):

```bash
npm run deploy
```

### 5. Start the bot

```bash
npm start
```

You should see `Bot is online as YourBot#1234` in the terminal. Go to your Discord server and try `/schedule`!

## Time examples

The bot understands natural language for times. Here are some things you can type:

| You type | It understands |
|---|---|
| `in 30 minutes` | 30 minutes from now |
| `tomorrow at 3pm` | Tomorrow at 3:00 PM |
| `friday at noon` | Next Friday at 12:00 PM |
| `march 5 at 10:30am` | March 5th at 10:30 AM |
| `in 2 hours` | 2 hours from now |
| `next monday at 9am` | Next Monday at 9:00 AM |

## Deploy to Railway (keep it running 24/7)

Railway is a cloud platform that will run your bot for free (or very cheap). Here's how:

### 1. Push your code to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
```

Then create a repo on [github.com](https://github.com) and push to it:

```bash
git remote add origin https://github.com/YOUR_USERNAME/discord-schedule-send.git
git branch -M main
git push -u origin main
```

### 2. Deploy on Railway

1. Go to [railway.app](https://railway.app) and sign in with GitHub.
2. Click **New Project** > **Deploy from GitHub repo**.
3. Select your `discord-schedule-send` repository.
4. Railway will detect it's a Node.js app automatically.

### 3. Add your environment variables

In your Railway project dashboard:

1. Click on your service (the one it just created).
2. Go to the **Variables** tab.
3. Add these four variables:
   - `DISCORD_TOKEN` = your bot token
   - `CLIENT_ID` = your application ID
   - `GUILD_ID` = your server ID
   - `DEFAULT_TIMEZONE` = your team's timezone (e.g. `America/New_York`)

### 4. Register commands (one time)

In Railway, go to the **Settings** tab of your service and find the **Custom Start Command** field. Temporarily set it to:

```
node src/deploy-commands.js && node src/index.js
```

After the first deploy succeeds and you see "Done! Slash commands registered" in the logs, you can change it back to just:

```
node src/index.js
```

Or leave it — it's harmless to re-register commands on each start.

### 5. Keep it alive with UptimeRobot (free)

Railway may put your service to sleep after a period of inactivity. To prevent that, set up a free monitoring service that pings your bot every few minutes:

1. Go to [UptimeRobot](https://uptimerobot.com) and create a free account.
2. Click **Add New Monitor**.
3. Set **Monitor Type** to **HTTP(s)**.
4. For the **URL**, paste your Railway service's public URL — you can find this in your Railway dashboard under your service's **Settings > Networking > Public Networking**. It'll look something like `https://discord-schedule-send-production.up.railway.app`.
5. Set the **Monitoring Interval** to 5 minutes (the free tier minimum).
6. Click **Create Monitor**.

That's it — UptimeRobot will ping your bot every 5 minutes, which keeps Railway from putting it to sleep.

### That's it!

Your bot is now running 24/7. Railway will automatically redeploy whenever you push to GitHub.

## Project structure

```
├── .env                  # Your secrets (not committed to git)
├── .gitignore
├── package.json
├── Procfile              # Tells Railway this is a web service (exposes a health check endpoint)
├── README.md
└── src/
    ├── index.js          # Main bot — handles commands and the scheduler loop
    ├── deploy-commands.js # Registers slash commands with Discord (run once)
    └── database.js       # SQLite database for storing scheduled messages
```

## Good to know

- **Timezone handling.** The bot uses the `DEFAULT_TIMEZONE` from your `.env` for all users. If someone on your team is in a different timezone, they can run `/schedule-timezone` to override it for themselves — but most people won't need to.
- **Messages look like they came from you.** When a scheduled message is sent, it shows your display name and avatar — not the bot's. Under the hood, the bot uses a Discord webhook to achieve this. The only subtle difference from a normal message is a small "BOT" tag next to your name (this is a Discord limitation for any webhook-sent message, and there's no way around it).
- **Edit or cancel from anywhere.** After scheduling a message, the confirmation includes **Edit** and **Cancel** buttons. These same buttons also appear on every message in `/schedule-list`, so you can manage everything from one place. Click **Edit** to change the message text or reschedule the time — a pop-up form appears with your message pre-filled. Click **Cancel** to remove it, and the list refreshes automatically. Discord allows up to 5 button rows per message, so if you have more than 5 scheduled messages, the rest can be managed with `/schedule-cancel`.
- **Messages are only visible to you** when you use the commands — the bot replies with "ephemeral" messages that only you can see. The scheduled message itself is sent publicly.
- **The bot needs Manage Webhooks permission.** This is what allows it to send messages that display your name and avatar. If the bot doesn't have this permission in a channel, it will fall back to sending as the bot. If that also fails, you'll get a DM explaining what went wrong.
- **SQLite on Railway**: Railway's filesystem resets on each deploy. This means any pending scheduled messages and timezone preferences will be lost when you redeploy. For casual use this is fine. If you need persistence, you could switch to Railway's PostgreSQL add-on (but that's a bigger change).
- **15-second check interval**: The bot checks for due messages every 15 seconds, so your message might be sent up to 15 seconds after the scheduled time.
- **Connection resilience**: If the Discord gateway disconnects (e.g. network blip, another client using the same token), the bot will attempt to reconnect automatically. If disconnected for more than 2 minutes, the process exits so Railway can restart it fresh. The health check endpoint also reports the actual Discord connection status, not just whether Node.js is running.
