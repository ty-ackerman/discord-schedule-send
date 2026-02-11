const { REST, Routes, SlashCommandBuilder, ChannelType } = require('discord.js');
require('dotenv').config();

const commands = [
  new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('Schedule a message to be sent later')
    .addStringOption(option =>
      option
        .setName('message')
        .setDescription('The message you want to send')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('time')
        .setDescription('When to send it (e.g. "tomorrow at 3pm", "in 2 hours", "March 5 at noon")')
        .setRequired(true)
    )
    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Which channel to send it in (defaults to this one)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('schedule-list')
    .setDescription('View your upcoming scheduled messages'),

  new SlashCommandBuilder()
    .setName('schedule-cancel')
    .setDescription('Cancel a scheduled message')
    .addIntegerOption(option =>
      option
        .setName('id')
        .setDescription('The ID of the scheduled message (use /schedule-list to find it)')
        .setRequired(true)
    ),
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Registering slash commands...');

    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );

    console.log('Done! Slash commands registered successfully.');
  } catch (error) {
    console.error('Failed to register commands:', error);
  }
})();
