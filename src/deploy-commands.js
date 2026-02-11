const { REST, Routes, SlashCommandBuilder, ChannelType } = require('discord.js');
require('dotenv').config();

const commands = [
  new SlashCommandBuilder()
    .setName('schedule')
    .setDescription('Schedule a message to be sent later')
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

  new SlashCommandBuilder()
    .setName('schedule-timezone')
    .setDescription('Override the server default timezone with your own (optional)')
    .addStringOption(option =>
      option
        .setName('timezone')
        .setDescription('Your timezone')
        .setRequired(true)
        .addChoices(
          { name: '🇺🇸 Eastern (New York)',      value: 'America/New_York' },
          { name: '🇺🇸 Central (Chicago)',        value: 'America/Chicago' },
          { name: '🇺🇸 Mountain (Denver)',        value: 'America/Denver' },
          { name: '🇺🇸 Pacific (Los Angeles)',    value: 'America/Los_Angeles' },
          { name: '🇺🇸 Alaska',                   value: 'America/Anchorage' },
          { name: '🇺🇸 Hawaii',                   value: 'Pacific/Honolulu' },
          { name: '🇨🇦 Atlantic (Halifax)',       value: 'America/Halifax' },
          { name: '🇬🇧 UK (London)',              value: 'Europe/London' },
          { name: '🇫🇷 Central Europe (Paris)',   value: 'Europe/Paris' },
          { name: '🇩🇪 Central Europe (Berlin)',  value: 'Europe/Berlin' },
          { name: '🇫🇮 Eastern Europe (Helsinki)', value: 'Europe/Helsinki' },
          { name: '🇷🇺 Moscow',                   value: 'Europe/Moscow' },
          { name: '🇮🇳 India (Kolkata)',          value: 'Asia/Kolkata' },
          { name: '🇦🇪 Dubai',                    value: 'Asia/Dubai' },
          { name: '🇨🇳 China (Shanghai)',         value: 'Asia/Shanghai' },
          { name: '🇯🇵 Japan (Tokyo)',            value: 'Asia/Tokyo' },
          { name: '🇰🇷 Korea (Seoul)',            value: 'Asia/Seoul' },
          { name: '🇦🇺 Australia East (Sydney)',  value: 'Australia/Sydney' },
          { name: '🇦🇺 Australia West (Perth)',   value: 'Australia/Perth' },
          { name: '🇳🇿 New Zealand (Auckland)',   value: 'Pacific/Auckland' },
          { name: '🇧🇷 Brazil (São Paulo)',       value: 'America/Sao_Paulo' },
          { name: '🇲🇽 Mexico (Mexico City)',     value: 'America/Mexico_City' },
        )
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
