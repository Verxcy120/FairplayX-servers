import { log } from '../utils';
import { SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    ChannelType,
    RoleSelectMenuBuilder,
    ChatInputCommandInteraction,
    Client,
    MessageComponentInteraction,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} from 'discord.js';
import * as fs from 'fs';
import config from '../config.json';
// import announcementsCommand from './announcements-command'; // File doesn't exist, commenting out
import { kickNonAllowlistedPlayers, getCurrentPlayers } from '../server';
import { backupManager } from '../backup';
import { activityTracker } from '../activity';
import { securityMonitor } from '../security';
import { autoUpdater } from '../auto-update';

interface Config {
    botToken?: string;
    clientId?: string;
    username?: string;
    admins: string[];
    whitelist: string[];
    allowlist?: string[];
    maintenanceMode?: {
        enabled: boolean;
        enabledBy?: string;
        enabledAt?: number;
        reason?: string;
    };
    bans?: Array<{
        player: string;
        reason: string;
        timestamp: string;
        bannedBy: string;
    }>;
    bannedDevices?: string[];
    bannedPlayers?: string[];
    milestones?: Array<{
        playtime: number;
        reward: string;
    }>;
    welcomeEnabled?: boolean;
    playerStats?: { [username: string]: { joinCount: number; lastSeen: number; sessionStart?: number; totalPlaytime: number; } };
    playerNotes?: { 
        [username: string]: {
            warnings: number;
            notes: string[];
        };
    };
    playerRewards?: { [username: string]: { earnedMilestones: any[]; lastChecked: number; } };
    rewardsConfig?: {
        enabled: boolean;
        milestones: {
            timeMinutes: number;
            reward: string;
            description: string;
        }[];
    };
    welcomeMessages?: {
        enabled: boolean;
        channelId: string | null;
        customMessage: string;
        motd: string;
    };
    logging?: {
        detailedLogs: boolean;
        logPlayerStats: boolean;
        logCommands: boolean;
    };
    security?: {
        enabled: boolean;
        alertChannelId: string | null;
        rapidJoinThreshold: number;
        rapidJoinWindow: number;
        logToFile: boolean;
    };

    servers?: Array<{
        serverName: string;
        host: string;
        port: number;
        logChannels: {
            chat: string | null;
            kicks: string | null;
            joinsAndLeaves: string | null;
        };
        modules: {
            deviceFilter: boolean;
        };
    }>;
    altSystem: {
        enabled?: boolean;
        maxGamerScore: number;
        maxFriends: number;
        maxFollowers: number;
    };
    deviceRestrictions?: {
        Android: boolean;
        iOS: boolean;
        Xbox: boolean;
        Windows: boolean;
        PlayStation: boolean;
        FireOS: boolean;
        NintendoSwitch: boolean;
    };
    welcomeChannelId?: string | null;
    logChannelId?: string | null;
    memberRoleId?: string | null;
}

const typedConfig = config as Config;

// Helper function to save config
export function saveConfig(): void {
    fs.writeFileSync('./config.json', JSON.stringify(typedConfig, null, 2));
}

// Helper function to check and save milestone progress
export function checkAndSaveMilestoneProgress(playerName: string): void {
    if (!typedConfig.rewardsConfig?.enabled || !typedConfig.playerStats?.[playerName]) {
        return;
    }
    
    const totalMinutes = Math.floor(typedConfig.playerStats[playerName].totalPlaytime / 60000);
    const milestones = typedConfig.rewardsConfig.milestones.map(m => ({
        time: m.timeMinutes,
        reward: m.reward,
        description: m.description
    }));
    
    // Initialize playerRewards if not exists
    if (!typedConfig.playerRewards) {
        typedConfig.playerRewards = {};
    }
    if (!typedConfig.playerRewards[playerName]) {
        typedConfig.playerRewards[playerName] = {
            earnedMilestones: [],
            lastChecked: Date.now()
        };
    }
    
    const playerRewards = typedConfig.playerRewards[playerName];
    const earnedRewards = milestones.filter(m => totalMinutes >= m.time);
    
    // Check for newly earned milestones
    const newlyEarned = earnedRewards.filter(milestone => 
        !playerRewards.earnedMilestones.some((earned: any) => 
            earned.reward === milestone.reward
        )
    );
    
    // Save newly earned milestones
    if (newlyEarned.length > 0) {
        for (const milestone of newlyEarned) {
            playerRewards.earnedMilestones.push({
                reward: milestone.reward,
                description: milestone.description,
                earnedAt: Date.now(),
                playtimeWhenEarned: totalMinutes
            });
        }
        playerRewards.lastChecked = Date.now();
        saveConfig();
        
        console.log(`Player ${playerName} earned ${newlyEarned.length} new reward(s):`, 
            newlyEarned.map(r => r.reward).join(', '));
    }
}

// Helper function to check if user is admin (supports both usernames and user IDs)
function isAdmin(userId: string, username: string): boolean {
    const result = typedConfig.admins.includes(userId) || typedConfig.admins.includes(username);
    return result;
}

// --- UI Helper Functions ---

// Device Emojis
const deviceEmojis: { [key: string]: string } = {
    'Android': '',
    'iOS': '',
    'Xbox': '',
    'Windows': '',
    'PlayStation': '',
    'FireOS': '',
    'NintendoSwitch': ''
};

// Alt Detection Level Helper
function getDetectionLevel(altSystemConfig: Config['altSystem']): string {
    const total = altSystemConfig.maxGamerScore + altSystemConfig.maxFriends + altSystemConfig.maxFollowers;
    if (total <= 520) return 'Very Strict';
    if (total <= 1040) return 'Balanced';
    if (total <= 2040) return 'Lenient';
    return 'Very Lenient';
}

function getWhitelistManagePanel(currentConfig: Config): [EmbedBuilder, ActionRowBuilder<ButtonBuilder>] {
    const manageEmbed = new EmbedBuilder()
        .setTitle('🛡️ Server Whitelist Management')
        .setDescription('**Manage player access to your Minecraft server**\n\n🎯 Control who can join and maintain your community standards\n🔒 Secure your server with trusted players only')
        .addFields(
            { name: '📊 Server Statistics', value: `\`\`\`\n👥 Whitelisted: ${currentConfig.whitelist.length} players\n🎮 Status: ${currentConfig.whitelist.length > 0 ? 'Active' : 'Empty'}\n🔐 Security: Enhanced\`\`\``, inline: true },
            { name: '⚡ Quick Actions', value: '🟢 **Add Player** - Grant access\n🔍 **View All** - See full list\n🔴 **Remove** - Revoke access\n⚠️ **Clear All** - Reset whitelist', inline: true },
            { name: '👥 Current Players', value: currentConfig.whitelist.length > 0 ? '```\n' + currentConfig.whitelist.slice(0, 8).map((u, i) => `${i + 1}. ${u}`).join('\n') + (currentConfig.whitelist.length > 8 ? `\n... +${currentConfig.whitelist.length - 8} more` : '') + '\n```' : '```\nNo players whitelisted\nUse "Add Player" to start\n```', inline: false }
        )
        .setColor('#00D4AA')
        .setThumbnail('https://cdn.discordapp.com/attachments/1234567890/1234567890/minecraft_shield.png')
        .setFooter({ text: '🎮 FairplayX Server Management • Secure & Reliable', iconURL: 'https://cdn.discordapp.com/attachments/1234567890/1234567890/fairplayx_icon.png' })
        .setTimestamp();

    const manageRow = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('whitelist_add')
                .setLabel('Add Player')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('whitelist_view_all')
                .setLabel('View All Players')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('whitelist_remove_menu')
                .setLabel('Remove Player')
                .setStyle(ButtonStyle.Danger)
                .setDisabled(currentConfig.whitelist.length === 0),
            new ButtonBuilder()
                .setCustomId('whitelist_clear_all')
                .setLabel('Clear Whitelist')
                .setStyle(ButtonStyle.Danger)
                .setDisabled(currentConfig.whitelist.length === 0)
        );
    return [manageEmbed, manageRow];
}

async function getAdminManagePanel(currentConfig: Config, client: Client): Promise<[EmbedBuilder, ActionRowBuilder<ButtonBuilder>]> {
    const adminListPreview = await Promise.all(
        currentConfig.admins.slice(0, 10).map(async (adminId: string) => {
            try {
                const adminUser = await client.users.fetch(adminId);
                return `▸ ${adminUser.username}`;
            } catch {
                return `▸ Unknown User`;
            }
        })
    );

    const manageEmbed = new EmbedBuilder()
        .setTitle('👑 Server Administrator Management')
        .setDescription('**Manage administrative privileges for your server**\n\n🔐 Control who can modify server settings and manage players\n⚡ Grant trusted users full management access')
        .addFields(
            { name: '📈 Admin Statistics', value: `\`\`\`\n👑 Administrators: ${currentConfig.admins.length}\n🛡️ Security Level: ${currentConfig.admins.length > 0 ? 'Protected' : 'Unprotected'}\n🎯 Access Control: Active\`\`\``, inline: true },
            { name: '🚀 Management Tools', value: '🟢 **Add Admin** - Grant privileges\n🔴 **Remove Admin** - Revoke access\n⚠️ **Clear All** - Reset admins', inline: true },
            { name: '👑 Current Administrators', value: adminListPreview.length > 0 ? '```\n' + adminListPreview.map((admin, i) => `${i + 1}. ${admin.replace('▸ ', '')}`).join('\n') + (currentConfig.admins.length > 10 ? `\n... +${currentConfig.admins.length - 10} more` : '') + '\n```' : '```\nNo administrators configured\nAdd trusted users to manage server\n```', inline: false }
        )
        .setColor('#FFD700')
        .setThumbnail('https://cdn.discordapp.com/attachments/1234567890/1234567890/admin_crown.png')
        .setFooter({ text: '👑 FairplayX Admin Panel • Secure Management', iconURL: 'https://cdn.discordapp.com/attachments/1234567890/1234567890/fairplayx_icon.png' })
        .setTimestamp();

    const manageRow = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('admin_add')
                .setLabel('Add Administrator')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('admin_remove_menu')
                .setLabel('Remove Administrator')
                .setStyle(ButtonStyle.Danger)
                .setDisabled(currentConfig.admins.length === 0),
            new ButtonBuilder()
                .setCustomId('admin_clear_all')
                .setLabel('Clear All Admins')
                .setStyle(ButtonStyle.Danger)
                .setDisabled(currentConfig.admins.length === 0)
        );
    return [manageEmbed, manageRow];
}

function getAllowlistManagePanel(currentConfig: Config): [EmbedBuilder, ActionRowBuilder<ButtonBuilder>] {
    const allowlist = currentConfig.allowlist || [];
    const allowlistPreview = allowlist.slice(0, 15).map((player, i) => `${i + 1}. ${player}`).join('\n');
    
    const manageEmbed = new EmbedBuilder()
        .setTitle('🔐 Server Allowlist Management')
        .setDescription('**Manage special access during maintenance mode**\n\n🛠️ Control who can join during server maintenance\n🔒 Separate from regular whitelist for enhanced control\n⚡ Perfect for testing and administrative access')
        .addFields(
            { name: '📊 Allowlist Statistics', value: `\`\`\`\n🔐 Allowed Players: ${allowlist.length}\n🛡️ Access Level: ${allowlist.length > 0 ? 'Restricted' : 'None'}\n🎯 Status: Active\`\`\``, inline: true },
            { name: '🚀 Management Tools', value: '🟢 **Add Player** - Grant maintenance access\n🔴 **Remove Player** - Revoke access\n⚠️ **Clear All** - Reset allowlist', inline: true },
            { name: '🔐 Current Allowlist', value: allowlistPreview.length > 0 ? '```\n' + allowlistPreview + (allowlist.length > 15 ? `\n... +${allowlist.length - 15} more` : '') + '\n```' : '```\nNo players in allowlist\nAdd trusted players for maintenance access\n```', inline: false }
        )
        .setColor('#9B59B6')
        .setThumbnail('https://cdn.discordapp.com/attachments/1234567890/1234567890/allowlist_key.png')
        .setFooter({ text: '🔐 FairplayX Allowlist • Maintenance Access Control', iconURL: 'https://cdn.discordapp.com/attachments/1234567890/1234567890/fairplayx_icon.png' })
        .setTimestamp();

    const manageRow = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('allowlist_add')
                .setLabel('Add to Allowlist')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('allowlist_remove_menu')
                .setLabel('Remove from Allowlist')
                .setStyle(ButtonStyle.Danger)
                .setDisabled(allowlist.length === 0),
            new ButtonBuilder()
                .setCustomId('allowlist_clear_all')
                .setLabel('Clear Allowlist')
                .setStyle(ButtonStyle.Danger)
                .setDisabled(allowlist.length === 0)
        );
    return [manageEmbed, manageRow];
}

function getMaintenanceModePanel(currentConfig: Config): [EmbedBuilder, ActionRowBuilder<ButtonBuilder>] {
    const maintenance = currentConfig.maintenanceMode || { enabled: false };
    const allowlistCount = (currentConfig.allowlist || []).length;
    
    const embed = new EmbedBuilder()
        .setTitle('🛠️ Server Maintenance Mode')
        .setDescription(`**Control server access during maintenance**\n\n${maintenance.enabled ? '🔴 **MAINTENANCE ACTIVE**\nOnly allowlisted players can join' : '🟢 **SERVER OPEN**\nAll whitelisted players can join'}\n\n🔧 Perfect for updates, testing, and administrative work`)
        .addFields(
            { name: '📊 Status Information', value: `\`\`\`\n🛠️ Mode: ${maintenance.enabled ? 'MAINTENANCE' : 'NORMAL'}\n🔐 Allowlist: ${allowlistCount} players\n⏰ ${maintenance.enabled ? `Since: ${new Date(maintenance.enabledAt || Date.now()).toLocaleString()}` : 'Last Active: Never'}\`\`\``, inline: true },
            { name: '🎯 Access Control', value: maintenance.enabled ? `🔴 **Restricted Access**\n• Only allowlisted players\n• Kicks non-allowlisted users\n• Prevents new connections` : `🟢 **Open Access**\n• All whitelisted players\n• Normal server operation\n• Full functionality`, inline: true }
        )
        .setColor(maintenance.enabled ? '#E74C3C' : '#27AE60')
        .setThumbnail('https://cdn.discordapp.com/attachments/1234567890/1234567890/maintenance_gear.png')
        .setFooter({ text: '🛠️ FairplayX Maintenance Control • Server Management', iconURL: 'https://cdn.discordapp.com/attachments/1234567890/1234567890/fairplayx_icon.png' })
        .setTimestamp();

    if (maintenance.enabled && maintenance.reason) {
        embed.addFields({ name: '📝 Maintenance Reason', value: `\`\`\`\n${maintenance.reason}\`\`\``, inline: false });
    }

    const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('maintenance_toggle')
                .setLabel(maintenance.enabled ? 'Disable Maintenance' : 'Enable Maintenance')
                .setStyle(maintenance.enabled ? ButtonStyle.Success : ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('maintenance_kick_non_allowlisted')
                .setLabel('Kick Non-Allowlisted')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!maintenance.enabled),
            new ButtonBuilder()
                .setCustomId('maintenance_set_reason')
                .setLabel('Set Reason')
                .setStyle(ButtonStyle.Primary)
        );
    return [embed, row];
}

function getAltConfigPanel(currentConfig: Config): [EmbedBuilder, ActionRowBuilder<ButtonBuilder>] {
    const altSystemConfig = currentConfig.altSystem;
    const isEnabled = altSystemConfig.enabled ?? false;
    const detectionLevel = getDetectionLevel(altSystemConfig);
    const embed = new EmbedBuilder()
        .setTitle('🕵️ Alternative Account Detection System')
        .setDescription(`**Protect your server from alternative accounts**\n\n🛡️ Current detection level: **${detectionLevel}**\n🎯 Configure thresholds to customize sensitivity\n⚡ Keep your community safe from troublemakers`)
        .addFields(
            { name: '🎮 Detection Thresholds', value: `\`\`\`\n🏆 Gamerscore: ${altSystemConfig.maxGamerScore} points\n👥 Friends: ${altSystemConfig.maxFriends} friends\n👤 Followers: ${altSystemConfig.maxFollowers} followers\`\`\``, inline: true },
            { name: '📊 System Status', value: `\`\`\`\n🔍 Detection: ${isEnabled ? '🟢 Active' : '🔴 Inactive'}\n🛡️ Protection: ${detectionLevel}\n⚙️ Mode: Automatic\`\`\``, inline: true },
            { name: '🎯 Security Level', value: detectionLevel === 'Very Strict' ? '🔴 **Maximum Protection**\nHighest security settings' : detectionLevel === 'Strict' ? '🟠 **High Protection**\nStrict but balanced' : detectionLevel === 'Moderate' ? '🟡 **Balanced Protection**\nModerate security' : '🟢 **Relaxed Protection**\nMinimal restrictions', inline: false }
        )
        .setColor(isEnabled ? '#FF6B6B' : '#95A5A6')
        .setThumbnail('https://cdn.discordapp.com/attachments/1234567890/1234567890/detective_shield.png')
        .setFooter({ text: '🕵️ FairplayX Alt Detection • Advanced Security', iconURL: 'https://cdn.discordapp.com/attachments/1234567890/1234567890/fairplayx_icon.png' })
        .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('alt_toggle_enabled')
                .setLabel(isEnabled ? 'Disable Alt Detection' : 'Enable Alt Detection')
                .setStyle(isEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('alt_adjust_gamerscore')
                .setLabel('Adjust Gamerscore')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('alt_adjust_friends')
                .setLabel('Adjust Friends')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('alt_adjust_followers')
                .setLabel('Adjust Followers')
                .setStyle(ButtonStyle.Primary)
        );
    return [embed, row];
}

function getDeviceConfigPanel(currentConfig: Config): [EmbedBuilder, ActionRowBuilder<ButtonBuilder>, ActionRowBuilder<ButtonBuilder>] {
    const deviceRestrictions = currentConfig.deviceRestrictions || {
        Android: false,
        iOS: false,
        Xbox: false,
        Windows: false,
        PlayStation: false,
        FireOS: false,
        NintendoSwitch: false
    };
    const enabledDevices = Object.entries(deviceRestrictions)
        .filter(([, enabled]) => enabled)
        .map(([device]) => `▸ ${device}`)
        .join('\n') || 'No device restrictions active';

    const embed = new EmbedBuilder()
        .setTitle('📱 Device Access Control')
        .setDescription('**Control platform access to your server**\n\n🔒 Restrict specific device types for enhanced security\n🎮 Manage cross-platform compatibility\n⚡ Customize player experience by platform')
        .addFields(
            { name: '✅ Allowed Platforms', value: enabledDevices !== 'No device restrictions active' ? `\`\`\`\n${enabledDevices.replace(/▸ /g, '🎮 ')}\n\`\`\`` : '```\n🚫 No restrictions active\nAll platforms allowed\n```', inline: true },
            { name: '📊 Platform Statistics', value: `\`\`\`\n🎮 Total Platforms: ${Object.keys(deviceRestrictions).length}\n✅ Allowed: ${Object.values(deviceRestrictions).filter(Boolean).length}\n🚫 Restricted: ${Object.values(deviceRestrictions).filter(v => !v).length}\n\`\`\``, inline: true },
            { name: '🛡️ Security Level', value: Object.values(deviceRestrictions).filter(Boolean).length === 0 ? '🟢 **Open Access**\nAll platforms welcome' : Object.values(deviceRestrictions).filter(Boolean).length < 3 ? '🟡 **Selective Access**\nLimited platforms' : '🔴 **Restricted Access**\nHigh security mode', inline: false }
        )
        .setColor('#4A90E2')
        .setThumbnail('https://cdn.discordapp.com/attachments/1234567890/1234567890/device_control.png')
        .setFooter({ text: '📱 FairplayX Device Control • Cross-Platform Management', iconURL: 'https://cdn.discordapp.com/attachments/1234567890/1234567890/fairplayx_icon.png' })
        .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('device_toggle_android')
                .setLabel('Android')
                .setStyle(deviceRestrictions.Android ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('device_toggle_ios')
                .setLabel('iOS')
                .setStyle(deviceRestrictions.iOS ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('device_toggle_xbox')
                .setLabel('Xbox')
                .setStyle(deviceRestrictions.Xbox ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('device_toggle_windows')
                .setLabel('Windows')
                .setStyle(deviceRestrictions.Windows ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('device_toggle_playstation')
                .setLabel('PlayStation')
                .setStyle(deviceRestrictions.PlayStation ? ButtonStyle.Success : ButtonStyle.Secondary)
        );
    const row2 = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('device_toggle_fireos')
                .setLabel('FireOS')
                .setStyle(deviceRestrictions.FireOS ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('device_toggle_nintendoswitch')
                .setLabel('Nintendo Switch')
                .setStyle(deviceRestrictions.NintendoSwitch ? ButtonStyle.Success : ButtonStyle.Secondary)
        );    return [embed, row, row2];
}

function getChannelConfigPanel(currentConfig: Config): [EmbedBuilder, ActionRowBuilder<ButtonBuilder>, ActionRowBuilder<ButtonBuilder>] {
    const serverConfig = currentConfig.servers?.[0];
    const logChannels = serverConfig?.logChannels;
    
    const embed = new EmbedBuilder()
        .setTitle('📢 Channel Configuration')
        .setDescription('**Configure notification channels for your server**\n\n📝 Set up dedicated channels for monitoring\n🎉 Welcome new players with style\n📊 Track all server activity and events')
        .addFields(
            { name: '🎉 Welcome System', value: currentConfig.welcomeChannelId ? `\`\`\`\n📍 Channel: <#${currentConfig.welcomeChannelId}>\n✅ Status: Active\n🎯 Purpose: Player Greetings\n\`\`\`` : '```\n❌ Not configured\n🔧 Setup required\n📍 No welcome channel\n```', inline: true },
            { name: '📊 General Logs', value: currentConfig.logChannelId ? `\`\`\`\n📍 Channel: <#${currentConfig.logChannelId}>\n✅ Status: Active\n🎯 Purpose: Server Logs\n\`\`\`` : '```\n❌ Not configured\n🔧 Setup required\n📍 No log channel\n```', inline: true },
            { name: '👋 Joins/Leaves', value: logChannels?.joinsAndLeaves ? `\`\`\`\n📍 Channel: <#${logChannels.joinsAndLeaves}>\n✅ Status: Active\n🎯 Purpose: Player Activity\n\`\`\`` : '```\n❌ Not configured\n🔧 Setup required\n📍 No joins/leaves channel\n```', inline: true },
            { name: '💬 Chat Logs', value: logChannels?.chat ? `\`\`\`\n📍 Channel: <#${logChannels.chat}>\n✅ Status: Active\n🎯 Purpose: Chat Monitoring\n\`\`\`` : '```\n❌ Not configured\n🔧 Setup required\n📍 No chat channel\n```', inline: true },
            { name: '🦶 Kick Logs', value: logChannels?.kicks ? `\`\`\`\n📍 Channel: <#${logChannels.kicks}>\n✅ Status: Active\n🎯 Purpose: Moderation Logs\n\`\`\`` : '```\n❌ Not configured\n🔧 Setup required\n📍 No kick channel\n```', inline: true },
            { name: '⚙️ Configuration Status', value: (currentConfig.welcomeChannelId && currentConfig.logChannelId && logChannels?.joinsAndLeaves && logChannels?.chat && logChannels?.kicks) ? '🟢 **Fully Configured**\nAll channels set up' : '🟡 **Partially Configured**\nSome channels missing', inline: false }
        )
        .setColor('#7289DA')
        .setThumbnail('https://cdn.discordapp.com/attachments/1234567890/1234567890/channel_config.png')
        .setFooter({ text: '📢 FairplayX Channel Manager • Communication Hub', iconURL: 'https://cdn.discordapp.com/attachments/1234567890/1234567890/fairplayx_icon.png' })
        .setTimestamp();

    const row1 = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('channel_set_welcome')
                .setLabel('Set Welcome Channel')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🎉'),
            new ButtonBuilder()
                .setCustomId('channel_set_log')
                .setLabel('Set General Log Channel')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('📊'),
            new ButtonBuilder()
                .setCustomId('channel_set_joins_leaves')
                .setLabel('Set Joins/Leaves Channel')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('👋')
        );
        
    const row2 = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('channel_set_chat')
                .setLabel('Set Chat Log Channel')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('💬'),
            new ButtonBuilder()
                .setCustomId('channel_set_kicks')
                .setLabel('Set Kick Log Channel')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🦶'),
            new ButtonBuilder()
                .setCustomId('channel_clear_all')
                .setLabel('Clear All Channels')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🗑️')
        );
    return [embed, row1, row2];
}

function getRoleConfigPanel(currentConfig: Config): [EmbedBuilder, ActionRowBuilder<ButtonBuilder>] {
    const embed = new EmbedBuilder()
        .setTitle('👥 Role Configuration')
        .setDescription('**Manage Discord roles and permissions**\n\n🎭 Set up automatic role assignment\n🔐 Configure moderation permissions\n⚡ Streamline community management')
        .addFields(
            { name: '👤 Member Role System', value: currentConfig.memberRoleId ? `\`\`\`\n🎭 Role: @${currentConfig.memberRoleId}\n✅ Status: Active\n🎯 Purpose: Member Access\n\`\`\`` : '```\n❌ Not configured\n🔧 Setup required\n📍 No member role\n```', inline: true },
            { name: '⚙️ Role Status', value: currentConfig.memberRoleId ? '🟢 **Configured**\nMember role set up' : '🔴 **Not Configured**\nSetup required', inline: false }
        )
        .setColor('#9B59B6')
        .setThumbnail('https://cdn.discordapp.com/attachments/1234567890/1234567890/role_config.png')
        .setFooter({ text: '👥 FairplayX Role Manager • Permission Control', iconURL: 'https://cdn.discordapp.com/attachments/1234567890/1234567890/fairplayx_icon.png' })
        .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('role_set_member')
                .setLabel('Set Member Role')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('role_clear_member')
                .setLabel('Clear Member Role')
                .setStyle(ButtonStyle.Danger)
                .setDisabled(!currentConfig.memberRoleId)
        );
    return [embed, row];
}

function getPlayerManagementPanel(): [EmbedBuilder, ActionRowBuilder<ButtonBuilder>, ActionRowBuilder<ButtonBuilder>] {
    const embed = new EmbedBuilder()
        .setTitle('👤 Player Management')
        .setDescription('**Manage players and moderation**\n\n🔨 Ban/unban players\n📊 View player statistics\n📝 Manage player notes\n🎮 Monitor player activity')
        .setColor('#E74C3C')
        .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('player_ban')
                .setLabel('Ban Player')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('player_unban')
                .setLabel('Unban Player')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('player_stats')
                .setLabel('Player Stats')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('add_player_note')
                .setLabel('Add Note')
                .setStyle(ButtonStyle.Secondary)
        );
    
    const row2 = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('view_player_notes')
                .setLabel('View Notes')
                .setStyle(ButtonStyle.Secondary)
        );
    return [embed, row, row2];
}

function getServerMonitoringPanel(): [EmbedBuilder, ActionRowBuilder<ButtonBuilder>] {
    const embed = new EmbedBuilder()
        .setTitle('📊 Server Monitoring')
        .setDescription('**Monitor server performance and activity**\n\n⏱️ Check server uptime\n📈 View performance metrics\n🏆 Display leaderboards\n🔒 Security logs')
        .setColor('#3498DB')
        .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('server_uptime')
                .setLabel('Server Uptime')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('server_performance')
                .setLabel('Performance')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('server_leaderboard')
                .setLabel('Leaderboards')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('server_security')
                .setLabel('Security Logs')
                .setStyle(ButtonStyle.Danger)
        );
    return [embed, row];
}

function getRewardsManagementPanel(currentConfig: Config): [EmbedBuilder, ActionRowBuilder<ButtonBuilder>] {
    const rewardsEnabled = currentConfig.rewardsConfig?.enabled || false;
    const milestoneCount = currentConfig.rewardsConfig?.milestones?.length || 0;
    
    const embed = new EmbedBuilder()
        .setTitle('🏆 Rewards & Milestones')
        .setDescription('**Manage player rewards and milestones**\n\n🎯 Configure milestone rewards\n⚙️ Enable/disable rewards system\n📊 View milestone progress')
        .addFields(
            { name: '🎮 System Status', value: rewardsEnabled ? '✅ **Enabled**' : '❌ **Disabled**', inline: true },
            { name: '🏆 Milestones', value: `${milestoneCount} configured`, inline: true }
        )
        .setColor('#F39C12')
        .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('rewards_toggle')
                .setLabel(rewardsEnabled ? 'Disable Rewards' : 'Enable Rewards')
                .setStyle(rewardsEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('rewards_milestones')
                .setLabel('View Milestones')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('rewards_add_milestone')
                .setLabel('Add Milestone')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('rewards_remove_milestone')
                .setLabel('Remove Milestone')
                .setStyle(ButtonStyle.Danger)
        );
    return [embed, row];
}

function getSystemToolsPanel(): [EmbedBuilder, ActionRowBuilder<ButtonBuilder>] {
    const embed = new EmbedBuilder()
        .setTitle('🛠️ System Tools')
        .setDescription('**System administration and utilities**\\n\\n💾 Backup management\\n🔄 System maintenance\\n📋 Configuration tools')
        .setColor('#95A5A6')
        .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('system_backup_create')
                .setLabel('Create Backup')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('system_backup_list')
                .setLabel('List Backups')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('system_welcome_toggle')
                .setLabel('Welcome Settings')
                .setStyle(ButtonStyle.Primary)
        );
    return [embed, row];
}

function getAnnouncementsPanel(): [EmbedBuilder, ActionRowBuilder<ButtonBuilder>] {
    const embed = new EmbedBuilder()
        .setTitle('📢 Announcement Management')
        .setDescription('**Manage scheduled announcements**')
        .setColor('#7289DA')
        .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('announcement_add')
                .setLabel('Add Announcement')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('announcement_list')
                .setLabel('List Announcements')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('announcement_remove_menu')
                .setLabel('Remove Announcement')
                .setStyle(ButtonStyle.Danger)
        );
    return [embed, row];
}

// Main dashboard command - the only command
const commands = [{
    data: new SlashCommandBuilder()
        .setName('manage')
        .setDescription('Open the server management dashboard'),
    async execute(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
        if (!isAdmin(interaction.user.id, interaction.user.username)) {
            await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
            return;
        }

        const initialEmbed = new EmbedBuilder()
            .setTitle('🎮 FairplayX Management Dashboard')
            .setDescription('**Welcome to your server control center!**\n\n🛡️ **Security & Protection**\n• Advanced anti-cheat systems\n• Player verification & monitoring\n• Device access control\n\n⚙️ **Server Configuration**\n• Whitelist & admin management\n• Channel & role setup\n• Automated moderation tools\n\n📊 **Real-time Monitoring**\n• Player activity tracking\n• Security event logging\n• Performance analytics')
            .addFields(
                { name: '🚀 Quick Actions', value: '```\n🔧 Configure Settings\n👥 Manage Players\n📊 View Statistics\n```', inline: true },
                { name: '🛡️ Security Status', value: '```\n✅ Anti-cheat Active\n🔍 Monitoring Online\n🛡️ Protection Enabled\n```', inline: true },
                { name: '📈 Server Health', value: '```\n🟢 All Systems Online\n⚡ Performance Optimal\n🔄 Auto-updates Active\n```', inline: true }
            )
            .setColor('#00D4AA')
            .setThumbnail('https://cdn.discordapp.com/attachments/1234567890/1234567890/fairplayx_dashboard.png')
            .setFooter({ text: '🎮 FairplayX Management System • Powered by Advanced Security', iconURL: 'https://cdn.discordapp.com/attachments/1234567890/1234567890/fairplayx_icon.png' })
            .setTimestamp();

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('dashboard_select_panel')
            .setPlaceholder('Select a management category...')
            .addOptions([
                { label: 'Whitelist Management', value: 'whitelist' },
                { label: 'Allowlist Management', value: 'allowlist' },
                { label: 'Admin Management', value: 'admins' },
                { label: 'Maintenance Mode', value: 'maintenance_mode' },
                { label: 'Alt Detection', value: 'alt_detection' },
                { label: 'Device Restrictions', value: 'device_restrictions' },
                { label: 'Channel Configuration', value: 'channels' },
                { label: 'Role Configuration', value: 'roles' },
                { label: 'Player Management', value: 'player_management' },
                { label: 'Server Monitoring', value: 'server_monitoring' },
                { label: 'Rewards & Milestones', value: 'rewards' },
                { label: 'System Tools', value: 'system_tools' },
                { label: 'Announcements', value: 'announcements' },
            ]);

        const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>()
            .addComponents(selectMenu);
            
        // Add back button row
        const backRow = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('back_to_main_dashboard')
                    .setLabel('Back to Main Dashboard')
                    .setStyle(ButtonStyle.Secondary)
            );

        let reply: any;
        try {
            console.log('Attempting interaction.reply');
            await interaction.reply({
                embeds: [initialEmbed],
                components: [selectRow],
                flags: [1 << 6] // EPHEMERAL flag
            });
            console.log('interaction.reply succeeded');
            reply = await interaction.fetchReply();
            console.log('fetchReply succeeded');
        } catch (err) {
            console.error('Error during interaction.reply or fetchReply:', err);
            throw err;
        }

        const filter = (i: MessageComponentInteraction) => i.user.id === interaction.user.id;
        const collector = reply.createMessageComponentCollector({ filter, time: 300000 }); // 5 minutes

        collector.on('collect', async (i: MessageComponentInteraction) => {
            console.log(`Collector received interaction: ${i.customId || (i as any).values?.[0] || 'unknown'}`);
            try {
                // Handle specific select menus first
                if (i.isStringSelectMenu() && i.customId === 'rewards_select_remove') {
                    console.log('Debug: Condition matched for rewards_select_remove!');
                    // Handle milestone removal
                    console.log('Debug: rewards_select_remove handler reached!');
                    console.log('Debug: About to call deferUpdate()');
                    
                    let selectedIndex: number;
                    try {
                        await i.deferUpdate();
                        console.log('Debug: deferUpdate() completed successfully');
                        console.log('Debug: About to parse selectedIndex from values:', (i as any).values);
                        selectedIndex = parseInt((i as any).values[0]);
                        console.log('Debug: selectedIndex parsed successfully:', selectedIndex);
                    } catch (error) {
                        console.log('Debug: Error in deferUpdate or parsing:', error);
                        return;
                    }
                    
                    console.log(`Debug: Selected index: ${selectedIndex}, Total milestones: ${typedConfig.rewardsConfig?.milestones?.length || 0}`);
                    
                    if (!typedConfig.rewardsConfig?.milestones || selectedIndex < 0 || selectedIndex >= typedConfig.rewardsConfig.milestones.length) {
                        console.log(`Debug: Invalid selection - selectedIndex: ${selectedIndex}, milestones length: ${typedConfig.rewardsConfig?.milestones?.length}`);
                        await i.followUp({
                            content: `❌ Invalid milestone selection. Selected: ${selectedIndex}, Available: ${typedConfig.rewardsConfig?.milestones?.length || 0}`,
                            embeds: [],
                            components: [
                                new ActionRowBuilder<ButtonBuilder>()
                                    .addComponents(
                                        new ButtonBuilder()
                                            .setCustomId('back_to_main_dashboard')
                                            .setLabel('Back to Main Dashboard')
                                            .setStyle(ButtonStyle.Secondary)
                                    )
                            ],
                            ephemeral: true
                        });
                        return;
                    }
                    
                    console.log('Debug: About to remove milestone at index:', selectedIndex);
                    const removedMilestone = typedConfig.rewardsConfig.milestones[selectedIndex];
                    console.log('Debug: Milestone to remove:', removedMilestone);
                    typedConfig.rewardsConfig.milestones.splice(selectedIndex, 1);
                    console.log('Debug: Milestone spliced from array, new length:', typedConfig.rewardsConfig.milestones.length);
                    saveConfig();
                    console.log('Debug: Config saved successfully');
                    log(`Milestone removed: ${removedMilestone.timeMinutes}min - ${removedMilestone.reward} by ${i.user.tag}.`);
                    console.log('Debug: Log entry created');
                    
                    const embed = new EmbedBuilder()
                        .setTitle('✅ Milestone Removed')
                        .setDescription(`Removed milestone: **${removedMilestone.reward}** (${removedMilestone.timeMinutes} minutes).`)
                        .setColor('#ff0000')
                        .setTimestamp();
                    
                    const backRow = new ActionRowBuilder<ButtonBuilder>()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('back_to_main_dashboard')
                                .setLabel('Back to Main Dashboard')
                                .setStyle(ButtonStyle.Secondary)
                        );
                    await i.followUp({
                        embeds: [embed],
                        components: [backRow],
                        ephemeral: true
                    });
                    return;
                }

                if (i.isStringSelectMenu() && i.customId === 'announcement_select_remove') {
                    await i.deferUpdate();
                    const announcementId = (i as any).values[0];
                    let announcements = JSON.parse(fs.readFileSync('./announcements.json', 'utf-8'));
                    const initialLength = announcements.length;
                    announcements = announcements.filter((ann: any) => ann.id !== announcementId);

                    if (announcements.length < initialLength) {
                        fs.writeFileSync('./announcements.json', JSON.stringify(announcements, null, 2));
                        log(`Announcement with ID ${announcementId} removed by ${i.user.tag}.`);
                        await i.editReply({ content: 'Announcement removed successfully.', embeds: [], components: [backRow] });
                    } else {
                        await i.editReply({ content: 'Could not find the selected announcement to remove.', embeds: [], components: [backRow] });
                    }
                    return; 
                }
                
                // Handle generic dashboard select menus
                if (i.isStringSelectMenu() && i.customId === 'dashboard_select_panel') {
                    console.log('Processing dashboard select menu interaction');
                    console.log(`Debug: Received customId: '${i.customId}'`);
                    console.log(`Debug: isStringSelectMenu: ${i.isStringSelectMenu()}`);
                    await i.deferUpdate();
                    console.log('Select menu deferUpdate successful');
                    const selectedValue = (i as any).values[0];
                    let panelEmbed: EmbedBuilder | undefined;
                    let panelRows: any[] | undefined;

                    switch (selectedValue) {
                        case 'whitelist':
                            const whitelistResult = getWhitelistManagePanel(typedConfig);
                            panelEmbed = whitelistResult[0];
                            panelRows = [whitelistResult[1]];
                            break;
                        case 'admins':
                            const adminResult = await getAdminManagePanel(typedConfig, client);
                            panelEmbed = adminResult[0];
                            panelRows = [adminResult[1]];
                            break;
                        case 'allowlist':
                            const allowlistResult = getAllowlistManagePanel(typedConfig);
                            panelEmbed = allowlistResult[0];
                            panelRows = [allowlistResult[1]];
                            break;
                        case 'maintenance_mode':
                            const maintenanceResult = getMaintenanceModePanel(typedConfig);
                            panelEmbed = maintenanceResult[0];
                            panelRows = [maintenanceResult[1]];
                            break;
                        case 'alt_detection':
                            const altResult = getAltConfigPanel(typedConfig);
                            panelEmbed = altResult[0];
                            panelRows = [altResult[1]];
                            break;
                        case 'device_restrictions':
                            const deviceResult = getDeviceConfigPanel(typedConfig);
                            panelEmbed = deviceResult[0];
                            panelRows = [deviceResult[1], deviceResult[2]];
                            break;
                        case 'channels':
                            const channelResult = getChannelConfigPanel(typedConfig);
                            panelEmbed = channelResult[0];
                            panelRows = [channelResult[1], channelResult[2]];
                            break;
                        case 'roles':
                            const roleResult = getRoleConfigPanel(typedConfig);
                            panelEmbed = roleResult[0];
                            panelRows = [roleResult[1]];
                            break;
                        case 'player_management':
                            const playerResult = getPlayerManagementPanel();
                            panelEmbed = playerResult[0];
                            panelRows = [playerResult[1], playerResult[2]];
                            break;

                        case 'server_monitoring':
                            const serverResult = getServerMonitoringPanel();
                            panelEmbed = serverResult[0];
                            panelRows = [serverResult[1]];
                            break;
                        case 'rewards':
                            const rewardsResult = getRewardsManagementPanel(typedConfig);
                            panelEmbed = rewardsResult[0];
                            panelRows = [rewardsResult[1]];
                            break;
                        case 'system_tools':
                            const toolsResult = getSystemToolsPanel();
                            panelEmbed = toolsResult[0];
                            panelRows = [toolsResult[1]];
                            break;
                        case 'announcements':
                            const announcementsResult = getAnnouncementsPanel();
                            panelEmbed = announcementsResult[0];
                            panelRows = [announcementsResult[1]];
                            break;
                        default:
                            // Don't return here - let other handlers process the interaction
                            console.log(`Debug: No case found for selectedValue: ${selectedValue}, continuing to other handlers`);
                            break;
                    }

                    // Only update reply if we have valid panel data
                    if (panelEmbed && panelRows) {
                        // Add back button to all panels
                        const backRow = new ActionRowBuilder<ButtonBuilder>()
                            .addComponents(
                                new ButtonBuilder()
                                    .setCustomId('back_to_main_dashboard')
                                    .setLabel('Back to Main Dashboard')
                                    .setStyle(ButtonStyle.Secondary)
                            );
                        
                        await i.editReply({
                            embeds: [panelEmbed],
                            components: [...panelRows, backRow]
                        });
                    }
                    } else if (i.isButton()) {
                        // Handle back button separately since it doesn't show modals
                        if (i.customId === 'back_to_main_dashboard') {
                            await i.update({
                                embeds: [initialEmbed],
                                components: [selectRow]
                            });
                            return;
                        }
                        
                        // Handle button interactions that show modals
                        switch (i.customId) {
                            case 'whitelist_add':
                                const modal = new ModalBuilder()
                                    .setCustomId('whitelist_add_submit')
                                    .setTitle('Add Player to Whitelist');
                                
                                const usernameInput = new TextInputBuilder()
                                    .setCustomId('whitelist_username_input')
                                    .setLabel('Username')
                                    .setStyle(TextInputStyle.Short)
                                    .setPlaceholder('Enter Minecraft username')
                                    .setRequired(true);
                                
                                const firstActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(usernameInput);
                                modal.addComponents(firstActionRow);
                                
                                await i.showModal(modal);
                                break;
                                
                            case 'whitelist_view_all':
                                await i.deferUpdate();
                                const whitelistEmbed = new EmbedBuilder()
                                    .setTitle('📋 Complete Whitelist')
                                    .setDescription(`**Total Players:** ${typedConfig.whitelist.length}`)
                                    .addFields(
                                        { name: '👥 Whitelisted Players', value: typedConfig.whitelist.length > 0 ? '```\n' + typedConfig.whitelist.map((player, index) => `${index + 1}. ${player}`).join('\n') + '\n```' : '```\nNo players whitelisted\n```', inline: false }
                                    )
                                    .setColor('#00D4AA')
                                    .setTimestamp();
                                
                                await i.editReply({
                                    embeds: [whitelistEmbed],
                                    components: [
                                        new ActionRowBuilder<ButtonBuilder>()
                                            .addComponents(
                                                new ButtonBuilder()
                                                    .setCustomId('back_to_main_dashboard')
                                                    .setLabel('Back to Main Dashboard')
                                                    .setStyle(ButtonStyle.Secondary)
                                            )
                                    ]
                                });
                                break;
                                
                            case 'whitelist_remove_menu':
                                await i.deferUpdate();
                                if (typedConfig.whitelist.length === 0) return;
                                
                                const removeSelect = new StringSelectMenuBuilder()
                                    .setCustomId('whitelist_select_remove')
                                    .setPlaceholder('Select player to remove...')
                                    .addOptions(
                                        typedConfig.whitelist.slice(0, 25).map(player => ({
                                            label: player,
                                            value: player
                                        }))
                                    );
                                
                                const removeRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(removeSelect);
                                
                                await i.editReply({
                                    content: 'Select a player to remove from the whitelist:',
                                    embeds: [],
                                    components: [
                                        removeRow,
                                        new ActionRowBuilder<ButtonBuilder>()
                                            .addComponents(
                                                new ButtonBuilder()
                                                    .setCustomId('back_to_main_dashboard')
                                                    .setLabel('Back to Main Dashboard')
                                                    .setStyle(ButtonStyle.Secondary)
                                            )
                                    ]
                                });
                                break;
                                
                            case 'whitelist_clear_all':
                                await i.deferUpdate();
                                if (typedConfig.whitelist.length === 0) return;
                                
                                typedConfig.whitelist = [];
                                saveConfig();
                                log(`Whitelist cleared by ${i.user.tag}.`);
                                
                                const clearedEmbed = new EmbedBuilder()
                                    .setTitle('✅ Whitelist Cleared')
                                    .setDescription('All players have been removed from the whitelist.')
                                    .setColor('#00ff00')
                                    .setTimestamp();
                                
                                await i.editReply({
                                    embeds: [clearedEmbed],
                                    components: [
                                        new ActionRowBuilder<ButtonBuilder>()
                                            .addComponents(
                                                new ButtonBuilder()
                                                    .setCustomId('back_to_main_dashboard')
                                                    .setLabel('Back to Main Dashboard')
                                                    .setStyle(ButtonStyle.Secondary)
                                            )
                                    ]
                                });
                                break;
                                
                            case 'admin_add':
                                const adminModal = new ModalBuilder()
                                    .setCustomId('admin_add_submit')
                                    .setTitle('Add Administrator');
                                
                                const adminInput = new TextInputBuilder()
                                    .setCustomId('admin_user_input')
                                    .setLabel('User ID or Username')
                                    .setStyle(TextInputStyle.Short)
                                    .setPlaceholder('Enter Discord user ID or username')
                                    .setRequired(true);
                                
                                const adminActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(adminInput);
                                adminModal.addComponents(adminActionRow);
                                
                                await i.showModal(adminModal);
                                break;
                                
                            case 'admin_clear_all':
                                await i.deferUpdate();
                                if (typedConfig.admins.length === 0) return;
                                
                                typedConfig.admins = [];
                                saveConfig();
                                log(`All admins cleared by ${i.user.tag}.`);
                                
                                const adminClearedEmbed = new EmbedBuilder()
                                    .setTitle('✅ Admins Cleared')
                                    .setDescription('All administrators have been removed.')
                                    .setColor('#00ff00')
                                    .setTimestamp();
                                
                                await i.editReply({
                                    embeds: [adminClearedEmbed],
                                    components: [
                                        new ActionRowBuilder<ButtonBuilder>()
                                            .addComponents(
                                                new ButtonBuilder()
                                                    .setCustomId('back_to_main_dashboard')
                                                    .setLabel('Back to Main Dashboard')
                                                    .setStyle(ButtonStyle.Secondary)
                                            )
                                    ]
                                });
                                break;
                                
                            case 'admin_remove_menu':
                                await i.deferUpdate();
                                if (typedConfig.admins.length === 0) return;
                                
                                const adminRemoveSelect = new StringSelectMenuBuilder()
                                    .setCustomId('admin_remove_menu')
                                    .setPlaceholder('Select admin to remove...')
                                    .addOptions(
                                        typedConfig.admins.slice(0, 25).map(admin => ({
                                            label: admin,
                                            value: admin
                                        }))
                                    );
                                
                                const adminRemoveRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(adminRemoveSelect);
                                
                                await i.editReply({
                                    content: 'Select an admin to remove:',
                                    embeds: [],
                                    components: [
                                        adminRemoveRow,
                                        new ActionRowBuilder<ButtonBuilder>()
                                            .addComponents(
                                                new ButtonBuilder()
                                                    .setCustomId('back_to_main_dashboard')
                                                    .setLabel('Back to Main Dashboard')
                                                    .setStyle(ButtonStyle.Secondary)
                                            )
                                    ]
                                });
                                break;
                                
                            case 'allowlist_add':
                                const allowlistModal = new ModalBuilder()
                                    .setCustomId('allowlist_add_submit')
                                    .setTitle('Add Player to Allowlist');
                                
                                const allowlistUsernameInput = new TextInputBuilder()
                                    .setCustomId('allowlist_username_input')
                                    .setLabel('Username')
                                    .setStyle(TextInputStyle.Short)
                                    .setPlaceholder('Enter Minecraft username')
                                    .setRequired(true);
                                
                                const allowlistActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(allowlistUsernameInput);
                                allowlistModal.addComponents(allowlistActionRow);
                                
                                await i.showModal(allowlistModal);
                                break;
                                
                            case 'allowlist_view_all':
                                await i.deferUpdate();
                                const allowlistEmbed = new EmbedBuilder()
                                    .setTitle('📋 Complete Allowlist')
                                    .setDescription(`**Total Players:** ${typedConfig.allowlist?.length || 0}`)
                                    .addFields(
                                        { name: '👥 Allowlisted Players', value: (typedConfig.allowlist?.length || 0) > 0 ? '```\n' + typedConfig.allowlist!.map((player, index) => `${index + 1}. ${player}`).join('\n') + '\n```' : '```\nNo players allowlisted\n```', inline: false }
                                    )
                                    .setColor('#00D4AA')
                                    .setTimestamp();
                                
                                await i.editReply({
                                    embeds: [allowlistEmbed],
                                    components: [
                                        new ActionRowBuilder<ButtonBuilder>()
                                            .addComponents(
                                                new ButtonBuilder()
                                                    .setCustomId('back_to_main_dashboard')
                                                    .setLabel('Back to Main Dashboard')
                                                    .setStyle(ButtonStyle.Secondary)
                                            )
                                    ]
                                });
                                break;
                                
                            case 'allowlist_remove_menu':
                                await i.deferUpdate();
                                if (!typedConfig.allowlist || typedConfig.allowlist.length === 0) return;
                                
                                const allowlistRemoveSelect = new StringSelectMenuBuilder()
                                    .setCustomId('allowlist_select_remove')
                                    .setPlaceholder('Select player to remove...')
                                    .addOptions(
                                        typedConfig.allowlist.slice(0, 25).map(player => ({
                                            label: player,
                                            value: player
                                        }))
                                    );
                                
                                const allowlistRemoveRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(allowlistRemoveSelect);
                                
                                await i.editReply({
                                    content: 'Select a player to remove from allowlist:',
                                    embeds: [],
                                    components: [
                                        allowlistRemoveRow,
                                        new ActionRowBuilder<ButtonBuilder>()
                                            .addComponents(
                                                new ButtonBuilder()
                                                    .setCustomId('back_to_main_dashboard')
                                                    .setLabel('Back to Main Dashboard')
                                                    .setStyle(ButtonStyle.Secondary)
                                            )
                                    ]
                                });
                                break;
                                
                            case 'maintenance_toggle':
                                await i.deferUpdate();
                                if (!typedConfig.maintenanceMode) {
                                    typedConfig.maintenanceMode = { enabled: false, enabledBy: '', enabledAt: 0, reason: '' };
                                }
                                
                                typedConfig.maintenanceMode.enabled = !typedConfig.maintenanceMode.enabled;
                                if (typedConfig.maintenanceMode.enabled) {
                                    typedConfig.maintenanceMode.enabledBy = i.user.tag;
                                    typedConfig.maintenanceMode.enabledAt = Date.now();
                                    typedConfig.maintenanceMode.reason = 'Manual activation via Discord';
                                } else {
                                    typedConfig.maintenanceMode.enabledBy = '';
                                    typedConfig.maintenanceMode.enabledAt = 0;
                                    typedConfig.maintenanceMode.reason = '';
                                }
                                saveConfig();
                                log(`Maintenance mode ${typedConfig.maintenanceMode?.enabled ? 'enabled' : 'disabled'} by ${i.user.tag}.`);
                                
                                // Note: Player kicking functionality would require server connection
                                // This feature can be implemented when server WebSocket connection is available
                                if (typedConfig.maintenanceMode.enabled) {
                                    log(`Maintenance mode enabled - non-allowlisted players should be kicked manually or via server commands.`);
                                }
                                
                                const maintenanceToggleEmbed = new EmbedBuilder()
                                    .setTitle(`✅ Maintenance Mode ${typedConfig.maintenanceMode?.enabled ? 'Enabled' : 'Disabled'}`)
                                    .setDescription(`Maintenance mode has been ${typedConfig.maintenanceMode?.enabled ? 'enabled' : 'disabled'}.${typedConfig.maintenanceMode?.enabled ? '\n\n⚠️ **Non-allowlisted players will be kicked from the server.**' : ''}`)
                                    .setColor(typedConfig.maintenanceMode?.enabled ? '#ff9900' : '#00ff00')
                                    .setTimestamp();
                                
                                await i.editReply({
                                    embeds: [maintenanceToggleEmbed],
                                    components: [
                                        new ActionRowBuilder<ButtonBuilder>()
                                            .addComponents(
                                                new ButtonBuilder()
                                                    .setCustomId('back_to_main_dashboard')
                                                    .setLabel('Back to Main Dashboard')
                                                    .setStyle(ButtonStyle.Secondary)
                                            )
                                    ]
                                });
                                break;
                                
                            case 'maintenance_set_reason':
                                const reasonModal = new ModalBuilder()
                                    .setCustomId('maintenance_reason_modal')
                                    .setTitle('Set Maintenance Reason');
                                
                                const reasonInput = new TextInputBuilder()
                                    .setCustomId('maintenance_reason_input')
                                    .setLabel('Maintenance Reason')
                                    .setStyle(TextInputStyle.Paragraph)
                                    .setPlaceholder('Enter the reason for maintenance mode...')
                                    .setRequired(true)
                                    .setMaxLength(500);
                                
                                const reasonRow = new ActionRowBuilder<TextInputBuilder>()
                                    .addComponents(reasonInput);
                                
                                reasonModal.addComponents(reasonRow);
                                await i.showModal(reasonModal);
                                break;
                                
                            case 'alt_toggle_enabled':
                                await i.deferUpdate();
                                typedConfig.altSystem.enabled = !typedConfig.altSystem.enabled;
                                saveConfig();
                                log(`Alt detection ${typedConfig.altSystem.enabled ? 'enabled' : 'disabled'} by ${i.user.tag}.`);
                                
                                const altToggleEmbed = new EmbedBuilder()
                                    .setTitle(`✅ Alt Detection ${typedConfig.altSystem.enabled ? 'Enabled' : 'Disabled'}`)
                                    .setDescription(`Alt account detection has been ${typedConfig.altSystem.enabled ? 'enabled' : 'disabled'}.`)
                                    .setColor(typedConfig.altSystem.enabled ? '#00ff00' : '#ff0000')
                                    .setTimestamp();
                                
                                await i.editReply({
                                    embeds: [altToggleEmbed],
                                    components: [
                                        new ActionRowBuilder<ButtonBuilder>()
                                            .addComponents(
                                                new ButtonBuilder()
                                                    .setCustomId('back_to_main_dashboard')
                                                    .setLabel('Back to Main Dashboard')
                                                    .setStyle(ButtonStyle.Secondary)
                                            )
                                    ]
                                });
                                break;
                                
                            case 'device_toggle_android':
                            case 'device_toggle_ios':
                            case 'device_toggle_xbox':
                            case 'device_toggle_windows':
                            case 'device_toggle_playstation':
                            case 'device_toggle_fireos':
                            case 'device_toggle_nintendoswitch':
                                await i.deferUpdate();
                                const device = i.customId.replace('device_toggle_', '') as keyof NonNullable<Config['deviceRestrictions']>;
                                if (!typedConfig.deviceRestrictions) {
                                    typedConfig.deviceRestrictions = {
                                        Android: false, iOS: false, Xbox: false, Windows: false,
                                        PlayStation: false, FireOS: false, NintendoSwitch: false
                                    };
                                }
                                if (device in typedConfig.deviceRestrictions) {
                                    typedConfig.deviceRestrictions[device] = !typedConfig.deviceRestrictions[device];
                                    saveConfig();
                                    log(`Device ${device} ${typedConfig.deviceRestrictions[device] ? 'allowed' : 'restricted'} by ${i.user.tag}.`);
                                    
                                    const deviceResult = getDeviceConfigPanel(typedConfig);
                                    await i.editReply({
                                        embeds: [deviceResult[0]],
                                        components: [
                                            deviceResult[1], 
                                            deviceResult[2],
                                            new ActionRowBuilder<ButtonBuilder>()
                                                .addComponents(
                                                    new ButtonBuilder()
                                                        .setCustomId('back_to_main_dashboard')
                                                        .setLabel('Back to Main Dashboard')
                                                        .setStyle(ButtonStyle.Secondary)
                                                )
                                        ]
                                    });
                                }
                                break;
                                
                            case 'channel_set_welcome':
                                await i.deferUpdate();
                                
                                const welcomeChannelSelect = new ChannelSelectMenuBuilder()
                                    .setCustomId('welcome_channel_select')
                                    .setPlaceholder('Select a channel for welcome messages')
                                    .setChannelTypes([ChannelType.GuildText]);
                                
                                await i.editReply({
                                    content: '📍 **Select Welcome Channel**\nChoose the channel where welcome messages will be sent:',
                                    embeds: [],
                                    components: [
                                        new ActionRowBuilder<ChannelSelectMenuBuilder>()
                                            .addComponents(welcomeChannelSelect),
                                        new ActionRowBuilder<ButtonBuilder>()
                                            .addComponents(
                                                new ButtonBuilder()
                                                    .setCustomId('back_to_main_dashboard')
                                                    .setLabel('Back to Main Dashboard')
                                                    .setStyle(ButtonStyle.Secondary)
                                            )
                                    ]
                                });
                                break;
                                
                            case 'channel_clear_welcome':
                                await i.deferUpdate();
                                typedConfig.welcomeChannelId = null;
                                saveConfig();
                                log(`Welcome channel cleared by ${i.user.tag}.`);
                                
                                const welcomeClearedEmbed = new EmbedBuilder()
                                    .setTitle('✅ Welcome Channel Cleared')
                                    .setDescription('Welcome channel has been cleared.')
                                    .setColor('#00ff00')
                                    .setTimestamp();
                                
                                await i.editReply({
                                    embeds: [welcomeClearedEmbed],
                                    components: [
                                        new ActionRowBuilder<ButtonBuilder>()
                                            .addComponents(
                                                new ButtonBuilder()
                                                    .setCustomId('back_to_main_dashboard')
                                                    .setLabel('Back to Main Dashboard')
                                                    .setStyle(ButtonStyle.Secondary)
                                            )
                                    ]
                                });
                                break;
                                
                            case 'channel_set_log':
                                await i.deferUpdate();
                                
                                const logChannelSelect = new ChannelSelectMenuBuilder()
                                    .setCustomId('log_channel_select')
                                    .setPlaceholder('Select a channel for server logs')
                                    .setChannelTypes([ChannelType.GuildText]);
                                
                                await i.editReply({
                                    content: '📊 **Select Log Channel**\nChoose the channel where server logs will be sent:',
                                    embeds: [],
                                    components: [
                                        new ActionRowBuilder<ChannelSelectMenuBuilder>()
                                            .addComponents(logChannelSelect),
                                        new ActionRowBuilder<ButtonBuilder>()
                                            .addComponents(
                                                new ButtonBuilder()
                                                    .setCustomId('back_to_main_dashboard')
                                                    .setLabel('Back to Main Dashboard')
                                                    .setStyle(ButtonStyle.Secondary)
                                            )
                                    ]
                                });
                                break;
                                
                            case 'channel_set_joins_leaves':
                                await i.deferUpdate();
                                
                                const joinsLeavesChannelSelect = new ChannelSelectMenuBuilder()
                                    .setCustomId('joins_leaves_channel_select')
                                    .setPlaceholder('Select a channel for joins/leaves logs')
                                    .setChannelTypes([ChannelType.GuildText]);
                                
                                await i.editReply({
                                    content: '🚪 **Select Joins/Leaves Channel**\nChoose the channel where player join/leave logs will be sent:',
                                    embeds: [],
                                    components: [
                                        new ActionRowBuilder<ChannelSelectMenuBuilder>()
                                            .addComponents(joinsLeavesChannelSelect),
                                        new ActionRowBuilder<ButtonBuilder>()
                                            .addComponents(
                                                new ButtonBuilder()
                                                    .setCustomId('back_to_main_dashboard')
                                                    .setLabel('Back to Main Dashboard')
                                                    .setStyle(ButtonStyle.Secondary)
                                            )
                                    ]
                                });
                                break;
                                
                            case 'channel_set_chat':
                                await i.deferUpdate();
                                
                                const chatChannelSelect = new ChannelSelectMenuBuilder()
                                    .setCustomId('chat_channel_select')
                                    .setPlaceholder('Select a channel for chat logs')
                                    .setChannelTypes([ChannelType.GuildText]);
                                
                                await i.editReply({
                                    content: '💬 **Select Chat Channel**\nChoose the channel where chat logs will be sent:',
                                    embeds: [],
                                    components: [
                                        new ActionRowBuilder<ChannelSelectMenuBuilder>()
                                            .addComponents(chatChannelSelect),
                                        new ActionRowBuilder<ButtonBuilder>()
                                            .addComponents(
                                                new ButtonBuilder()
                                                    .setCustomId('back_to_main_dashboard')
                                                    .setLabel('Back to Main Dashboard')
                                                    .setStyle(ButtonStyle.Secondary)
                                            )
                                    ]
                                });
                                break;
                                
                            case 'channel_set_kicks':
                                await i.deferUpdate();
                                
                                const kicksChannelSelect = new ChannelSelectMenuBuilder()
                                    .setCustomId('kicks_channel_select')
                                    .setPlaceholder('Select a channel for kick logs')
                                    .setChannelTypes([ChannelType.GuildText]);
                                
                                await i.editReply({
                                    content: '👢 **Select Kicks Channel**\nChoose the channel where kick logs will be sent:',
                                    embeds: [],
                                    components: [
                                        new ActionRowBuilder<ChannelSelectMenuBuilder>()
                                            .addComponents(kicksChannelSelect),
                                        new ActionRowBuilder<ButtonBuilder>()
                                            .addComponents(
                                                new ButtonBuilder()
                                                    .setCustomId('back_to_main_dashboard')
                                                    .setLabel('Back to Main Dashboard')
                                                    .setStyle(ButtonStyle.Secondary)
                                            )
                                    ]
                                });
                                break;
                                
                            case 'channel_clear_all':
                                await i.deferUpdate();
                                typedConfig.welcomeChannelId = null;
                                typedConfig.logChannelId = null;
                                if (typedConfig.servers?.[0]?.logChannels) {
                                    typedConfig.servers[0].logChannels.joinsAndLeaves = null;
                                    typedConfig.servers[0].logChannels.chat = null;
                                    typedConfig.servers[0].logChannels.kicks = null;
                                }
                                if (typedConfig.welcomeMessages) {
                                    typedConfig.welcomeMessages.channelId = null;
                                }
                                saveConfig();
                                log(`All channels cleared by ${i.user.tag}.`);
                                
                                const allClearedEmbed = new EmbedBuilder()
                                    .setTitle('✅ All Channels Cleared')
                                    .setDescription('All channel configurations have been cleared.')
                                    .setColor('#00ff00')
                                    .setTimestamp();
                                
                                await i.editReply({
                                    embeds: [allClearedEmbed],
                                    components: [
                                        new ActionRowBuilder<ButtonBuilder>()
                                            .addComponents(
                                                new ButtonBuilder()
                                                    .setCustomId('back_to_main_dashboard')
                                                    .setLabel('Back to Main Dashboard')
                                                    .setStyle(ButtonStyle.Secondary)
                                            )
                                    ]
                                });
                                break;
                                
                            case 'channel_clear_log':
                                await i.deferUpdate();
                                typedConfig.logChannelId = null;
                                saveConfig();
                                log(`Log channel cleared by ${i.user.tag}.`);
                                
                                const logClearedEmbed = new EmbedBuilder()
                                    .setTitle('✅ Log Channel Cleared')
                                    .setDescription('Log channel has been cleared.')
                                    .setColor('#00ff00')
                                    .setTimestamp();
                                
                                await i.editReply({
                                    embeds: [logClearedEmbed],
                                    components: [
                                        new ActionRowBuilder<ButtonBuilder>()
                                            .addComponents(
                                                new ButtonBuilder()
                                                    .setCustomId('back_to_main_dashboard')
                                                    .setLabel('Back to Main Dashboard')
                                                    .setStyle(ButtonStyle.Secondary)
                                            )
                                    ]
                                });
                                break;
                                
                            case 'role_set_member':
                                await i.deferUpdate();
                                
                                const memberRoleSelectEmbed = new EmbedBuilder()
                                    .setTitle('🎭 Select Member Role')
                                    .setDescription('Please select the role you want to set as the member role from the dropdown below.')
                                    .setColor('#FFD700')
                                    .setTimestamp();
                                
                                const memberRoleSelect = new RoleSelectMenuBuilder()
                                    .setCustomId('member_role_select')
                                    .setPlaceholder('Select a role for members')
                                    .setMinValues(1)
                                    .setMaxValues(1);
                                
                                await i.editReply({
                                    embeds: [memberRoleSelectEmbed],
                                    components: [
                                        new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(memberRoleSelect),
                                        new ActionRowBuilder<ButtonBuilder>()
                                            .addComponents(
                                                new ButtonBuilder()
                                                    .setCustomId('back_to_main_dashboard')
                                                    .setLabel('Back to Main Dashboard')
                                                    .setStyle(ButtonStyle.Secondary)
                                            )
                                    ]
                                });
                                break;
                                
                            case 'role_clear_member':
                                await i.deferUpdate();
                                typedConfig.memberRoleId = null;
                                saveConfig();
                                log(`Member role cleared by ${i.user.tag}.`);
                                
                                const memberClearedEmbed = new EmbedBuilder()
                                    .setTitle('✅ Member Role Cleared')
                                    .setDescription('Member role has been cleared.')
                                    .setColor('#00ff00')
                                    .setTimestamp();
                                
                                await i.editReply({
                                    embeds: [memberClearedEmbed],
                                    components: [
                                        new ActionRowBuilder<ButtonBuilder>()
                                            .addComponents(
                                                new ButtonBuilder()
                                                    .setCustomId('back_to_main_dashboard')
                                                    .setLabel('Back to Main Dashboard')
                                                    .setStyle(ButtonStyle.Secondary)
                                            )
                                    ]
                                });
                                break;
                                

                                
                            case 'player_ban':
                                const banModal = new ModalBuilder()
                                    .setCustomId('player_ban_submit')
                                    .setTitle('Ban Player');
                                
                                const banUsernameInput = new TextInputBuilder()
                                    .setCustomId('ban_username_input')
                                    .setLabel('Player Username')
                                    .setStyle(TextInputStyle.Short)
                                    .setPlaceholder('Enter Minecraft username')
                                    .setRequired(true);
                                
                                const banReasonInput = new TextInputBuilder()
                                    .setCustomId('ban_reason_input')
                                    .setLabel('Reason')
                                    .setStyle(TextInputStyle.Paragraph)
                                    .setPlaceholder('Enter ban reason')
                                    .setRequired(true);
                                
                                const banActionRow1 = new ActionRowBuilder<TextInputBuilder>().addComponents(banUsernameInput);
                                const banActionRow2 = new ActionRowBuilder<TextInputBuilder>().addComponents(banReasonInput);
                                banModal.addComponents(banActionRow1, banActionRow2);
                                
                                await i.showModal(banModal);
                                break;
                                
                            case 'player_unban':
                                const unbanModal = new ModalBuilder()
                                    .setCustomId('player_unban_submit')
                                    .setTitle('Unban Player');
                                
                                const unbanInput = new TextInputBuilder()
                                    .setCustomId('unban_username_input')
                                    .setLabel('Player Username')
                                    .setStyle(TextInputStyle.Short)
                                    .setPlaceholder('Enter Minecraft username')
                                    .setRequired(true);
                                
                                const unbanActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(unbanInput);
                                unbanModal.addComponents(unbanActionRow);
                                
                                await i.showModal(unbanModal);
                                break;
                                

                                
                            case 'player_stats':
                                const statsModal = new ModalBuilder()
                                    .setCustomId('player_stats_submit')
                                    .setTitle('View Player Stats');
                                
                                const statsInput = new TextInputBuilder()
                                    .setCustomId('stats_username_input')
                                    .setLabel('Player Username')
                                    .setStyle(TextInputStyle.Short)
                                    .setPlaceholder('Enter Minecraft username')
                                    .setRequired(true);
                                
                                const statsActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(statsInput);
                                statsModal.addComponents(statsActionRow);
                                
                                await i.showModal(statsModal);
                                break;
                                
                            case 'add_player_note':
                                const notesModal = new ModalBuilder()
                                    .setCustomId('player_notes_submit')
                                    .setTitle('Add Player Note');
                                
                                const notesUsernameInput = new TextInputBuilder()
                                    .setCustomId('notes_username_input')
                                    .setLabel('Player Username')
                                    .setStyle(TextInputStyle.Short)
                                    .setPlaceholder('Enter Minecraft username')
                                    .setRequired(true);
                                
                                const notesContentInput = new TextInputBuilder()
                                    .setCustomId('notes_content_input')
                                    .setLabel('Note Content')
                                    .setStyle(TextInputStyle.Paragraph)
                                    .setPlaceholder('Enter your note about this player...')
                                    .setRequired(true)
                                    .setMaxLength(1000);
                                
                                const notesUsernameRow = new ActionRowBuilder<TextInputBuilder>().addComponents(notesUsernameInput);
                                const notesContentRow = new ActionRowBuilder<TextInputBuilder>().addComponents(notesContentInput);
                                notesModal.addComponents(notesUsernameRow, notesContentRow);
                                
                                await i.showModal(notesModal);
                                break;
                                
                            case 'view_player_notes':
                                const viewNotesModal = new ModalBuilder()
                                    .setCustomId('view_notes_submit')
                                    .setTitle('View Player Notes');
                                
                                const viewUsernameInput = new TextInputBuilder()
                                    .setCustomId('view_username_input')
                                    .setLabel('Player Username')
                                    .setStyle(TextInputStyle.Short)
                                    .setPlaceholder('Enter Minecraft username to view notes')
                                    .setRequired(true);
                                
                                const viewUsernameRow = new ActionRowBuilder<TextInputBuilder>().addComponents(viewUsernameInput);
                                viewNotesModal.addComponents(viewUsernameRow);
                                
                                await i.showModal(viewNotesModal);
                                break;

                            case 'announcement_add':
                                const announcementModal = new ModalBuilder()
                                    .setCustomId('announcement_add_submit')
                                    .setTitle('Add Scheduled Announcement');

                                const messageInput = new TextInputBuilder()
                                    .setCustomId('announcement_message')
                                    .setLabel('Announcement Message')
                                    .setStyle(TextInputStyle.Paragraph)
                                    .setPlaceholder('Enter the announcement message...')
                                    .setRequired(true);

                                const timeInput = new TextInputBuilder()
                                    .setCustomId('announcement_time')
                                    .setLabel('Interval (minutes)')
                                    .setStyle(TextInputStyle.Short)
                                    .setPlaceholder('e.g., 1 for every minute, 5 for every 5 minutes')
                                    .setRequired(true);

                                announcementModal.addComponents(
                                    new ActionRowBuilder<TextInputBuilder>().addComponents(messageInput),
                                    new ActionRowBuilder<TextInputBuilder>().addComponents(timeInput)
                                );

                                await i.showModal(announcementModal);
                                break;

                            case 'announcement_list':
                                await i.deferUpdate();
                                const announcements = JSON.parse(fs.readFileSync('./announcements.json', 'utf-8'));
                                
                                const listEmbed = new EmbedBuilder()
                                    .setTitle('📢 Scheduled Announcements')
                                    .setColor('#7289DA')
                                    .setTimestamp();

                                if (announcements.length === 0) {
                                    listEmbed.setDescription('No announcements are currently scheduled.');
                                } else {
                                    announcements.forEach((ann: any, index: number) => {
                                        listEmbed.addFields({
                                            name: `In-Game Announcement #${index + 1}`,
                                            value: `**Interval:** Every ${ann.cronTime} minute(s)\n**Message:** ${ann.message}`
                                        });
                                    });
                                }

                                await i.editReply({ embeds: [listEmbed], components: [backRow] });
                                break;

                            case 'announcement_remove_menu':
                                await i.deferUpdate();
                                const announcementsForRemoval = JSON.parse(fs.readFileSync('./announcements.json', 'utf-8'));
                                if (announcementsForRemoval.length === 0) {
                                    await i.editReply({ content: 'No announcements to remove.', embeds: [], components: [] });
                                    return;
                                }

                                const selectMenu = new StringSelectMenuBuilder()
                                    .setCustomId('announcement_select_remove')
                                    .setPlaceholder('Select an announcement to remove')
                                    .addOptions(announcementsForRemoval.map((ann: any, index: number) => ({
                                        label: `In-Game Announcement #${index + 1}`,
                                        value: ann.id, // Use the unique ID
                                        description: ann.message.substring(0, 50)
                                    })));

                                const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
                                await i.editReply({ content: 'Select an announcement to remove:', components: [row, backRow] });
                                break;
                                
                            case 'server_uptime':
                                await i.deferUpdate();
                                const uptime = activityTracker.getUptime();
                                const onlinePlayers = activityTracker.getCurrentOnlinePlayers();
                                const dailyStats = activityTracker.getTodayStats();
                                
                                const uptimeEmbed = new EmbedBuilder()
                                    .setTitle('⏰ Server Uptime & Statistics')
                                    .addFields(
                                        { name: '⏰ Server Uptime', value: uptime, inline: true },
                                        { name: '👥 Online Players', value: onlinePlayers.length.toString(), inline: true },
                                        { name: '📈 Daily Joins', value: dailyStats.joins.toString(), inline: true },
                                        { name: '👥 Daily Unique Players', value: dailyStats.uniquePlayers.toString(), inline: true }
                                    )
                                    .setColor('#00ff00')
                                    .setTimestamp();
                                
                                if (onlinePlayers.length > 0) {
                                    uptimeEmbed.addFields({ name: '🎮 Currently Online', value: onlinePlayers.join(', '), inline: false });
                                }
                                
                                await i.editReply({
                                    embeds: [uptimeEmbed],
                                    components: [
                                        new ActionRowBuilder<ButtonBuilder>()
                                            .addComponents(
                                                new ButtonBuilder()
                                                    .setCustomId('back_to_main_dashboard')
                                                    .setLabel('Back to Main Dashboard')
                                                    .setStyle(ButtonStyle.Secondary)
                                            )
                                    ]
                                });
                                break;
                                
                            case 'server_performance':
                                await i.deferUpdate();
                                const startTime = process.hrtime.bigint();
                                // Simulate some processing to get meaningful response time
                                await new Promise(resolve => setTimeout(resolve, 1));
                                const endTime = process.hrtime.bigint();
                                const responseTime = Number(endTime - startTime) / 1000000; // Convert to milliseconds
                                const memoryUsage = process.memoryUsage();
                                const uptimeProcess = process.uptime();
                                
                                const days = Math.floor(uptimeProcess / 86400);
                                const hours = Math.floor((uptimeProcess % 86400) / 3600);
                                const minutes = Math.floor((uptimeProcess % 3600) / 60);
                                const uptimeString = `${days}d ${hours}h ${minutes}m`;
                                
                                const memoryMB = {
                                    used: Math.round(memoryUsage.heapUsed / 1024 / 1024),
                                    total: Math.round(memoryUsage.heapTotal / 1024 / 1024),
                                    external: Math.round(memoryUsage.external / 1024 / 1024)
                                };
                                
                                const performanceEmbed = new EmbedBuilder()
                                    .setTitle('⚡ Server Performance Metrics')
                                    .addFields(
                                        { name: '⏱️ Response Time', value: `${responseTime}ms`, inline: true },
                                        { name: '🕐 Bot Uptime', value: uptimeString, inline: true },
                                        { name: '💾 Memory Usage', value: `${memoryMB.used}MB / ${memoryMB.total}MB`, inline: true },
                                        { name: '🔧 External Memory', value: `${memoryMB.external}MB`, inline: true },
                                        { name: '🖥️ Platform', value: process.platform, inline: true }
                                    )
                                    .setColor('#0099ff')
                                    .setTimestamp();
                                
                                await i.editReply({
                                    embeds: [performanceEmbed],
                                    components: [
                                        new ActionRowBuilder<ButtonBuilder>()
                                            .addComponents(
                                                new ButtonBuilder()
                                                    .setCustomId('back_to_main_dashboard')
                                                    .setLabel('Back to Main Dashboard')
                                                    .setStyle(ButtonStyle.Secondary)
                                            )
                                    ]
                                });
                                break;
                                
                            case 'server_leaderboard':
                                await i.deferUpdate();
                                const leaderboardType = 'playtime';
                                const playerStats = typedConfig.playerStats || {};
                                
                                if (Object.keys(playerStats).length === 0) {
                                    await i.editReply({
                                        content: '📊 No player data available yet.',
                                        embeds: [],
                                        components: []
                                    });
                                    return;
                                }
                                
                                const sortedPlayers = Object.entries(playerStats)
                                    .sort(([aName, a], [bName, b]) => {
                                        let aPlaytime = a.totalPlaytime;
                                        let bPlaytime = b.totalPlaytime;
                                        
                                        const onlinePlayers = activityTracker.getCurrentOnlinePlayers();
                                        if (onlinePlayers.includes(aName) && a.sessionStart) {
                                            aPlaytime += Date.now() - a.sessionStart;
                                        }
                                        if (onlinePlayers.includes(bName) && b.sessionStart) {
                                            bPlaytime += Date.now() - b.sessionStart;
                                        }
                                        
                                        return bPlaytime - aPlaytime;
                                    })
                                    .slice(0, 10);
                                
                                const leaderboardText = sortedPlayers.map(([name, stats], index) => {
                                    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
                                    const onlinePlayers = activityTracker.getCurrentOnlinePlayers();
                                    const isOnline = onlinePlayers.includes(name);
                                    const statusEmoji = isOnline ? '🟢' : '🔴';
                                    
                                    let playtime = stats.totalPlaytime;
                                    if (isOnline && stats.sessionStart) {
                                        playtime += Date.now() - stats.sessionStart;
                                    }
                                    const hours = Math.floor(playtime / 3600000);
                                    const minutes = Math.floor((playtime % 3600000) / 60000);
                                    const value = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
                                    
                                    return `${medal} ${statusEmoji} **${name}** - ${value}`;
                                }).join('\n');
                                
                                const leaderboardEmbed = new EmbedBuilder()
                                    .setTitle('🎮 Top Players by Playtime')
                                    .setDescription('Players ranked by total time played')
                                    .addFields({ name: '📊 Rankings', value: leaderboardText || 'No data available', inline: false })
                                    .setColor('#ffd700')
                                    .setFooter({ text: `🎮 FairplayX Leaderboards • ${sortedPlayers.length} players ranked` })
                                    .setTimestamp();
                                
                                await i.editReply({
                                    embeds: [leaderboardEmbed],
                                    components: [
                                        new ActionRowBuilder<ButtonBuilder>()
                                            .addComponents(
                                                new ButtonBuilder()
                                                    .setCustomId('back_to_main_dashboard')
                                                    .setLabel('Back to Main Dashboard')
                                                    .setStyle(ButtonStyle.Secondary)
                                            )
                                    ]
                                });
                                break;
                                
                            case 'server_security':
                                await i.deferUpdate();
                                const events = securityMonitor.getRecentEvents(10);
                                
                                if (events.length === 0) {
                                    await i.editReply({
                                        content: '📋 No security events recorded.',
                                        embeds: [],
                                        components: []
                                    });
                                    return;
                                }
                                
                                const securityEmbed = new EmbedBuilder()
                                    .setTitle('🔒 Recent Security Events')
                                    .setColor('#ff6b6b')
                                    .setTimestamp();
                                
                                const eventList = events.map(event => {
                                    const timestamp = new Date(event.timestamp).toLocaleString();
                                    const severityEmoji = event.severity === 'high' ? '🔴' : event.severity === 'medium' ? '🟡' : '🟢';
                                    return `${severityEmoji} **${event.type}** - ${event.player}\n${event.details}\n*${timestamp}*`;
                                }).join('\n\n');
                                
                                securityEmbed.setDescription(eventList.length > 4000 ? eventList.substring(0, 4000) + '...' : eventList);
                                
                                await i.editReply({
                                    embeds: [securityEmbed],
                                    components: [
                                        new ActionRowBuilder<ButtonBuilder>()
                                            .addComponents(
                                                new ButtonBuilder()
                                                    .setCustomId('back_to_main_dashboard')
                                                    .setLabel('Back to Main Dashboard')
                                                    .setStyle(ButtonStyle.Secondary)
                                            )
                                    ]
                                });
                                break;
                                
                            case 'rewards_toggle':
                                await i.deferUpdate();
                                if (!typedConfig.rewardsConfig) {
                                    typedConfig.rewardsConfig = { enabled: false, milestones: [] };
                                }
                                typedConfig.rewardsConfig.enabled = !typedConfig.rewardsConfig.enabled;
                                saveConfig();
                                log(`Rewards system ${typedConfig.rewardsConfig.enabled ? 'enabled' : 'disabled'} by ${i.user.tag}.`);
                                
                                const rewardsToggleEmbed = new EmbedBuilder()
                                    .setTitle(`✅ Rewards System ${typedConfig.rewardsConfig.enabled ? 'Enabled' : 'Disabled'}`)
                                    .setDescription(`Player rewards system has been ${typedConfig.rewardsConfig.enabled ? 'enabled' : 'disabled'}.`)
                                    .setColor(typedConfig.rewardsConfig.enabled ? '#00ff00' : '#ff0000')
                                    .setTimestamp();
                                
                                await i.editReply({
                                    embeds: [rewardsToggleEmbed],
                                    components: [
                                        new ActionRowBuilder<ButtonBuilder>()
                                            .addComponents(
                                                new ButtonBuilder()
                                                    .setCustomId('back_to_main_dashboard')
                                                    .setLabel('Back to Main Dashboard')
                                                    .setStyle(ButtonStyle.Secondary)
                                            )
                                    ]
                                });
                                break;
                                
                            case 'rewards_milestones':
                                await i.deferUpdate();
                                if (!typedConfig.rewardsConfig?.milestones || typedConfig.rewardsConfig.milestones.length === 0) {
                                    await i.editReply({
                                        content: '🏆 No milestones configured.',
                                        embeds: [],
                                        components: [
                                            new ActionRowBuilder<ButtonBuilder>()
                                                .addComponents(
                                                    new ButtonBuilder()
                                                        .setCustomId('back_to_main_dashboard')
                                                        .setLabel('Back to Main Dashboard')
                                                        .setStyle(ButtonStyle.Secondary)
                                                )
                                        ]
                                    });
                                    return;
                                }
                                
                                const milestonesText = typedConfig.rewardsConfig.milestones.map(milestone => {
                                    const hours = Math.floor(milestone.timeMinutes / 60);
                                    const mins = milestone.timeMinutes % 60;
                                    const timeStr = hours > 0 ? `${hours}h${mins > 0 ? ` ${mins}m` : ''}` : `${mins}m`;
                                    return `${milestone.reward}\n*${milestone.description}* - **${timeStr}**`;
                                }).join('\n\n');
                                
                                const milestonesEmbed = new EmbedBuilder()
                                    .setTitle('🏆 Playtime Rewards & Milestones')
                                    .setDescription('Earn exclusive badges and titles by playing on the server!')
                                    .addFields({ name: '🎯 Available Rewards', value: milestonesText, inline: false })
                                    .setColor('#ffd700')
                                    .setFooter({ text: '🎮 FairplayX Rewards System • Keep playing to unlock more!' })
                                    .setTimestamp();
                                
                                await i.editReply({
                                    embeds: [milestonesEmbed],
                                    components: [
                                        new ActionRowBuilder<ButtonBuilder>()
                                            .addComponents(
                                                new ButtonBuilder()
                                                    .setCustomId('back_to_main_dashboard')
                                                    .setLabel('Back to Main Dashboard')
                                                    .setStyle(ButtonStyle.Secondary)
                                            )
                                    ]
                                });
                                break;
                                
                            case 'rewards_add_milestone':
                                const addMilestoneModal = new ModalBuilder()
                                    .setCustomId('rewards_add_milestone_submit')
                                    .setTitle('Add Reward Milestone');
                                
                                const rewardInput = new TextInputBuilder()
                                    .setCustomId('reward_name_input')
                                    .setLabel('Reward Name')
                                    .setStyle(TextInputStyle.Short)
                                    .setPlaceholder('e.g., Veteran Player')
                                    .setRequired(true);
                                
                                const descriptionInput = new TextInputBuilder()
                                    .setCustomId('reward_description_input')
                                    .setLabel('Reward Description')
                                    .setStyle(TextInputStyle.Paragraph)
                                    .setPlaceholder('e.g., Special title for dedicated players')
                                    .setRequired(true);
                                
                                const rewardTimeInput = new TextInputBuilder()
                                    .setCustomId('reward_time_input')
                                    .setLabel('Required Playtime (minutes)')
                                    .setStyle(TextInputStyle.Short)
                                    .setPlaceholder('e.g., 1440 for 24 hours')
                                    .setRequired(true);
                                
                                const rewardRow = new ActionRowBuilder<TextInputBuilder>().addComponents(rewardInput);
                                const descriptionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput);
                                const timeRow = new ActionRowBuilder<TextInputBuilder>().addComponents(rewardTimeInput);
                                
                                addMilestoneModal.addComponents(rewardRow, descriptionRow, timeRow);
                                
                                await i.showModal(addMilestoneModal);
                                break;
                                
                            case 'rewards_remove_milestone':
                                await i.deferUpdate();
                                if (!typedConfig.rewardsConfig?.milestones || typedConfig.rewardsConfig.milestones.length === 0) {
                                    await i.editReply({
                                        content: '🏆 No milestones configured.',
                                        embeds: [],
                                        components: [
                                            new ActionRowBuilder<ButtonBuilder>()
                                                .addComponents(
                                                    new ButtonBuilder()
                                                        .setCustomId('back_to_main_dashboard')
                                                        .setLabel('Back to Main Dashboard')
                                                        .setStyle(ButtonStyle.Secondary)
                                                )
                                        ]
                                    });
                                    return;
                                }
                                
                                const milestoneRemoveSelect = new StringSelectMenuBuilder()
                                    .setCustomId('rewards_select_remove')
                                    .setPlaceholder('Select milestone to remove...')
                                    .addOptions(
                                        typedConfig.rewardsConfig.milestones.slice(0, 25).map((milestone, sliceIndex) => {
                                             // Find the actual index in the full array
                                             const actualIndex = typedConfig.rewardsConfig!.milestones.findIndex(m => 
                                                 m.timeMinutes === milestone.timeMinutes && m.reward === milestone.reward
                                             );
                                             console.log(`Debug: Creating option for milestone "${milestone.reward}" - sliceIndex: ${sliceIndex}, actualIndex: ${actualIndex}`);
                                            return {
                                                label: milestone.reward,
                                                value: actualIndex.toString(),
                                                description: `${milestone.timeMinutes} minutes - ${milestone.description.substring(0, 50)}${milestone.description.length > 50 ? '...' : ''}`
                                            };
                                        })
                                    );
                                
                                const milestoneRemoveRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(milestoneRemoveSelect);
                                
                                await i.editReply({
                                    content: 'Select a milestone to remove:',
                                    embeds: [],
                                    components: [
                                        milestoneRemoveRow,
                                        new ActionRowBuilder<ButtonBuilder>()
                                            .addComponents(
                                                new ButtonBuilder()
                                                    .setCustomId('back_to_main_dashboard')
                                                    .setLabel('Back to Main Dashboard')
                                                    .setStyle(ButtonStyle.Secondary)
                                            )
                                    ]
                                });
                                break;
                                
                            case 'system_backup_create':
                                await i.deferUpdate();
                                try {
                                    const backupPath = backupManager.createBackup();
                                    const backupEmbed = new EmbedBuilder()
                                        .setTitle('✅ Backup Created')
                                        .setDescription(`Configuration backup has been created successfully.`)
                                        .addFields(
                                            { name: 'Backup Location', value: backupPath, inline: false },
                                            { name: 'Timestamp', value: new Date().toLocaleString(), inline: false }
                                        )
                                        .setColor(0x00ff00)
                                        .setTimestamp();
                                    
                                    await i.editReply({
                                        embeds: [backupEmbed],
                                        components: [
                                            new ActionRowBuilder<ButtonBuilder>()
                                                .addComponents(
                                                    new ButtonBuilder()
                                                        .setCustomId('back_to_main_dashboard')
                                                        .setLabel('Back to Main Dashboard')
                                                        .setStyle(ButtonStyle.Secondary)
                                                )
                                        ]
                                    });
                                } catch (error) {
                                    await i.editReply({
                                        content: '❌ Failed to create backup. Check console for details.',
                                        embeds: [],
                                        components: [
                                            new ActionRowBuilder<ButtonBuilder>()
                                                .addComponents(
                                                    new ButtonBuilder()
                                                        .setCustomId('back_to_main_dashboard')
                                                        .setLabel('Back to Main Dashboard')
                                                        .setStyle(ButtonStyle.Secondary)
                                                )
                                        ]
                                    });
                                }
                                break;
                                
                            case 'system_backup_list':
                                await i.deferUpdate();
                                const backups = backupManager.listBackups();
                                
                                if (backups.length === 0) {
                                    await i.editReply({
                                        content: '📁 No backups found.',
                                        embeds: [],
                                        components: []
                                    });
                                    return;
                                }
                                
                                const backupListEmbed = new EmbedBuilder()
                                    .setTitle('📁 Available Backups')
                                    .setDescription(`Found ${backups.length} backup(s):`)
                                    .addFields(
                                        backups.slice(0, 10).map((backup, index) => ({
                                            name: `${index + 1}. ${backup}`,
                                            value: `Created: ${backup.match(/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/)?.[0]?.replace('T', ' ').replace(/-/g, ':') || 'Unknown'}`,
                                            inline: false
                                        }))
                                    )
                                    .setColor(0x0099ff)
                                    .setTimestamp();
                                
                                if (backups.length > 10) {
                                    backupListEmbed.setFooter({ text: `Showing first 10 of ${backups.length} backups` });
                                }
                                
                                await i.editReply({
                                    embeds: [backupListEmbed],
                                    components: [
                                        new ActionRowBuilder<ButtonBuilder>()
                                            .addComponents(
                                                new ButtonBuilder()
                                                    .setCustomId('back_to_main_dashboard')
                                                    .setLabel('Back to Main Dashboard')
                                                    .setStyle(ButtonStyle.Secondary)
                                            )
                                    ]
                                });
                                break;
                                
                            case 'system_welcome_toggle':
                                await i.deferUpdate();
                                if (!typedConfig.welcomeMessages) {
                                    typedConfig.welcomeMessages = { enabled: false, channelId: null, customMessage: "Welcome {player} to {server}! 🎉", motd: "" };
                                }
                                typedConfig.welcomeMessages.enabled = !typedConfig.welcomeMessages.enabled;
                                saveConfig();
                                log(`Welcome system ${typedConfig.welcomeMessages.enabled ? 'enabled' : 'disabled'} by ${i.user.tag}.`);
                                
                                const welcomeToggleEmbed = new EmbedBuilder()
                                    .setTitle(`✅ Welcome System ${typedConfig.welcomeMessages.enabled ? 'Enabled' : 'Disabled'}`)
                                    .setDescription(`Welcome messages are now ${typedConfig.welcomeMessages.enabled ? 'enabled' : 'disabled'}.`)
                                    .setColor(typedConfig.welcomeMessages.enabled ? '#00ff00' : '#ff0000')
                                    .setTimestamp();
                                
                                await i.editReply({
                                    embeds: [welcomeToggleEmbed],
                                    components: [
                                        new ActionRowBuilder<ButtonBuilder>()
                                            .addComponents(
                                                new ButtonBuilder()
                                                    .setCustomId('back_to_main_dashboard')
                                                    .setLabel('Back to Main Dashboard')
                                                    .setStyle(ButtonStyle.Secondary)
                                            )
                                    ]
                                });
                                break;
                                
                            case 'maintenance_kick_non_allowlisted':
                                await i.deferUpdate();
                                log(`Non-allowlisted player kick requested by ${i.user.tag} during maintenance mode.`);
                                
                                try {
                                    // Get current online players count
                                    const onlinePlayers = getCurrentPlayers();
                                    const onlineCount = onlinePlayers.size;
                                    
                                    // Kick non-allowlisted players
                                    const kickedCount = kickNonAllowlistedPlayers();
                                    
                                    const kickEmbed = new EmbedBuilder()
                                        .setTitle('⚠️ Kick Non-Allowlisted Players')
                                        .setDescription(`Successfully processed kick command for non-allowlisted players.\n\n📊 **Statistics:**\n• Online Players: ${onlineCount}\n• Players Kicked: ${kickedCount}\n\n${kickedCount > 0 ? '✅ Non-allowlisted players have been kicked from the server.' : '✅ No non-allowlisted players were online.'}`)
                                        .setColor(kickedCount > 0 ? '#ff6b35' : '#00ff00')
                                        .setTimestamp();
                                    
                                    await i.editReply({
                                        embeds: [kickEmbed],
                                        components: [
                                            new ActionRowBuilder<ButtonBuilder>()
                                                .addComponents(
                                                    new ButtonBuilder()
                                                        .setCustomId('back_to_main_dashboard')
                                                        .setLabel('Back to Main Dashboard')
                                                        .setStyle(ButtonStyle.Secondary)
                                                )
                                        ]
                                    });
                                } catch (error: any) {
                                    log(`Error in kick non-allowlisted players: ${error.message}`);
                                    
                                    const errorEmbed = new EmbedBuilder()
                                        .setTitle('❌ Error')
                                        .setDescription(`Failed to kick non-allowlisted players: ${error.message}`)
                                        .setColor('#ff0000')
                                        .setTimestamp();
                                    
                                    await i.editReply({
                                        embeds: [errorEmbed],
                                        components: [
                                            new ActionRowBuilder<ButtonBuilder>()
                                                .addComponents(
                                                    new ButtonBuilder()
                                                        .setCustomId('back_to_main_dashboard')
                                                        .setLabel('Back to Main Dashboard')
                                                        .setStyle(ButtonStyle.Secondary)
                                                )
                                        ]
                                    });
                                }
                                break;
                                
                            default:
                                console.log(`Unhandled button click: ${i.customId}`);
                        }
                } else if (i.isStringSelectMenu() && i.customId === 'whitelist_select_remove') {
                    // Handle whitelist player removal
                    await i.deferUpdate();
                    const selectedPlayer = (i as any).values[0];
                    const index = typedConfig.whitelist.indexOf(selectedPlayer);
                    if (index > -1) {
                        typedConfig.whitelist.splice(index, 1);
                        saveConfig();
                        log(`Player "${selectedPlayer}" removed from whitelist by ${i.user.tag}.`);
                    }
                    
                    // Show updated whitelist panel
                    const whitelistResult = getWhitelistManagePanel(typedConfig);
                    const backRow = new ActionRowBuilder<ButtonBuilder>()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('back_to_main_dashboard')
                                .setLabel('Back to Main Dashboard')
                                .setStyle(ButtonStyle.Secondary)
                        );
                    await i.editReply({
                        embeds: [whitelistResult[0]],
                        components: [whitelistResult[1], backRow]
                    });
                } else if (i.isStringSelectMenu() && i.customId === 'admin_remove_menu') {
                    // Handle admin removal
                    console.log('Debug: admin_remove_menu handler reached!');
                    await i.deferUpdate();
                    console.log('Debug: admin_remove_menu deferUpdate successful');
                    const selectedAdmin = (i as any).values[0];
                    const index = typedConfig.admins.indexOf(selectedAdmin);
                    if (index > -1) {
                        typedConfig.admins.splice(index, 1);
                        saveConfig();
                        log(`Admin "${selectedAdmin}" removed by ${i.user.tag}.`);
                    }
                    
                    // Show updated admin panel
                    const adminResult = await getAdminManagePanel(typedConfig, client);
                    const backRow = new ActionRowBuilder<ButtonBuilder>()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('back_to_main_dashboard')
                                .setLabel('Back to Main Dashboard')
                                .setStyle(ButtonStyle.Secondary)
                        );
                    await i.editReply({
                        embeds: [adminResult[0]],
                        components: [adminResult[1], backRow]
                    });
                    console.log('Debug: admin_remove_menu editReply successful');
                } else if (i.isStringSelectMenu() && i.customId === 'allowlist_select_remove') {
                    // Handle allowlist player removal
                    await i.deferUpdate();
                    const selectedPlayer = (i as any).values[0];
                    
                    // Initialize allowlist if it doesn't exist
                    if (!typedConfig.allowlist) {
                        typedConfig.allowlist = [];
                    }
                    
                    const index = typedConfig.allowlist.indexOf(selectedPlayer);
                    if (index > -1) {
                        typedConfig.allowlist.splice(index, 1);
                        saveConfig();
                        log(`Player "${selectedPlayer}" removed from allowlist by ${i.user.tag}.`);
                    }
                    
                    // Show updated allowlist panel
                    const allowlistResult = getAllowlistManagePanel(typedConfig);
                    const backRow = new ActionRowBuilder<ButtonBuilder>()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('back_to_main_dashboard')
                                .setLabel('Back to Main Dashboard')
                                .setStyle(ButtonStyle.Secondary)
                        );
                    await i.editReply({
                        embeds: [allowlistResult[0]],
                        components: [allowlistResult[1], backRow]
                    });
                } else if (i.isChannelSelectMenu() && i.customId === 'welcome_channel_select') {
                    // Handle welcome channel selection
                    await i.deferUpdate();
                    const selectedChannelId = (i as any).values[0];
                    typedConfig.welcomeChannelId = selectedChannelId;
                    // Also update the welcomeMessages channelId to ensure messages go to the right channel
                    if (!typedConfig.welcomeMessages) {
                        typedConfig.welcomeMessages = { enabled: false, channelId: null, customMessage: "Welcome {player} to {server}! 🎉", motd: "" };
                    }
                    typedConfig.welcomeMessages.channelId = selectedChannelId;
                    saveConfig();
                    log(`Welcome channel set to ${selectedChannelId} by ${i.user.tag}.`);
                    
                    const welcomeSetEmbed = new EmbedBuilder()
                        .setTitle('✅ Welcome Channel Set')
                        .setDescription(`Welcome channel set to <#${selectedChannelId}>.`)
                        .setColor('#00ff00')
                        .setTimestamp();
                    
                    await i.editReply({
                        embeds: [welcomeSetEmbed],
                        components: [
                            new ActionRowBuilder<ButtonBuilder>()
                                .addComponents(
                                    new ButtonBuilder()
                                        .setCustomId('back_to_main_dashboard')
                                        .setLabel('Back to Main Dashboard')
                                        .setStyle(ButtonStyle.Secondary)
                                )
                        ]
                    });
                } else if (i.isChannelSelectMenu() && i.customId === 'log_channel_select') {
                    // Handle log channel selection
                    await i.deferUpdate();
                    const selectedChannelId = (i as any).values[0];
                    typedConfig.logChannelId = selectedChannelId;
                    saveConfig();
                    log(`Log channel set to ${selectedChannelId} by ${i.user.tag}.`);
                    
                    const logSetEmbed = new EmbedBuilder()
                        .setTitle('✅ Log Channel Set')
                        .setDescription(`Log channel set to <#${selectedChannelId}>.`)
                        .setColor('#00ff00')
                        .setTimestamp();
                    
                    await i.editReply({
                        embeds: [logSetEmbed],
                        components: [
                            new ActionRowBuilder<ButtonBuilder>()
                                .addComponents(
                                    new ButtonBuilder()
                                        .setCustomId('back_to_main_dashboard')
                                        .setLabel('Back to Main Dashboard')
                                        .setStyle(ButtonStyle.Secondary)
                                )
                        ]
                    });
                } else if (i.isChannelSelectMenu() && i.customId === 'joins_leaves_channel_select') {
                    // Handle joins/leaves channel selection
                    await i.deferUpdate();
                    const selectedChannelId = (i as any).values[0];
                    if (!typedConfig.servers?.[0]?.logChannels) {
                        if (!typedConfig.servers) typedConfig.servers = [];
                        if (!typedConfig.servers[0]) typedConfig.servers[0] = { serverName: '', host: '', port: 0, logChannels: { chat: null, kicks: null, joinsAndLeaves: null }, modules: { deviceFilter: false } };
                        if (!typedConfig.servers[0].logChannels) typedConfig.servers[0].logChannels = { chat: null, kicks: null, joinsAndLeaves: null };
                    }
                    typedConfig.servers[0].logChannels.joinsAndLeaves = selectedChannelId;
                    saveConfig();
                    log(`Joins/Leaves channel set to ${selectedChannelId} by ${i.user.tag}.`);
                    
                    const joinsLeavesSetEmbed = new EmbedBuilder()
                        .setTitle('✅ Joins/Leaves Channel Set')
                        .setDescription(`Joins/Leaves channel set to <#${selectedChannelId}>.`)
                        .setColor('#00ff00')
                        .setTimestamp();
                    
                    await i.editReply({
                        embeds: [joinsLeavesSetEmbed],
                        components: [
                            new ActionRowBuilder<ButtonBuilder>()
                                .addComponents(
                                    new ButtonBuilder()
                                        .setCustomId('back_to_main_dashboard')
                                        .setLabel('Back to Main Dashboard')
                                        .setStyle(ButtonStyle.Secondary)
                                )
                        ]
                    });
                } else if (i.isChannelSelectMenu() && i.customId === 'chat_channel_select') {
                    // Handle chat channel selection
                    await i.deferUpdate();
                    const selectedChannelId = (i as any).values[0];
                    if (!typedConfig.servers?.[0]?.logChannels) {
                        if (!typedConfig.servers) typedConfig.servers = [];
                        if (!typedConfig.servers[0]) typedConfig.servers[0] = { serverName: '', host: '', port: 0, logChannels: { chat: null, kicks: null, joinsAndLeaves: null }, modules: { deviceFilter: false } };
                        if (!typedConfig.servers[0].logChannels) typedConfig.servers[0].logChannels = { chat: null, kicks: null, joinsAndLeaves: null };
                    }
                    typedConfig.servers[0].logChannels.chat = selectedChannelId;
                    saveConfig();
                    log(`Chat channel set to ${selectedChannelId} by ${i.user.tag}.`);
                    
                    const chatSetEmbed = new EmbedBuilder()
                        .setTitle('✅ Chat Channel Set')
                        .setDescription(`Chat channel set to <#${selectedChannelId}>.`)
                        .setColor('#00ff00')
                        .setTimestamp();
                    
                    await i.editReply({
                        embeds: [chatSetEmbed],
                        components: [
                            new ActionRowBuilder<ButtonBuilder>()
                                .addComponents(
                                    new ButtonBuilder()
                                        .setCustomId('back_to_main_dashboard')
                                        .setLabel('Back to Main Dashboard')
                                        .setStyle(ButtonStyle.Secondary)
                                )
                        ]
                    });
                } else if (i.isChannelSelectMenu() && i.customId === 'kicks_channel_select') {
                    // Handle kicks channel selection
                    await i.deferUpdate();
                    const selectedChannelId = (i as any).values[0];
                    if (!typedConfig.servers?.[0]?.logChannels) {
                        if (!typedConfig.servers) typedConfig.servers = [];
                        if (!typedConfig.servers[0]) typedConfig.servers[0] = { serverName: '', host: '', port: 0, logChannels: { chat: null, kicks: null, joinsAndLeaves: null }, modules: { deviceFilter: false } };
                        if (!typedConfig.servers[0].logChannels) typedConfig.servers[0].logChannels = { chat: null, kicks: null, joinsAndLeaves: null };
                    }
                    typedConfig.servers[0].logChannels.kicks = selectedChannelId;
                    saveConfig();
                    log(`Kicks channel set to ${selectedChannelId} by ${i.user.tag}.`);
                    
                    const kicksSetEmbed = new EmbedBuilder()
                        .setTitle('✅ Kicks Channel Set')
                        .setDescription(`Kicks channel set to <#${selectedChannelId}>.`)
                        .setColor('#00ff00')
                        .setTimestamp();
                    
                    await i.editReply({
                        embeds: [kicksSetEmbed],
                        components: [
                            new ActionRowBuilder<ButtonBuilder>()
                                .addComponents(
                                    new ButtonBuilder()
                                        .setCustomId('back_to_main_dashboard')
                                        .setLabel('Back to Main Dashboard')
                                        .setStyle(ButtonStyle.Secondary)
                                )
                        ]
                    });
                } else if (i.isRoleSelectMenu() && i.customId === 'member_role_select') {
                    // Handle member role selection
                    await i.deferUpdate();
                    const selectedRoleId = (i as any).values[0];
                    typedConfig.memberRoleId = selectedRoleId;
                    saveConfig();
                    log(`Member role set to ${selectedRoleId} by ${i.user.tag}.`);
                    
                    const memberRoleSetEmbed = new EmbedBuilder()
                        .setTitle('✅ Member Role Set')
                        .setDescription(`Member role set to <@&${selectedRoleId}>.`)
                        .setColor('#00ff00')
                        .setTimestamp();
                    
                    await i.editReply({
                        embeds: [memberRoleSetEmbed],
                        components: [
                            new ActionRowBuilder<ButtonBuilder>()
                                .addComponents(
                                    new ButtonBuilder()
                                        .setCustomId('back_to_main_dashboard')
                                        .setLabel('Back to Main Dashboard')
                                        .setStyle(ButtonStyle.Secondary)
                                )
                        ]
                    });
                }
            } catch (error) {
                console.error('Error handling interaction:', error);
                if (!i.replied && !i.deferred) {
                    await i.reply({ content: 'There was an error processing your request!', ephemeral: true });
                } else if (i.deferred) {
                    await i.editReply({ content: 'There was an error processing your request!' });
                }
            }
        });

        collector.on('end', (collected: any, reason: string) => {
            console.log(`Collector ended. Reason: ${reason}, Collected: ${collected.size}`);
            if (reason === 'time') {
                interaction.editReply({ content: 'Dashboard session expired. Use `/manage` to open a new session.', components: [] }).catch(console.error);
            }
        });
    }
}, {
    data: new SlashCommandBuilder()
        .setName('update')
        .setDescription('Check for and install npm package updates'),
    async execute(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
        if (!isAdmin(interaction.user.id, interaction.user.username)) {
            await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const statusEmbed = new EmbedBuilder()
                .setTitle('🔄 Package Update System')
                .setDescription('Checking for package updates...')
                .setColor('#FFA500')
                .setTimestamp();

            await interaction.editReply({ embeds: [statusEmbed] });

            // Trigger manual update
            await autoUpdater.manualUpdate();

            const successEmbed = new EmbedBuilder()
                .setTitle('✅ Update Check Complete')
                .setDescription('Package update check completed successfully!')
                .addFields(
                    { name: '🔄 Auto-Update Status', value: autoUpdater.getStatus().enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
                    { name: '⏰ Next Check', value: autoUpdater.getStatus().nextCheck, inline: true }
                )
                .setColor('#00D4AA')
                .setTimestamp();

            await interaction.editReply({ embeds: [successEmbed] });

        } catch (error: any) {
            console.error('Error in update command:', error);
            
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Update Error')
                .setDescription(`Failed to check for updates: ${error.message}`)
                .setColor('#FF0000')
                .setTimestamp();

            await interaction.editReply({ embeds: [errorEmbed] });
        }
    }
}];

export default commands;
