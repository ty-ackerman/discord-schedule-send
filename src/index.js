const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const chrono = require('chrono-node');
const dayjs = require('dayjs');
const relativeTime = require('dayjs/plugin/relativeTime');
const http = require('http');
const db = require('./database');
require('dotenv').config();

dayjs.extend(relativeTime);

// ─── Health check server (keeps Railway from sleeping) ───────────────────────
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('OK');
}).listen(PORT, () => {
  console.log(`Health check server listening on port ${PORT}`);
});

// ─── Create the Discord client ───────────────────────────────────────────────
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// ─── Bot ready ───────────────────────────────────────────────────────────────
client.once('clientReady', () => {
  console.log(`Bot is online as ${client.user.tag}`);
  console.log(`Checking for scheduled messages every 15 seconds...`);

  // Start the scheduler loop
  setInterval(checkScheduledMessages, 15_000);
});

// ─── Handle slash commands ───────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    switch (interaction.commandName) {
      case 'schedule':
        await handleSchedule(interaction);
        break;
      case 'schedule-list':
        await handleScheduleList(interaction);
        break;
      case 'schedule-cancel':
        await handleScheduleCancel(interaction);
        break;
    }
  } catch (error) {
    console.error(`Error handling /${interaction.commandName}:`, error);

    const reply = {
      content: 'Something went wrong. Please try again.',
      ephemeral: true,
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply);
    } else {
      await interaction.reply(reply);
    }
  }
});

// ─── /schedule ───────────────────────────────────────────────────────────────
async function handleSchedule(interaction) {
  const messageText = interaction.options.getString('message');
  const timeInput = interaction.options.getString('time');
  const channel = interaction.options.getChannel('channel') || interaction.channel;

  // Parse the natural language time
  const parsedDate = chrono.parseDate(timeInput, new Date(), { forwardDate: true });

  if (!parsedDate) {
    return interaction.reply({
      content: `I couldn't understand the time **"${timeInput}"**. Try something like:\n` +
        '• "tomorrow at 3pm"\n• "in 2 hours"\n• "Friday at noon"\n• "March 5 at 10:30am"',
      ephemeral: true,
    });
  }

  // Make sure the time is in the future
  if (parsedDate <= new Date()) {
    return interaction.reply({
      content: `That time is in the past. Please pick a future time.`,
      ephemeral: true,
    });
  }

  // Capture user identity so the scheduled message looks like it came from them
  const userDisplayName = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;
  const userAvatarUrl = interaction.user.displayAvatarURL({ size: 256 });

  // Save to database
  const id = db.addScheduledMessage({
    guildId: interaction.guildId,
    channelId: channel.id,
    userId: interaction.user.id,
    message: messageText,
    sendAt: parsedDate,
    userDisplayName,
    userAvatarUrl,
  });

  const formattedTime = dayjs(parsedDate).format('dddd, MMMM D, YYYY [at] h:mm A');
  const relTime = dayjs(parsedDate).fromNow();

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('Message Scheduled')
    .addFields(
      { name: 'Message', value: messageText },
      { name: 'Channel', value: `<#${channel.id}>` },
      { name: 'Sends at', value: `${formattedTime} (${relTime})` },
      { name: 'ID', value: `${id}`, inline: true },
    )
    .setFooter({ text: 'Use /schedule-list to see all your scheduled messages' });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

// ─── /schedule-list ──────────────────────────────────────────────────────────
async function handleScheduleList(interaction) {
  const messages = db.getUserMessages(interaction.guildId, interaction.user.id);

  if (messages.length === 0) {
    return interaction.reply({
      content: "You don't have any scheduled messages.",
      ephemeral: true,
    });
  }

  const lines = messages.map((msg) => {
    const sendAt = dayjs(msg.send_at * 1000);
    const formatted = sendAt.format('ddd, MMM D [at] h:mm A');
    const relative = sendAt.fromNow();
    const preview = msg.message.length > 50 ? msg.message.slice(0, 50) + '...' : msg.message;
    return `**#${msg.id}** — ${formatted} (${relative})\n> ${preview}\n> Channel: <#${msg.channel_id}>`;
  });

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Your Scheduled Messages')
    .setDescription(lines.join('\n\n'))
    .setFooter({ text: 'Use /schedule-cancel id:<number> to cancel one' });

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

// ─── /schedule-cancel ────────────────────────────────────────────────────────
async function handleScheduleCancel(interaction) {
  const id = interaction.options.getInteger('id');
  const deleted = db.cancelMessage(id, interaction.user.id);

  if (deleted) {
    await interaction.reply({
      content: `Scheduled message **#${id}** has been cancelled.`,
      ephemeral: true,
    });
  } else {
    await interaction.reply({
      content: `Couldn't find a scheduled message **#${id}** that belongs to you.`,
      ephemeral: true,
    });
  }
}

// ─── Webhook helper: get or create a webhook the bot can reuse ───────────────
const WEBHOOK_NAME = 'Schedule Send';

async function getOrCreateWebhook(channel) {
  // Fetch existing webhooks on this channel
  const webhooks = await channel.fetchWebhooks();

  // Reuse one we already created (match by name and owner)
  const existing = webhooks.find(
    (wh) => wh.name === WEBHOOK_NAME && wh.owner?.id === client.user.id
  );
  if (existing) return existing;

  // Create a new one
  return channel.createWebhook({
    name: WEBHOOK_NAME,
    reason: 'Used by Schedule Send bot to deliver messages as the original author',
  });
}

// ─── Scheduler: checks every 15 seconds for due messages ────────────────────
async function checkScheduledMessages() {
  const dueMessages = db.getDueMessages();

  for (const msg of dueMessages) {
    try {
      const channel = await client.channels.fetch(msg.channel_id);
      if (!channel) {
        console.warn(`Channel ${msg.channel_id} not found, skipping message #${msg.id}`);
        db.deleteMessage(msg.id);
        continue;
      }

      // Use a webhook so the message appears with the user's name and avatar
      const webhook = await getOrCreateWebhook(channel);
      await webhook.send({
        content: msg.message,
        username: msg.user_display_name || 'Scheduled Message',
        avatarURL: msg.user_avatar_url || undefined,
      });

      console.log(`Sent scheduled message #${msg.id} to #${channel.name} as "${msg.user_display_name}"`);
    } catch (error) {
      console.error(`Failed to send message #${msg.id}:`, error.message);
    }

    // Delete the message from the database whether it sent or not
    // (to avoid retrying broken messages forever)
    db.deleteMessage(msg.id);
  }
}

// ─── Log in ──────────────────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN);
