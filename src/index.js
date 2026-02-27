const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const chrono = require('chrono-node');
const http = require('http');
const db = require('./database');
require('dotenv').config();

// ─── Track Discord connection state ──────────────────────────────────────────
let discordReady = false;
let disconnectedSince = null;

// ─── Health check server (keeps Railway from sleeping) ───────────────────────
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  const status = discordReady ? 200 : 503;
  res.writeHead(status, { 'Content-Type': 'text/plain' });
  res.end(discordReady ? 'OK' : 'Discord disconnected');
}).listen(PORT, () => {
  console.log(`Health check server listening on port ${PORT}`);
});

// ─── Create the Discord client ───────────────────────────────────────────────
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// ─── Bot ready ───────────────────────────────────────────────────────────────
let schedulerStarted = false;

client.on('ready', () => {
  discordReady = true;
  disconnectedSince = null;
  console.log(`Bot is online as ${client.user.tag}`);

  if (!schedulerStarted) {
    schedulerStarted = true;
    console.log(`Checking for scheduled messages every 15 seconds...`);
    setInterval(checkScheduledMessages, 15_000);
  }
});

client.on('shardDisconnect', (event) => {
  discordReady = false;
  disconnectedSince = disconnectedSince || Date.now();
  console.warn(`Discord shard disconnected (code ${event.code}). Will attempt reconnect...`);
});

client.on('shardReconnecting', () => {
  console.log('Discord shard reconnecting...');
});

client.on('shardResume', () => {
  discordReady = true;
  disconnectedSince = null;
  console.log('Discord shard resumed.');
});

client.on('shardError', (error) => {
  console.error('Discord shard error:', error.message);
});

// If disconnected for >2 minutes, exit so Railway restarts the process
setInterval(() => {
  if (disconnectedSince && Date.now() - disconnectedSince > 2 * 60 * 1000) {
    console.error('Discord disconnected for >2 minutes. Exiting for restart...');
    process.exit(1);
  }
}, 30_000);

// ─── Default timezone (from .env) ────────────────────────────────────────────
const DEFAULT_TIMEZONE = process.env.DEFAULT_TIMEZONE || 'UTC';

/**
 * Convert an IANA timezone name (e.g. "America/New_York") to a numeric UTC
 * offset in minutes that chrono-node reliably understands.
 *
 * chrono-node accepts IANA strings in theory, but on UTC-based servers (like
 * Railway) it can silently fall back to UTC.  A numeric offset always works.
 */
function getTimezoneOffsetMinutes(timezoneName) {
  const now = new Date();
  const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
  const tzDate  = new Date(now.toLocaleString('en-US', { timeZone: timezoneName }));
  return Math.round((tzDate - utcDate) / 60000);
}

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
      case 'schedule-timezone':
        await handleScheduleTimezone(interaction);
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

// ─── Handle button & modal interactions ──────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton()) {
    try {
      const customId = interaction.customId;

      // ── Cancel button ──────────────────────────────────────────────────
      if (customId.startsWith('cancel_schedule_')) {
        const messageId = parseInt(customId.replace('cancel_schedule_', ''), 10);
        const deleted = db.cancelMessage(messageId, interaction.user.id);

        if (deleted) {
          const embed = new EmbedBuilder()
            .setColor(0xed4245)
            .setTitle('Message Cancelled')
            .setDescription(`Scheduled message **#${messageId}** has been cancelled and will not be sent.`);

          await interaction.update({ embeds: [embed], components: [] });
        } else {
          const embed = new EmbedBuilder()
            .setColor(0x2b2d31)
            .setTitle('Message Sent ✓')
            .setDescription(`This message has already been sent or cancelled.`);

          await interaction.update({ embeds: [embed], components: [] });
        }
        return;
      }

      // ── Cancel button (from schedule-list) ──────────────────────────────
      if (customId.startsWith('list_cancel_')) {
        const messageId = parseInt(customId.replace('list_cancel_', ''), 10);
        const deleted = db.cancelMessage(messageId, interaction.user.id);

        if (deleted) {
          const remaining = db.getUserMessages(interaction.guildId, interaction.user.id);
          const response = buildScheduleListResponse(remaining);

          if (remaining.length === 0) {
            const embed = new EmbedBuilder()
              .setColor(0xed4245)
              .setTitle('Message Cancelled')
              .setDescription(`Scheduled message **#${messageId}** has been cancelled.\n\nYou have no more scheduled messages.`);

            await interaction.update({ embeds: [embed], components: [] });
          } else {
            await interaction.update({
              content: `Scheduled message **#${messageId}** has been cancelled.`,
              ...response,
            });
          }
        } else {
          const remaining = db.getUserMessages(interaction.guildId, interaction.user.id);
          const response = buildScheduleListResponse(remaining);
          await interaction.update({
            content: `Message **#${messageId}** was already sent or cancelled.`,
            ...response,
          });
        }
        return;
      }

      // ── Edit button (from schedule-list) ────────────────────────────────
      if (customId.startsWith('list_edit_')) {
        const messageId = parseInt(customId.replace('list_edit_', ''), 10);
        const msg = db.getMessageById(messageId);

        if (!msg || msg.user_id !== interaction.user.id) {
          const remaining = db.getUserMessages(interaction.guildId, interaction.user.id);
          const response = buildScheduleListResponse(remaining);
          await interaction.update({
            content: `Message **#${messageId}** has already been sent or cancelled.`,
            ...response,
          });
          return;
        }

        const modal = new ModalBuilder()
          .setCustomId(`edit_modal_${messageId}`)
          .setTitle(`Edit Scheduled Message #${messageId}`);

        const messageInput = new TextInputBuilder()
          .setCustomId('edited_message')
          .setLabel('Message')
          .setStyle(TextInputStyle.Paragraph)
          .setValue(msg.message)
          .setRequired(true);

        const timeInput = new TextInputBuilder()
          .setCustomId('edited_time')
          .setLabel('New time (leave unchanged to keep current)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. tomorrow at 3pm')
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder().addComponents(messageInput),
          new ActionRowBuilder().addComponents(timeInput),
        );

        await interaction.showModal(modal);
        return;
      }

      // ── Edit button (from confirmation embed) ──────────────────────────
      if (customId.startsWith('edit_schedule_')) {
        const messageId = parseInt(customId.replace('edit_schedule_', ''), 10);
        const msg = db.getMessageById(messageId);

        if (!msg || msg.user_id !== interaction.user.id) {
          const embed = new EmbedBuilder()
            .setColor(0x2b2d31)
            .setTitle('Message Sent ✓')
            .setDescription(`This message has already been sent or cancelled.`);

          await interaction.update({ embeds: [embed], components: [] });
          return;
        }

        const modal = new ModalBuilder()
          .setCustomId(`edit_modal_${messageId}`)
          .setTitle(`Edit Scheduled Message #${messageId}`);

        const messageInput = new TextInputBuilder()
          .setCustomId('edited_message')
          .setLabel('Message')
          .setStyle(TextInputStyle.Paragraph)
          .setValue(msg.message)
          .setRequired(true);

        const timeInput = new TextInputBuilder()
          .setCustomId('edited_time')
          .setLabel('New time (leave unchanged to keep current)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. tomorrow at 3pm')
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder().addComponents(messageInput),
          new ActionRowBuilder().addComponents(timeInput),
        );

        await interaction.showModal(modal);
        return;
      }
    } catch (error) {
      console.error('Error handling button interaction:', error);
    }
  }

  // ── Modal submit (schedule) ────────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId.startsWith('schedule_modal_')) {
    try {
      const idPayload = interaction.customId.replace('schedule_modal_', '');
      let channelId, threadId;
      if (idPayload.includes('_thread_')) {
        [channelId, threadId] = idPayload.split('_thread_');
      } else {
        channelId = idPayload;
        threadId = null;
      }
      const messageText = interaction.fields.getTextInputValue('schedule_message');
      const timeInput = interaction.fields.getTextInputValue('schedule_time').trim();

      const timezone = db.getUserTimezone(interaction.user.id) || DEFAULT_TIMEZONE;
      const timezoneOffset = getTimezoneOffsetMinutes(timezone);

      const parsedDate = chrono.parseDate(timeInput, { instant: new Date(), timezone: timezoneOffset }, { forwardDate: true });

      if (!parsedDate) {
        await interaction.reply({
          content: `I couldn't understand the time **"${timeInput}"**. Try something like:\n` +
            '• "tomorrow at 3pm"\n• "in 2 hours"\n• "Friday at noon"\n• "March 5 at 10:30am"',
          ephemeral: true,
        });
        return;
      }

      if (parsedDate <= new Date()) {
        await interaction.reply({
          content: `That time is in the past. Please pick a future time.`,
          ephemeral: true,
        });
        return;
      }

      let channel;
      let permWarning = '';
      try {
        channel = await client.channels.fetch(channelId);
        const botPermissions = channel.permissionsFor(interaction.guild.members.me);
        if (botPermissions && !botPermissions.has(PermissionsBitField.Flags.ManageWebhooks)) {
          permWarning = `\n\n⚠️ I don't have **Manage Webhooks** permission in <#${channelId}>, so the message will be sent as the bot instead of appearing as you.`;
        }
      } catch (_) {
        permWarning = `\n\n⚠️ I can't access <#${channelId}> right now. The message is saved, but make sure the bot has **View Channels**, **Send Messages**, and **Manage Webhooks** permissions in that channel before the scheduled time.`;
      }

      const userDisplayName = interaction.member?.displayName || interaction.user.displayName || interaction.user.username;
      const userAvatarUrl = interaction.user.displayAvatarURL({ size: 256 });

      const id = db.addScheduledMessage({
        guildId: interaction.guildId,
        channelId,
        userId: interaction.user.id,
        message: messageText,
        sendAt: parsedDate,
        userDisplayName,
        userAvatarUrl,
        interactionToken: interaction.token,
        threadId,
      });

      const unixTimestamp = Math.floor(parsedDate.getTime() / 1000);
      const destinationLabel = threadId ? `<#${threadId}> (thread)` : `<#${channelId}>`;

      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('Message Scheduled')
        .addFields(
          { name: 'Message', value: messageText },
          { name: 'Channel', value: destinationLabel },
          { name: 'Sends at', value: `<t:${unixTimestamp}:F> (<t:${unixTimestamp}:R>)` },
          { name: 'ID', value: `${id}`, inline: true },
        )
        .setFooter({ text: 'Use /schedule-list to see all your scheduled messages' });

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`edit_schedule_${id}`)
          .setLabel('Edit')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('✏️'),
        new ButtonBuilder()
          .setCustomId(`cancel_schedule_${id}`)
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🗑️'),
      );

      await interaction.reply({
        content: permWarning || undefined,
        embeds: [embed],
        components: [buttons],
        ephemeral: true,
      });
    } catch (error) {
      console.error('Error handling schedule modal submit:', error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'Something went wrong while scheduling your message. Please try again.',
          ephemeral: true,
        });
      }
    }
    return;
  }

  // ── Modal submit (edit) ──────────────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId.startsWith('edit_modal_')) {
    try {
      const messageId = parseInt(interaction.customId.replace('edit_modal_', ''), 10);
      const msg = db.getMessageById(messageId);

      if (!msg || msg.user_id !== interaction.user.id) {
        await interaction.reply({
          content: `Could not find message **#${messageId}**. It may have already been sent or cancelled.`,
          ephemeral: true,
        });
        return;
      }

      const newMessage = interaction.fields.getTextInputValue('edited_message');
      const newTimeInput = interaction.fields.getTextInputValue('edited_time').trim();

      let newSendAt = msg.send_at;

      if (newTimeInput) {
        const timezone = db.getUserTimezone(interaction.user.id) || DEFAULT_TIMEZONE;
        const timezoneOffset = getTimezoneOffsetMinutes(timezone);
        const parsedDate = chrono.parseDate(newTimeInput, { instant: new Date(), timezone: timezoneOffset }, { forwardDate: true });

        if (!parsedDate) {
          await interaction.reply({
            content: `I couldn't understand the time **"${newTimeInput}"**. The message was not updated.\n\n` +
              'Try something like: "tomorrow at 3pm", "in 2 hours", "Friday at noon"',
            ephemeral: true,
          });
          return;
        }

        if (parsedDate <= new Date()) {
          await interaction.reply({
            content: `That time is in the past. The message was not updated.`,
            ephemeral: true,
          });
          return;
        }

        newSendAt = Math.floor(parsedDate.getTime() / 1000);
      }

      const updated = db.updateMessage(messageId, interaction.user.id, {
        message: newMessage,
        sendAt: newSendAt,
      });

      if (updated) {
        const embed = new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle('Message Updated')
          .addFields(
            { name: 'Message', value: newMessage },
            { name: 'Channel', value: msg.thread_id ? `<#${msg.thread_id}> (thread)` : `<#${msg.channel_id}>` },
            { name: 'Sends at', value: `<t:${newSendAt}:F> (<t:${newSendAt}:R>)` },
            { name: 'ID', value: `${messageId}`, inline: true },
          )
          .setFooter({ text: 'Use /schedule-list to see all your scheduled messages' });

        const editButtons = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`edit_schedule_${messageId}`)
            .setLabel('Edit')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('✏️'),
          new ButtonBuilder()
            .setCustomId(`cancel_schedule_${messageId}`)
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🗑️'),
        );

        await interaction.reply({ embeds: [embed], components: [editButtons], ephemeral: true });
      } else {
        await interaction.reply({
          content: `Could not update message **#${messageId}**. It may have already been sent or cancelled.`,
          ephemeral: true,
        });
      }
    } catch (error) {
      console.error('Error handling modal submit:', error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'Something went wrong while updating your message. Please try again.',
          ephemeral: true,
        });
      }
    }
  }
});

// ─── /schedule-timezone ──────────────────────────────────────────────────────
async function handleScheduleTimezone(interaction) {
  const timezone = interaction.options.getString('timezone');
  db.setUserTimezone(interaction.user.id, timezone);

  const now = Math.floor(Date.now() / 1000);

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('Timezone Updated')
        .setDescription(
          `Your personal timezone has been set to **${timezone}**.\n\n` +
          `Current time for you: <t:${now}:F>\n\n` +
          `This overrides the server default (**${DEFAULT_TIMEZONE}**). ` +
          `All your scheduled messages will now use **${timezone}**.`
        ),
    ],
    ephemeral: true,
  });
}

// ─── /schedule — show modal ──────────────────────────────────────────────────
async function handleSchedule(interaction) {
  const explicitChannel = interaction.options.getChannel('channel');

  let channel = explicitChannel || interaction.channel;
  if (!channel) {
    try {
      channel = await interaction.client.channels.fetch(interaction.channelId);
    } catch (_) {
      // Bot can't access the channel — fall back to using the ID directly
    }
  }

  let targetChannelId = channel?.id || interaction.channelId;
  let threadId = null;

  if (!explicitChannel && channel?.isThread()) {
    targetChannelId = channel.parentId;
    threadId = channel.id;
  }

  const customId = threadId
    ? `schedule_modal_${targetChannelId}_thread_${threadId}`
    : `schedule_modal_${targetChannelId}`;

  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle('Schedule a Message');

  const messageInput = new TextInputBuilder()
    .setCustomId('schedule_message')
    .setLabel('Message')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Type your message here...')
    .setRequired(true);

  const timeInput = new TextInputBuilder()
    .setCustomId('schedule_time')
    .setLabel('When to send it')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('e.g. tomorrow at 9am, in 2 hours, Friday at noon')
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(messageInput),
    new ActionRowBuilder().addComponents(timeInput),
  );

  await interaction.showModal(modal);
}

// ─── Schedule list helper (shared by /schedule-list and list button handlers) ─
function buildScheduleListResponse(messages) {
  if (messages.length === 0) {
    return {
      content: "You don't have any scheduled messages.",
      embeds: [],
      components: [],
      ephemeral: true,
    };
  }

  const lines = messages.map((msg) => {
    const preview = msg.message.length > 50 ? msg.message.slice(0, 50) + '...' : msg.message;
    const channelRef = msg.thread_id ? `<#${msg.thread_id}> (thread)` : `<#${msg.channel_id}>`;
    return `**#${msg.id}** — <t:${msg.send_at}:f> (<t:${msg.send_at}:R>)\n> ${preview}\n> Channel: ${channelRef}`;
  });

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Your Scheduled Messages')
    .setDescription(lines.join('\n\n'));

  const components = messages.slice(0, 5).map((msg) =>
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`list_edit_${msg.id}`)
        .setLabel(`Edit #${msg.id}`)
        .setStyle(ButtonStyle.Primary)
        .setEmoji('✏️'),
      new ButtonBuilder()
        .setCustomId(`list_cancel_${msg.id}`)
        .setLabel(`Cancel #${msg.id}`)
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🗑️'),
    )
  );

  if (messages.length > 5) {
    embed.setFooter({ text: `Showing buttons for the first 5 messages. Use /schedule-cancel id:<number> for the rest.` });
  }

  return { embeds: [embed], components, ephemeral: true };
}

// ─── /schedule-list ──────────────────────────────────────────────────────────
async function handleScheduleList(interaction) {
  const messages = db.getUserMessages(interaction.guildId, interaction.user.id);
  await interaction.reply(buildScheduleListResponse(messages));
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
  const webhooks = await channel.fetchWebhooks();

  const existing = webhooks.find(
    (wh) => wh.name === WEBHOOK_NAME && wh.owner?.id === client.user.id
  );
  if (existing) return existing;

  return channel.createWebhook({
    name: WEBHOOK_NAME,
    reason: 'Used by Schedule Send bot to deliver messages as the original author',
  });
}

// ─── Notify user of a delivery failure via DM ───────────────────────────────
async function notifyUserOfFailure(userId, msg, errorMessage) {
  try {
    const user = await client.users.fetch(userId);
    const preview = msg.message.length > 100 ? msg.message.slice(0, 100) + '...' : msg.message;
    await user.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle('Scheduled Message Failed to Send')
          .setDescription(
            `Your scheduled message could not be delivered to <#${msg.thread_id || msg.channel_id}>.\n\n` +
            `**Error:** ${errorMessage}\n\n` +
            `**Your message was:**\n> ${preview}`
          )
          .setFooter({ text: 'Try rescheduling with /schedule, and make sure the bot has "Manage Webhooks" permission in that channel.' }),
      ],
    });
  } catch (dmError) {
    console.error(`Could not DM user ${userId} about failure:`, dmError.message);
  }
}

// ─── Clean up the confirmation embed after a message is sent ─────────────────
async function cleanUpConfirmationEmbed(msg) {
  if (!msg.interaction_token) return;

  try {
    const sentEmbed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setTitle('Message Sent ✓')
      .addFields(
        { name: 'Message', value: msg.message.length > 100 ? msg.message.slice(0, 100) + '...' : msg.message },
        { name: 'Channel', value: msg.thread_id ? `<#${msg.thread_id}> (thread)` : `<#${msg.channel_id}>` },
        { name: 'Sent at', value: `<t:${msg.send_at}:F>` },
      );

    await client.rest.patch(
      `/webhooks/${client.user.id}/${msg.interaction_token}/messages/@original`,
      { body: { embeds: [sentEmbed.toJSON()], components: [] } },
    );
  } catch (_) {
    // Token expired (>15 min) — buttons will be cleaned up when clicked instead
  }
}

// Max time (in seconds) to keep retrying a failed message before giving up
const MAX_RETRY_WINDOW = 2 * 60 * 60; // 2 hours

// ─── Scheduler: checks every 15 seconds for due messages ────────────────────
async function checkScheduledMessages() {
  if (!discordReady) return;

  const dueMessages = db.getDueMessages();

  for (const msg of dueMessages) {
    let sent = false;
    const overdueSec = Math.floor(Date.now() / 1000) - msg.send_at;

    try {
      const channel = await client.channels.fetch(msg.channel_id);
      if (!channel) {
        console.warn(`Channel ${msg.channel_id} not found, skipping message #${msg.id}`);
        await notifyUserOfFailure(msg.user_id, msg, 'The channel no longer exists or the bot cannot access it.');
        db.deleteMessage(msg.id);
        continue;
      }

      const threadId = msg.thread_id || null;
      let threadChannel = null;
      if (threadId) {
        try {
          threadChannel = await client.channels.fetch(threadId);
        } catch (_) {
          console.warn(`Thread ${threadId} not found for message #${msg.id}, sending to parent channel instead`);
        }
      }

      try {
        const webhook = await getOrCreateWebhook(channel);
        const webhookPayload = {
          content: msg.message,
          username: msg.user_display_name || 'Scheduled Message',
          avatarURL: msg.user_avatar_url || undefined,
        };
        if (threadId) webhookPayload.threadId = threadId;
        await webhook.send(webhookPayload);
        sent = true;
        const dest = threadChannel ? `thread #${threadChannel.name}` : `#${channel.name}`;
        console.log(`Sent scheduled message #${msg.id} to ${dest} as "${msg.user_display_name}" (via webhook)`);
      } catch (webhookError) {
        console.warn(`Webhook failed for message #${msg.id}: ${webhookError.message}. Falling back to channel.send()...`);

        try {
          const fallbackLabel = msg.user_display_name ? ` (scheduled by ${msg.user_display_name})` : '';
          const sendTarget = threadChannel || channel;
          await sendTarget.send(`${msg.message}${fallbackLabel}`);
          sent = true;
          console.log(`Sent scheduled message #${msg.id} to #${sendTarget.name} via fallback (channel.send)`);
        } catch (sendError) {
          console.error(`Fallback also failed for message #${msg.id}:`, sendError.message);
        }
      }
    } catch (error) {
      console.error(`Failed to send message #${msg.id}:`, error.message);
    }

    if (sent) {
      await cleanUpConfirmationEmbed(msg);
      db.deleteMessage(msg.id);
    } else if (overdueSec > MAX_RETRY_WINDOW) {
      console.error(`Message #${msg.id} has failed for ${Math.round(overdueSec / 60)} minutes — giving up.`);
      await notifyUserOfFailure(msg.user_id, msg, `The bot tried to send this message for over ${Math.round(MAX_RETRY_WINDOW / 3600)} hours but kept failing. Please check that the bot has View Channels, Send Messages, and Manage Webhooks permissions in the channel.`);
      db.deleteMessage(msg.id);
    } else {
      console.warn(`Message #${msg.id} failed to send (${Math.round(overdueSec / 60)}min overdue) — will retry.`);
    }
  }
}

// ─── Log in (with retry on transient failures) ──────────────────────────────
async function loginWithRetry(retries = 10, delay = 5_000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await client.login(process.env.DISCORD_TOKEN);
      return;
    } catch (error) {
      console.error(`Login attempt ${attempt}/${retries} failed: ${error.message}`);
      if (attempt === retries) {
        console.error('All login attempts exhausted. Exiting...');
        process.exit(1);
      }
      const wait = delay * attempt;
      console.log(`Retrying in ${wait / 1000}s...`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

loginWithRetry();
