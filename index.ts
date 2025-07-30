import * as discord from 'discord.js';
import { REST, Routes, MessageFlags, Collection } from 'discord.js';
import * as fs from 'fs';
import config from './config.json';
import * as server from './server';
import { log, sendEmbed } from './utils';
import commands, { saveConfig } from './commands/commands';
import './announcements';

// Extend the Discord Client type to include commands
declare module 'discord.js' {
    export interface Client {
        commands: Collection<string, any>;
    }
}

interface Config {
  botToken: string;
  clientId: string;
  admins: string[];
  whitelist: string[];
  bans?: Array<{
    player: string;
    reason: string;
    timestamp: string;
    bannedBy: string;
  }>;
  playerStats?: {
    [playerName: string]: {
      totalPlaytime: number;
      joinCount: number;
      lastSeen: number;
      sessionStart?: number;
    };
  };
  playerNotes?: {
    [playerName: string]: {
      warnings: number;
      notes: string[];
    };
  };
  rewardsConfig?: {
    enabled: boolean;
    milestones?: Array<{
      timeMinutes: number;
      reward: string;
      description: string;
    }>;
  };
  milestones?: Array<{
    playtime: number;
    reward: string;
  }>;
  welcomeEnabled?: boolean;
  altSystem?: {
    maxGamerScore: number;
    maxFriends: number;
    maxFollowers: number;
    enabled?: boolean;
  };
  welcomeChannelId?: string | null;
  logChannelId?: string | null;
  memberRoleId?: string | null;

  servers?: Array<{
    serverName?: string;
    serverIp?: string;
    serverPort?: number;
    logChannels?: {
      chat?: string | null;
      kicks?: string | null;
      joinsAndLeaves?: string | null;
    };
  }>;
  allowlist?: string[];
  maintenanceMode?: {
    enabled: boolean;
    enabledBy: string;
    enabledAt: number;
    reason: string;
  };
  connectedPlayers?: Array<{
    username: string;
    uuid: string;
  }>;
}

const typedConfig = config as Config;

const client = new discord.Client({
    intents: [
        discord.GatewayIntentBits.GuildMessages,
        discord.GatewayIntentBits.Guilds,
        discord.GatewayIntentBits.MessageContent,
    ],
});

// Create a collection to store commands
client.commands = new Collection();
commands.forEach(command => {
    client.commands.set(command.data.name, command);
});

// Function to deploy commands
async function deployCommands(): Promise<boolean> {
    try {
        const commandData = commands.map(command => command.data.toJSON());
        const rest = new REST().setToken(typedConfig.botToken);
        
        log(`Started refreshing ${commandData.length} application (/) commands.`);
        
        const data = await rest.put(
            Routes.applicationCommands(typedConfig.clientId),
            { body: commandData },
        ) as any[];
        
        log(`Successfully reloaded ${data.length} application (/) commands.`);
        log(`Available commands: ${data.map((cmd: any) => cmd.name).join(', ')}`);
        return true;
    } catch (error) {
        console.error('Error deploying commands:', error);
        return false;
    }
}

// Logging function
client.on('ready', async () => {
    if (!client.user) return;
    
    log(`Logged in as ${client.user.username}!`);
    log(`Loaded ${client.commands.size} slash commands`);
    
    // Auto-deploy commands on startup
    await deployCommands();
    
    log('Connecting to server...');
    server.setDiscordClient(client); // Set Discord client before spawning bot
    server.spawnBot(); // No need to pass server parameter anymore
});

// Handle all interactions
client.on('interactionCreate', async (interaction: discord.Interaction) => {
    // Handle slash commands
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);

        if (!command) {
            console.error(`No command matching ${interaction.commandName} was found.`);
            return;
        }

        try {
            await command.execute(interaction, client);
        } catch (error) {
            console.error('Error executing command:', error);
            const errorMessage = { content: 'There was an error while executing this command!', ephemeral: true };
            
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(errorMessage);
            } else {
                await interaction.reply(errorMessage);
            }
        }
        return;
    }



    // Handle modal submissions
    if (interaction.isModalSubmit()) {
        console.log(`Global modal submit received: ${interaction.customId}`);
        
        if (interaction.customId === 'admin_add_submit' || interaction.customId === 'whitelist_add_submit' ||
            interaction.customId === 'allowlist_add_submit' || interaction.customId === 'player_ban_submit' || interaction.customId === 'player_unban_submit' ||
            interaction.customId === 'player_stats_submit' || interaction.customId === 'player_notes_submit' ||
            interaction.customId === 'view_notes_submit' || interaction.customId === 'alt_adjust_gamerscore_submit' ||
            interaction.customId === 'alt_adjust_friends_submit' || interaction.customId === 'alt_adjust_followers_submit' ||
            interaction.customId === 'rewards_add_milestone_submit' || interaction.customId === 'rewards_remove_milestone_submit' ||
            interaction.customId === 'maintenance_reason_modal' || interaction.customId === 'announcement_add_submit') {
            try {
                await interaction.deferUpdate();
                
                switch (interaction.customId) {
                    case 'announcement_add_submit':
                        const message = interaction.fields.getTextInputValue('announcement_message');
                        const cronTime = interaction.fields.getTextInputValue('announcement_time');
                        const announcements = JSON.parse(fs.readFileSync('./announcements.json', 'utf-8'));
                        const newAnnouncement = {
                            id: Date.now().toString(),
                            message,
                            cronTime
                        };
                        announcements.push(newAnnouncement);
                        fs.writeFileSync('./announcements.json', JSON.stringify(announcements, null, 2));
                        await interaction.editReply({ content: `In-game announcement added successfully! Will repeat every ${cronTime} minute(s).` });
                        break;
                    case 'admin_add_submit':
                        const userIdInput = interaction.fields.getTextInputValue('admin_user_input');
                        let userId = userIdInput;
                        
                        // Try to resolve user ID if it's a mention or username
                        if (userIdInput.startsWith('<@') && userIdInput.endsWith('>')) {
                            userId = userIdInput.slice(2, -1);
                            if (userId.startsWith('!')) {
                                userId = userId.slice(1);
                            }
                        } else if (!userIdInput.match(/^\d+$/)) {
                            // Try to find user by username
                            try {
                                const user = await client.users.fetch(userIdInput).catch(() => null);
                                if (!user) {
                                    const guild = interaction.guild;
                                    if (guild) {
                                        const member = guild.members.cache.find(m => 
                                            m.user.username.toLowerCase() === userIdInput.toLowerCase() ||
                                            m.displayName.toLowerCase() === userIdInput.toLowerCase()
                                        );
                                        if (member) {
                                            userId = member.user.id;
                                        } else {
                                            await interaction.editReply({
                                                embeds: [new discord.EmbedBuilder()
                                                    .setTitle('Error')
                                                    .setDescription('User not found. Please use a valid user ID, mention, or username.')
                                                    .setColor('#FF0000')],
                                                components: []
                                            });
                                            return;
                                        }
                                    }
                                } else {
                                    userId = user.id;
                                }
                            } catch (error) {
                                await interaction.editReply({
                                    embeds: [new discord.EmbedBuilder()
                                        .setTitle('Error')
                                        .setDescription('User not found. Please use a valid user ID, mention, or username.')
                                        .setColor('#FF0000')],
                                    components: []
                                });
                                return;
                            }
                        }
                        
                        // Check if user is already an admin
                        if (typedConfig.admins.includes(userId)) {
                            await interaction.editReply({
                                embeds: [new discord.EmbedBuilder()
                                    .setTitle('Warning')
                                    .setDescription('User is already an admin.')
                                    .setColor('#FFA500')],
                                components: []
                            });
                            return;
                        }
                        
                        // Add user to admins
                        typedConfig.admins.push(userId);
                        saveConfig();
                        console.log(`Admin added: ${userId} by ${interaction.user.tag}.`);
                        
                        await interaction.editReply({
                            embeds: [new discord.EmbedBuilder()
                                .setTitle('Success')
                                .setDescription(`Admin added successfully: <@${userId}>`)
                                .setColor('#00FF00')],
                            components: []
                        });
                        break;
                        
                    case 'whitelist_add_submit':
                        const usernameInput = interaction.fields.getTextInputValue('whitelist_username_input');
                        
                        // Check if username is already whitelisted
                        if (typedConfig.whitelist.includes(usernameInput)) {
                            await interaction.editReply({
                                embeds: [new discord.EmbedBuilder()
                                    .setTitle('Warning')
                                    .setDescription('Username is already whitelisted.')
                                    .setColor('#FFA500')],
                                components: []
                            });
                            return;
                        }
                        
                        // Add username to whitelist
                        typedConfig.whitelist.push(usernameInput);
                        saveConfig();
                        console.log(`Whitelist added: ${usernameInput} by ${interaction.user.tag}.`);
                        
                        await interaction.editReply({
                            embeds: [new discord.EmbedBuilder()
                                .setTitle('Success')
                                .setDescription(`Username added to whitelist: ${usernameInput}`)
                                .setColor('#00FF00')],
                            components: []
                        });
                        break;
                        
                    case 'allowlist_add_submit':
                        const allowlistUsernameInput = interaction.fields.getTextInputValue('allowlist_username_input');
                        
                        // Initialize allowlist if it doesn't exist
                        if (!typedConfig.allowlist) {
                            typedConfig.allowlist = [];
                        }
                        
                        // Check if username is already allowlisted
                        if (typedConfig.allowlist.includes(allowlistUsernameInput)) {
                            await interaction.editReply({
                                embeds: [new discord.EmbedBuilder()
                                    .setTitle('Warning')
                                    .setDescription('Username is already allowlisted.')
                                    .setColor('#FFA500')],
                                components: []
                            });
                            return;
                        }
                        
                        // Add username to allowlist
                        typedConfig.allowlist.push(allowlistUsernameInput);
                        saveConfig();
                        console.log(`Allowlist added: ${allowlistUsernameInput} by ${interaction.user.tag}.`);
                        
                        await interaction.editReply({
                            embeds: [new discord.EmbedBuilder()
                                .setTitle('Success')
                                .setDescription(`Username added to allowlist: ${allowlistUsernameInput}`)
                                .setColor('#00FF00')],
                            components: []
                        });
                        break;
                        
                    case 'maintenance_reason_modal':
                        const maintenanceReason = interaction.fields.getTextInputValue('maintenance_reason_input');
                        
                        // Initialize maintenanceMode if it doesn't exist
                        if (!typedConfig.maintenanceMode) {
                            typedConfig.maintenanceMode = {
                                enabled: false,
                                enabledBy: '',
                                enabledAt: 0,
                                reason: ''
                            };
                        }
                        
                        // Update the maintenance reason
                        typedConfig.maintenanceMode.reason = maintenanceReason;
                        saveConfig();
                        
                        console.log(`Maintenance reason set: ${maintenanceReason} by ${interaction.user.tag}`);
                        
                        await interaction.editReply({
                            embeds: [new discord.EmbedBuilder()
                                .setTitle('✅ Maintenance Reason Set')
                                .setDescription(`Maintenance reason has been updated to: ${maintenanceReason}`)
                                .setColor('#00FF00')],
                            components: []
                        });
                        break;
                        
                    case 'player_ban_submit':
                        const banPlayerName = interaction.fields.getTextInputValue('ban_username_input');
                        const banReason = interaction.fields.getTextInputValue('ban_reason_input') || 'No reason provided';
                        
                        // Check if player is already banned
                        if (typedConfig.bans && typedConfig.bans.some(ban => ban.player === banPlayerName)) {
                            await interaction.editReply({
                                embeds: [new discord.EmbedBuilder()
                                    .setTitle('Warning')
                                    .setDescription('Player is already banned.')
                                    .setColor('#FFA500')],
                                components: []
                            });
                            return;
                        }
                        
                        // Add ban
                        if (!typedConfig.bans) typedConfig.bans = [];
                        typedConfig.bans.push({
                            player: banPlayerName,
                            reason: banReason,
                            timestamp: new Date().toISOString(),
                            bannedBy: interaction.user.tag
                        });
                        saveConfig();
                        console.log(`Player banned: ${banPlayerName} by ${interaction.user.tag}. Reason: ${banReason}`);
                        
                        await interaction.editReply({
                            embeds: [new discord.EmbedBuilder()
                                .setTitle('Player Banned')
                                .setDescription(`**${banPlayerName}** has been banned.\n**Reason:** ${banReason}`)
                                .setColor('#FF0000')],
                            components: []
                        });
                        break;
                        
                    case 'player_unban_submit':
                        const unbanPlayerName = interaction.fields.getTextInputValue('unban_username_input');
                        
                        // Check if player is banned
                        if (!typedConfig.bans || !typedConfig.bans.some(ban => ban.player === unbanPlayerName)) {
                            await interaction.editReply({
                                embeds: [new discord.EmbedBuilder()
                                    .setTitle('Warning')
                                    .setDescription('Player is not currently banned.')
                                    .setColor('#FFA500')],
                                components: []
                            });
                            return;
                        }
                        
                        // Remove ban
                        typedConfig.bans = typedConfig.bans.filter(ban => ban.player !== unbanPlayerName);
                        saveConfig();
                        console.log(`Player unbanned: ${unbanPlayerName} by ${interaction.user.tag}`);
                        
                        await interaction.editReply({
                            embeds: [new discord.EmbedBuilder()
                                .setTitle('Player Unbanned')
                                .setDescription(`**${unbanPlayerName}** has been unbanned.`)
                                .setColor('#00FF00')],
                            components: []
                        });
                        break;
                        

                    case 'player_stats_submit':
                        const statsPlayerName = interaction.fields.getTextInputValue('stats_username_input');
                        
                        // Get player stats
                        const playerStats = typedConfig.playerStats?.[statsPlayerName];
                        if (!playerStats) {
                            await interaction.editReply({
                                embeds: [new discord.EmbedBuilder()
                                    .setTitle('Player Stats')
                                    .setDescription(`No stats found for **${statsPlayerName}**.`)
                                    .setColor('#FFA500')],
                                components: []
                            });
                            return;
                        }
                        
                        const totalMinutes = Math.floor((playerStats.totalPlaytime || 0) / 60000);
                        const joinCount = playerStats.joinCount || 0;
                        const lastSeen = playerStats.lastSeen ? new Date(playerStats.lastSeen).toLocaleString() : 'Never';
                        
                        // Add back button
                        const backRow = new discord.ActionRowBuilder<discord.ButtonBuilder>()
                            .addComponents(
                                new discord.ButtonBuilder()
                                    .setCustomId('back_to_main_dashboard')
                                    .setLabel('Back to Main Dashboard')
                                    .setStyle(discord.ButtonStyle.Secondary)
                            );

                        await interaction.editReply({
                            embeds: [new discord.EmbedBuilder()
                                .setTitle(`📊 Stats for ${statsPlayerName}`)
                                .addFields(
                                    { name: '⏱️ Total Playtime', value: `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`, inline: true },
                                    { name: '🔄 Join Count', value: joinCount.toString(), inline: true },
                                    { name: '👁️ Last Seen', value: lastSeen, inline: true }
                                )
                                .setColor('#0099FF')],
                            components: [backRow]
                        });
                        break;
                        
                    case 'player_notes_submit':
                        const notesPlayerName = interaction.fields.getTextInputValue('notes_username_input');
                        const noteContent = interaction.fields.getTextInputValue('notes_content_input');
                        
                        // Add note
                        if (!typedConfig.playerNotes) typedConfig.playerNotes = {};
                        if (!typedConfig.playerNotes[notesPlayerName]) {
                            typedConfig.playerNotes[notesPlayerName] = {
                                warnings: 0,
                                notes: []
                            };
                        }
                        
                        const noteWithTimestamp = `[${new Date().toISOString()}] ${noteContent} (by ${interaction.user.tag})`;
                        typedConfig.playerNotes[notesPlayerName].notes.push(noteWithTimestamp);
                        saveConfig();
                        console.log(`Note added for ${notesPlayerName} by ${interaction.user.tag}`);
                        
                        await interaction.editReply({
                            embeds: [new discord.EmbedBuilder()
                                .setTitle('Note Added')
                                .setDescription(`Note added for **${notesPlayerName}**.\n**Content:** ${noteContent}`)
                                .setColor('#00FF00')],
                            components: []
                        });
                        break;
                        
                    case 'view_notes_submit':
                        const viewPlayerName = interaction.fields.getTextInputValue('view_username_input');
                        
                        // Check if player has notes
                        if (!typedConfig.playerNotes || !typedConfig.playerNotes[viewPlayerName] || 
                            !typedConfig.playerNotes[viewPlayerName].notes || 
                            typedConfig.playerNotes[viewPlayerName].notes.length === 0) {
                            await interaction.editReply({
                                embeds: [new discord.EmbedBuilder()
                                    .setTitle('No Notes Found')
                                    .setDescription(`No notes found for **${viewPlayerName}**.`)
                                    .setColor('#FFA500')],
                                components: []
                            });
                            return;
                        }
                        
                        const playerNotes = typedConfig.playerNotes[viewPlayerName].notes;
                        const notesText = playerNotes.join('\n\n');
                        
                        // Split notes if too long for embed
                        const maxLength = 4000;
                        if (notesText.length > maxLength) {
                            const truncatedNotes = notesText.substring(0, maxLength - 50) + '\n\n... (truncated)';
                            await interaction.editReply({
                                embeds: [new discord.EmbedBuilder()
                                    .setTitle(`📝 Notes for ${viewPlayerName}`)
                                    .setDescription(truncatedNotes)
                                    .setColor('#3498DB')
                                    .setFooter({ text: `Total notes: ${playerNotes.length}` })],
                                components: []
                            });
                        } else {
                            await interaction.editReply({
                                embeds: [new discord.EmbedBuilder()
                                    .setTitle(`📝 Notes for ${viewPlayerName}`)
                                    .setDescription(notesText)
                                    .setColor('#3498DB')
                                    .setFooter({ text: `Total notes: ${playerNotes.length}` })],
                                components: []
                            });
                        }
                        break;
                        
                    case 'alt_adjust_gamerscore_submit':
                        const gamerscoreInput = interaction.fields.getTextInputValue('alt_gamerscore_input');
                        const gamerscore = parseInt(gamerscoreInput);
                        
                        if (isNaN(gamerscore) || gamerscore < 0) {
                            await interaction.editReply({
                                embeds: [new discord.EmbedBuilder()
                                    .setTitle('Error')
                                    .setDescription('Please enter a valid positive number for gamerscore.')
                                    .setColor('#FF0000')],
                                components: []
                            });
                            return;
                        }
                        
                        if (!typedConfig.altSystem) typedConfig.altSystem = { maxGamerScore: 0, maxFriends: 0, maxFollowers: 0 };
                        typedConfig.altSystem.maxGamerScore = gamerscore;
                        saveConfig();
                        console.log(`Alt gamerscore threshold updated to ${gamerscore} by ${interaction.user.tag}.`);
                        
                        await interaction.editReply({
                            embeds: [new discord.EmbedBuilder()
                                .setTitle('Alt Detection Updated')
                                .setDescription(`Gamerscore threshold set to **${gamerscore}**.`)
                                .setColor('#00FF00')],
                            components: []
                        });
                        break;
                        
                    case 'alt_adjust_friends_submit':
                        const friendsInput = interaction.fields.getTextInputValue('alt_friends_input');
                        const friends = parseInt(friendsInput);
                        
                        if (isNaN(friends) || friends < 0) {
                            await interaction.editReply({
                                embeds: [new discord.EmbedBuilder()
                                    .setTitle('Error')
                                    .setDescription('Please enter a valid positive number for friends.')
                                    .setColor('#FF0000')],
                                components: []
                            });
                            return;
                        }
                        
                        if (!typedConfig.altSystem) typedConfig.altSystem = { maxGamerScore: 0, maxFriends: 0, maxFollowers: 0 };
                        typedConfig.altSystem.maxFriends = friends;
                        saveConfig();
                        console.log(`Alt friends threshold updated to ${friends} by ${interaction.user.tag}.`);
                        
                        await interaction.editReply({
                            embeds: [new discord.EmbedBuilder()
                                .setTitle('Alt Detection Updated')
                                .setDescription(`Friends threshold set to **${friends}**.`)
                                .setColor('#00FF00')],
                            components: []
                        });
                        break;
                        
                    case 'alt_adjust_followers_submit':
                        const followersInput = interaction.fields.getTextInputValue('alt_followers_input');
                        const followers = parseInt(followersInput);
                        
                        if (isNaN(followers) || followers < 0) {
                            await interaction.editReply({
                                embeds: [new discord.EmbedBuilder()
                                    .setTitle('Error')
                                    .setDescription('Please enter a valid positive number for followers.')
                                    .setColor('#FF0000')],
                                components: []
                            });
                            return;
                        }
                        
                        if (!typedConfig.altSystem) typedConfig.altSystem = { maxGamerScore: 0, maxFriends: 0, maxFollowers: 0 };
                        typedConfig.altSystem.maxFollowers = followers;
                        saveConfig();
                        console.log(`Alt followers threshold updated to ${followers} by ${interaction.user.tag}.`);
                        
                        await interaction.editReply({
                            embeds: [new discord.EmbedBuilder()
                                .setTitle('Alt Detection Updated')
                                .setDescription(`Followers threshold set to **${followers}**.`)
                                .setColor('#00FF00')],
                            components: []
                        });
                        break;
                        

                        


                        

                        

                        
                    case 'rewards_add_milestone_submit':
                        const milestoneTimeInput = interaction.fields.getTextInputValue('milestone_time_input');
                        const milestoneRewardInput = interaction.fields.getTextInputValue('milestone_reward_input');
                        const milestoneDescInput = interaction.fields.getTextInputValue('milestone_desc_input');
                        
                        const milestoneTime = parseInt(milestoneTimeInput);
                        
                        if (isNaN(milestoneTime) || milestoneTime <= 0) {
                            await interaction.editReply({
                                embeds: [new discord.EmbedBuilder()
                                    .setTitle('Error')
                                    .setDescription('Please enter a valid positive number for time (in minutes).')
                                    .setColor('#FF0000')],
                                components: []
                            });
                            return;
                        }
                        
                        if (!milestoneRewardInput.trim() || !milestoneDescInput.trim()) {
                            await interaction.editReply({
                                embeds: [new discord.EmbedBuilder()
                                    .setTitle('Error')
                                    .setDescription('Please provide both reward name and description.')
                                    .setColor('#FF0000')],
                                components: []
                            });
                            return;
                        }
                        
                        if (!typedConfig.rewardsConfig) {
                            typedConfig.rewardsConfig = { enabled: false, milestones: [] };
                        }
                        if (!typedConfig.rewardsConfig.milestones) {
                            typedConfig.rewardsConfig.milestones = [];
                        }
                        
                        // Check if milestone already exists
                        if (typedConfig.rewardsConfig.milestones.some(m => m.timeMinutes === milestoneTime)) {
                            await interaction.editReply({
                                embeds: [new discord.EmbedBuilder()
                                    .setTitle('Error')
                                    .setDescription(`A milestone for ${milestoneTime} minutes already exists.`)
                                    .setColor('#FFA500')],
                                components: []
                            });
                            return;
                        }
                        
                        typedConfig.rewardsConfig.milestones.push({
                            timeMinutes: milestoneTime,
                            reward: milestoneRewardInput.trim(),
                            description: milestoneDescInput.trim()
                        });
                        
                        // Sort milestones by time
                        typedConfig.rewardsConfig.milestones.sort((a, b) => a.timeMinutes - b.timeMinutes);
                        
                        saveConfig();
                        console.log(`Milestone added: ${milestoneTime}min - ${milestoneRewardInput} by ${interaction.user.tag}.`);
                        
                        await interaction.editReply({
                            embeds: [new discord.EmbedBuilder()
                                .setTitle('Milestone Added')
                                .setDescription(`Added milestone: **${milestoneRewardInput}** at ${milestoneTime} minutes.`)
                                .setColor('#00FF00')],
                            components: []
                        });
                        break;
                        
                    case 'rewards_remove_milestone_submit':
                        const removeMilestoneTimeInput = interaction.fields.getTextInputValue('remove_milestone_time_input');
                        const removeMilestoneTime = parseInt(removeMilestoneTimeInput);
                        
                        if (isNaN(removeMilestoneTime) || removeMilestoneTime <= 0) {
                            await interaction.editReply({
                                embeds: [new discord.EmbedBuilder()
                                    .setTitle('Error')
                                    .setDescription('Please enter a valid positive number for time (in minutes).')
                                    .setColor('#FF0000')],
                                components: []
                            });
                            return;
                        }
                        
                        if (!typedConfig.rewardsConfig?.milestones) {
                            await interaction.editReply({
                                embeds: [new discord.EmbedBuilder()
                                    .setTitle('Error')
                                    .setDescription('No milestones configured.')
                                    .setColor('#FFA500')],
                                components: []
                            });
                            return;
                        }
                        
                        const milestoneIndex = typedConfig.rewardsConfig.milestones.findIndex(m => m.timeMinutes === removeMilestoneTime);
                        
                        if (milestoneIndex === -1) {
                            await interaction.editReply({
                                embeds: [new discord.EmbedBuilder()
                                    .setTitle('Error')
                                    .setDescription(`No milestone found for ${removeMilestoneTime} minutes.`)
                                    .setColor('#FFA500')],
                                components: []
                            });
                            return;
                        }
                        
                        const removedMilestone = typedConfig.rewardsConfig.milestones[milestoneIndex];
                        typedConfig.rewardsConfig.milestones.splice(milestoneIndex, 1);
                        
                        saveConfig();
                        console.log(`Milestone removed: ${removeMilestoneTime}min - ${removedMilestone.reward} by ${interaction.user.tag}.`);
                        
                        await interaction.editReply({
                            embeds: [new discord.EmbedBuilder()
                                .setTitle('Milestone Removed')
                                .setDescription(`Removed milestone: **${removedMilestone.reward}** (${removeMilestoneTime} minutes).`)
                                .setColor('#FF0000')],
                            components: []
                        });
                        break;
                }
            } catch (error) {
                console.error('Error handling modal submit:', error);
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: 'There was an error processing your request!', ephemeral: true });
                } else if (interaction.deferred) {
                    await interaction.editReply({ content: 'There was an error processing your request!' });
                }
            }
        }
    }
});

// Handle messages and commands
client.on('guildMemberAdd', async (member) => {
    if (!typedConfig.welcomeEnabled) return;

    const welcomeChannelId = typedConfig.welcomeChannelId;
    if (!welcomeChannelId) return;

    const channel = await client.channels.fetch(welcomeChannelId);
    if (!channel || !channel.isTextBased()) return;

    if (!channel || !('send' in channel) || !channel.isTextBased()) return;

    const welcomeMessage = `Welcome to the server, ${member.user.username}!`;
    channel.send(welcomeMessage);
});
client.on('messageCreate', async (message) => {
    const { content, author, channel } = message;
    if (author.bot) return;

    // Get the chat channel ID from configured servers
    const chatChannelIds: string[] = [];
    
    // Add server chat channels
    if (typedConfig.servers) {
        typedConfig.servers.forEach(serverConfig => {
            if (serverConfig.logChannels && serverConfig.logChannels.chat && serverConfig.logChannels.chat !== "YOUR_CHANNEL_ID_HERE") {
                chatChannelIds.push(serverConfig.logChannels.chat);
            }
        });
    }

    if (chatChannelIds.includes(channel.id)) {
        // Relaying messages from Discord to Minecraft
        log(`Relaying Discord message from ${author.username}: ${content}`);
        server.relayMessageFromDiscordToMinecraft(message);
        return;
    }

    // Whitelist commands (if needed)
    if (content.startsWith('/whitelist')) {
        if (!typedConfig.admins.includes(author.id)) {
            message.reply('You do not have permission to use this command.');
            return;
        }

        const args = content.split(' ').slice(1);
        const command = args[0];
        const username = args[1];

        if (!['add', 'remove'].includes(command)) {
            message.reply('Usage: `/whitelist add <username>` or `/whitelist remove <username>`');
            return;
        }

        if (command === 'add') {
            if (!username) {
                message.reply('Please specify a username to add!');
                return;
            }
            if (!typedConfig.whitelist.includes(username)) {
                typedConfig.whitelist.push(username);
                fs.writeFileSync('./config.json', JSON.stringify(typedConfig, null, 2));
                message.reply(`\`${username}\` added to the whitelist.`);
            } else {
                message.reply(`\`${username}\` is already in the whitelist.`);
            }
        } else if (command === 'remove') {
            if (!username) {
                message.reply('Please specify a username to remove!');
                return;
            }
            if (typedConfig.whitelist.includes(username)) {
                typedConfig.whitelist = typedConfig.whitelist.filter((u: string) => u !== username);
                fs.writeFileSync('./config.json', JSON.stringify(typedConfig, null, 2));
                message.reply(`\`${username}\` removed from the whitelist.`);
            } else {
                message.reply(`\`${username}\` is not in the whitelist.`);
            }
        }
        return;
    }
});

// Handle graceful shutdown to save playtime data
process.on('SIGINT', () => {
    log('Received SIGINT, saving playtime data...');
    savePlaytimeOnShutdown();
    process.exit(0);
});

process.on('SIGTERM', () => {
    log('Received SIGTERM, saving playtime data...');
    savePlaytimeOnShutdown();
    process.exit(0);
});

process.on('beforeExit', () => {
    log('Process exiting, saving playtime data...');
    savePlaytimeOnShutdown();
});

// Function to save all active player sessions
function savePlaytimeOnShutdown() {
    if (typedConfig.playerStats) {
        const currentTime = Date.now();
        let savedSessions = 0;
        
        for (const [username, stats] of Object.entries(typedConfig.playerStats)) {
            if (stats.sessionStart) {
                const sessionTime = currentTime - stats.sessionStart;
                stats.totalPlaytime += sessionTime;
                stats.lastSeen = currentTime;
                stats.sessionStart = undefined; // Clear session start
                savedSessions++;
            }
        }
        
        if (savedSessions > 0) {
            fs.writeFileSync('./config.json', JSON.stringify(typedConfig, null, 2));
            log(`Saved playtime data for ${savedSessions} active players`);
        }
    }
}

client.login(typedConfig.botToken);

// Auto-updater is automatically initialized when imported

export { client, log, sendEmbed };
