import axios from 'axios';
import * as AF from 'prismarine-auth';
import * as bedrock from 'bedrock-protocol';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import config from './config.json';
import { log, sendEmbed, setClient, getPlayerRank } from './utils';
import * as discord from 'discord.js';
import { backupManager } from './backup';
import { activityTracker } from './activity';
import { securityMonitor } from './security';
import { autoUpdater } from './auto-update';
import { checkAndSaveMilestoneProgress } from './commands/commands';



interface ServerConfig {
    serverName: string;
    host: string;
    port: number;
    logChannels: {
        joinsAndLeaves: string;
        kicks: string;
        chat: string;
    };
}

interface Config {
    username: string;
    servers: ServerConfig[];
    whitelist: string[];
    bannedPlayers?: string[];
    bannedDevices?: string[];
    altSystem?: {
        maxGamerScore: number;
        maxFriends: number;
        maxFollowers: number;
    };
    playerStats?: {
        [username: string]: {
            joinCount: number;
            sessionStart?: number;
            totalPlaytime: number;
            lastSeen: number;
        };
    };
    logging?: {
        detailedLogs?: boolean;
        logToFile?: boolean;
        logCommands?: boolean;
    };
    security?: {
        enabled?: boolean;
        alertChannelId?: string | null;
        rapidJoinThreshold?: number;
        rapidJoinWindow?: number;
        logToFile?: boolean;
    };
    welcomeMessages?: {
        enabled: boolean;
        channelId: string | null;
        customMessage?: string;
        motd?: string;
    };
    allowlist?: string[];
    maintenanceMode?: {
        enabled: boolean;
        enabledBy: string;
        enabledAt: number;
        reason: string;
    };
    keywordAlerts?: {
        enabled: boolean;
        alertChannelId: string;
        keywords: string[];
    };
    commandUsageMonitor?: {
        enabled: boolean;
        logChannelId: string;
    };
}

interface PlayerData {
    username: string;
    xbox_user_id: string;
    build_platform: number | string;
    runtime_entity_id?: number;
}

interface PlayerEntry {
    data: PlayerData;
    lastSeen: number;
}

interface AltCheckResult {
    isAlt: boolean;
    gamerScore?: number;
    friendsCount?: number;
    followersCount?: number;
}

interface XboxAuth {
    userHash: string;
    XSTSToken: string;
}

const typedConfig = config as Config;

let discordClient: discord.Client | null = null;
const serverConfig = typedConfig.servers && typedConfig.servers[0];

// Function to apply rank tags to a player
function applyPlayerRank(client: any, playerName: string) {
    const playerRank = getPlayerRank(playerName);
    
    if (playerRank) {
        try {
            // Add the current rank tag with color (without removing existing ones)
            sendCommand(client, `/tag "${playerName}" add "${playerRank.color}${playerRank.rank}§r"`);
            log(`Applied colored rank tag "${playerRank.color}${playerRank.rank}§r" to player ${playerName}`);
            
            // Announce rank achievement to all players with color
            const rankDisplayCommand = `/tellraw @a {"rawtext":[{"text":"${playerRank.color}🎉 ${playerName} achieved rank: ${playerRank.color}${playerRank.rank}§r!"}]}`;
            sendCommand(client, rankDisplayCommand);
            log(`Announced rank achievement for ${playerName}: ${playerRank.rank}`);
            
            return playerRank;
        } catch (err: any) {
            log(`Error applying rank tag to player: ${err.message}`);
        }
    }
    
    return null;
}

// Check if we have server config
if (!serverConfig) {
    throw new Error('No server configuration found');
}

function isServerConfigured(server: ServerConfig | undefined): server is ServerConfig {
    return !!(server && server.host && server.port && 
           server.host !== 'your.server.ip' && server.host.trim() !== '' &&
           server.port !== 0);
}

const serverIsConfigured = isServerConfigured(serverConfig);

let activeConfig: ServerConfig;
if (serverIsConfigured) {
    activeConfig = serverConfig;
} else {
    throw new Error('No valid server configuration found. Please check your config.json');
}
if (!activeConfig.logChannels) throw new Error('No log channels configured');

const players = new Map<string, PlayerEntry>();
const clients = new Map<string, any>();
const entityToPlayer = new Map<number, string>(); // Map entity IDs to player usernames
let globalClient: any = null;

// Helper function to get player username by entity ID
function getPlayerByEntityId(entityId: number): string | null {
    return entityToPlayer.get(entityId) || null;
}

const devicetotid: Record<string, string> = {
    "Android": "1739947436",
    "iOS": "1810924247",
    "Xbox": "1828326430",
    "Windows": "896928775",
    "PlayStation": "2044456598",
    "FireOS": "1944307183",
    "NintendoSwitch": "2047319603"
};

const tidtodevice: Record<string, string> = {
    "1739947436": "Android",
    "1810924247": "iOS",
    "1828326430": "Xbox",
    "896928775": "Windows",
    "2044456598": "PlayStation",
    "1944307183": "FireOS",
    "2047319603": "NintendoSwitch"
};

const devices: string[] = [
    "Undefined", "Android", "iOS", "OSX", "FireOS", "GearVR", "Hololens",
    "Windows", "Win32", "Dedicated", "TVOS", "PlayStation", "NintendoSwitch",
    "Xbox", "WindowsPhone"
];

const LEAVE_THRESHOLD = 7000;

// --- Helper: Invalid Character Check ---
function hasInvalidCharacters(name: string): boolean {
    const validPattern = /^[a-zA-Z0-9_-]+$/;
    return !validPattern.test(name);
}

// --- Helper: Alt Account Check ---
async function isAltAccount(xuid: string, username: string, auth: XboxAuth): Promise<AltCheckResult> {
    try {
        const response = await axios.get(`https://profile.xboxlive.com/users/xuid(${xuid})/profile/settings`, {
            headers: {
                "Authorization": `XBL3.0 x=${auth.userHash};${auth.XSTSToken}`,
                "Accept": "application/json",
                "x-xbl-contract-version": "2"
            },
            params: {
                settings: 'Gamerscore,People,Followers'
            }
        });

        const settings = response.data.profileUsers[0].settings.reduce((acc: Record<string, string>, setting: any) => {
            acc[setting.id] = setting.value;
            return acc;
        }, {});

        const gamerScore = parseInt(settings.Gamerscore || "0", 10);
        const friendsCount = parseInt(settings.People || "0", 10);
        const followersCount = parseInt(settings.Followers || "0", 10);

        log(`Alt Check for ${username}: Gamerscore=${gamerScore}, Friends=${friendsCount}, Followers=${followersCount}`);

        if (typedConfig.altSystem && (
            gamerScore < typedConfig.altSystem.maxGamerScore ||
            friendsCount < typedConfig.altSystem.maxFriends ||
            followersCount < typedConfig.altSystem.maxFollowers)) {
            return { isAlt: true, gamerScore, friendsCount, followersCount };
        }

        return { isAlt: false };
    } catch (err: any) {
        log(`Error checking alt for ${username}: ${err.message}`);
        return { isAlt: false };
    }
}

function sendCommand(client: any, command: string): void {
    try {
        // Log commands if enabled
        if (typedConfig.logging?.logCommands) {
            log(`[COMMAND] Executing: ${command}`);
        }
        
        client.write('command_request', {
            command,
            origin: { type: 'player', uuid: uuidv4(), request_id: uuidv4() },
            internal: true,
            version: 52,
        });
    } catch (err: any) {
        log(`Error sending command: ${err.message}`);
    }
}

function setDiscordClient(client: discord.Client): void {
    discordClient = client;
    setClient(client); // Also set the client in utils.ts
    log('Discord client set:', discordClient ? 'Connected' : 'Not connected');
}

function getDiscordClient(): discord.Client | null {
    return discordClient;
}

async function spawnBot(): Promise<any> {
    const authFlow = new AF.Authflow(typedConfig.username, './accounts', {
        authTitle: AF.Titles.MinecraftNintendoSwitch,
        deviceType: 'Nintendo',
        flow: 'live',
    });

    let client: any;
    let connectionKey: string;
    
    // Connect to server using IP and port
    client = bedrock.createClient({
        username: typedConfig.username,
        profilesFolder: './accounts',
        host: activeConfig.host,
        port: activeConfig.port,
        conLog: log,
    } as any);
    
    // Initialize automatic backup system
    backupManager.autoBackup();
    log('🔄 Automatic backup system initialized');
    connectionKey = `${activeConfig.host}:${activeConfig.port}`;
    log(`Connecting to server: ${activeConfig.serverName} at ${activeConfig.host}:${activeConfig.port}`);

    const auth = await authFlow.getXboxToken() as XboxAuth;
    clients.set(connectionKey, client);
    globalClient = client;
    
    client.on('spawn', () => {
        log(`Bot spawned in server: ${activeConfig.serverName}`);
    });
    
    // Skin checks removed per user request
     
     client.on('command_response', (packet: any) => {
        log(`[DEBUG] Command response received:`, JSON.stringify(packet, null, 2));
    });

    client.on('command_output', (packet: any) => {
        log(`[DEBUG] Command output received:`, JSON.stringify(packet, null, 2));
    });

    client.on('player_list', async (packet: any) => {
        if (!packet.records || !packet.records.records) return;

        const currentPlayers = new Set<string>();

        for (const player of packet.records.records) {
            if (!player || !player.username || player.username === client.username) continue;

            const username: string = player.username;
            const xuid: string = player.xbox_user_id;
            const osRaw = player.build_platform;
            const os: string = typeof osRaw === 'number' ? devices[osRaw] : osRaw;
            currentPlayers.add(username);

            // --- Invalid Character Detection ---
            if (hasInvalidCharacters(username)) {
                log(`Kicking ${username} - invalid characters in name`);
                sendCommand(client, `/kick "${username}" Invalid characters in name`);
                sendEmbed({
                    title: '🚫 Player Kicked',
                    description: `**Player:** ${username}\n**Reason:** Invalid characters in name\n\n*Automatic security measure to protect server integrity*`,
                    color: '#FF4757',
                    channelId: activeConfig.logChannels.kicks,
                    timestamp: true,
                    thumbnail: 'https://cdn.discordapp.com/emojis/1234567890123456789.png',
                    footer: {
                        text: 'FairplayX Security System',
                        iconURL: 'https://cdn.discordapp.com/emojis/1234567890123456789.png'
                    },
                    fields: [
                        {
                            name: '⚠️ Security Alert',
                            value: 'Player name contained invalid characters',
                            inline: true
                        },
                        {
                            name: '🔧 Action Taken',
                            value: 'Automatic kick executed',
                            inline: true
                        }
                    ]
                });
                players.delete(username);
                continue;
            }

            // --- Alt Detection System ---
            if (!typedConfig.whitelist.includes(username) && typedConfig.altSystem) {
                const altCheck = await isAltAccount(xuid, username, auth);
                if (altCheck.isAlt) {
                    log(`Kicking ${username} - Alt detected (G:${altCheck.gamerScore}, F:${altCheck.friendsCount}, Fo:${altCheck.followersCount})`);
                    securityMonitor.logSecurityEvent(
                        'alt_detection',
                        username,
                        `Alt account detected - Gamerscore: ${altCheck.gamerScore}, Friends: ${altCheck.friendsCount}, Followers: ${altCheck.followersCount}`,
                        'high'
                    );
                    sendCommand(client, `/kick "${username}" Alt accounts are not allowed`);
                    sendEmbed({
                        title: '🔍 Alt Account Detected',
                        description: `**Player:** ${username}\n**Reason:** Detected as alt account\n\n*Advanced detection algorithms identified suspicious account patterns*`,
                        color: '#FF6B35',
                        channelId: activeConfig.logChannels.kicks,
                        timestamp: true,
                        thumbnail: 'https://cdn.discordapp.com/emojis/1234567890123456789.png',
                        footer: {
                            text: 'FairplayX Alt Detection System',
                            iconURL: 'https://cdn.discordapp.com/emojis/1234567890123456789.png'
                        },
                        fields: [
                            {
                                name: '🎮 Gamerscore',
                                value: (altCheck.gamerScore ?? 0).toString(),
                                inline: true
                            },
                            {
                                name: '👥 Friends',
                                value: (altCheck.friendsCount ?? 0).toString(),
                                inline: true
                            },
                            {
                                name: '👤 Followers',
                                value: (altCheck.followersCount ?? 0).toString(),
                                inline: true
                            }
                        ]
                    });
                    players.delete(username);
                    continue;
                }
            }

            // --- Banned Player Check ---
            if (typedConfig.bannedPlayers && typedConfig.bannedPlayers.includes(username)) {
                log(`Kicking ${username} - player is banned`);
                securityMonitor.logSecurityEvent(
                    'banned_player_attempt',
                    username,
                    'Banned player attempted to join the server',
                    'high'
                );
                sendCommand(client, `/kick "${username}" You are banned from this server`);
                sendEmbed({
                    title: '🔨 Banned Player Detected',
                    description: `**Player:** ${username}\n**Reason:** Player is banned\n\n*This player is on the server ban list and was automatically removed*`,
                    color: '#DC143C',
                    channelId: activeConfig.logChannels.kicks,
                    timestamp: true,
                    thumbnail: 'https://cdn.discordapp.com/emojis/1234567890123456789.png',
                    footer: {
                        text: 'FairplayX Ban System',
                        iconURL: 'https://cdn.discordapp.com/emojis/1234567890123456789.png'
                    },
                    fields: [
                        {
                            name: '⛔ Status',
                            value: 'Permanently Banned',
                            inline: true
                        },
                        {
                            name: '🔧 Action',
                            value: 'Automatic Removal',
                            inline: true
                        }
                    ]
                });
                players.delete(username);
                continue;
            }

            // --- Maintenance Mode Check ---
            if (typedConfig.maintenanceMode?.enabled && (!typedConfig.allowlist || !typedConfig.allowlist.includes(username))) {
                log(`Kicking ${username} - server in maintenance mode (not allowlisted)`);
                securityMonitor.logSecurityEvent(
                    'maintenance_kick',
                    username,
                    'Non-allowlisted player kicked during maintenance mode',
                    'medium'
                );
                sendCommand(client, `/kick "${username}" Server is in maintenance mode. Only allowlisted players can join.`);
                sendEmbed({
                    title: '🔧 Maintenance Mode Active',
                    description: `**Player:** ${username}\n**Reason:** ${typedConfig.maintenanceMode.reason || 'Server maintenance in progress'}\n\n*Only allowlisted players can join during maintenance*`,
                    color: '#FFA500',
                    channelId: activeConfig.logChannels.kicks,
                    timestamp: true,
                    thumbnail: 'https://cdn.discordapp.com/emojis/1234567890123456789.png',
                    footer: {
                        text: 'FairplayX Maintenance System',
                        iconURL: 'https://cdn.discordapp.com/emojis/1234567890123456789.png'
                    },
                    fields: [
                        {
                            name: '🔧 Status',
                            value: 'Maintenance Active',
                            inline: true
                        },
                        {
                            name: '👤 Enabled By',
                            value: typedConfig.maintenanceMode.enabledBy || 'System',
                            inline: true
                        },
                        {
                            name: '⏰ Started',
                            value: typedConfig.maintenanceMode.enabledAt ? new Date(typedConfig.maintenanceMode.enabledAt).toLocaleString() : 'Unknown',
                            inline: true
                        }
                    ]
                });
                players.delete(username);
                continue;
            }

            if (!players.has(username)) {
                players.set(username, { data: player, lastSeen: Date.now() });
                
                // Map entity ID to player username for anticheat
                if (player.runtime_entity_id) {
                    entityToPlayer.set(player.runtime_entity_id, username);
                }
                
                // Track activity
                activityTracker.trackPlayerJoin(username);
                
                // Check for rapid joins
                securityMonitor.checkRapidJoins(username);
                
                // Apply player rank when they join
                applyPlayerRank(client, username);
                
                // Update player statistics
                if (!typedConfig.playerStats) {
                    typedConfig.playerStats = {};
                }
                if (!typedConfig.playerStats[username]) {
                    typedConfig.playerStats[username] = {
                        joinCount: 0,
                        totalPlaytime: 0,
                        lastSeen: Date.now(),
                        sessionStart: Date.now()
                    };
                } else {
                    typedConfig.playerStats[username].sessionStart = Date.now();
                }
                typedConfig.playerStats[username].joinCount++;
                typedConfig.playerStats[username].lastSeen = Date.now();
                
                // Save updated config
                            fs.writeFileSync('./config.json', JSON.stringify(typedConfig, null, 2));                
                log(`Player joined: ${username} on ${os}`);
                
                // Enhanced logging
                if (typedConfig.logging?.detailedLogs) {
                    log(`[DETAILED] Player ${username} joined - Device: ${os}, XUID: ${xuid}, Join Count: ${typedConfig.playerStats?.[username]?.joinCount || 0}`);
                }
                
                // Send welcome message if enabled and it's the player's first join
                const joinCount = typedConfig.playerStats?.[username]?.joinCount || 0;
                if (typedConfig.welcomeMessages?.enabled && typedConfig.welcomeMessages.channelId && joinCount === 1) {
                    let customMessage = typedConfig.welcomeMessages.customMessage || `Welcome ${username} to the server!`;
                    // Replace placeholders
                    customMessage = customMessage.replace(/\{player\}/g, username);
                    customMessage = customMessage.replace(/\{server\}/g, typedConfig.servers?.[0]?.serverName || 'the server');
                    const motd = typedConfig.welcomeMessages.motd || '';
                    
                    sendEmbed({
                        title: '🎉 Welcome!',
                        description: `${customMessage}\n\n${motd}`,
                        color: '#00D26A',
                        channelId: typedConfig.welcomeMessages.channelId,
                        timestamp: true,
                        thumbnail: 'https://mc-heads.net/avatar/' + username + '/64',
                        footer: {
                            text: 'FairplayX Welcome System',
                            iconURL: 'https://cdn.discordapp.com/emojis/1234567890123456789.png'
                        },
                        fields: [
                            {
                                name: '👤 Player',
                                value: username,
                                inline: true
                            },
                            {
                                name: '📱 Device',
                                value: os,
                                inline: true
                            },
                            {
                                name: '🎮 Join #',
                                value: typedConfig.playerStats?.[username]?.joinCount?.toString() || '0',
                                inline: true
                            }
                        ]
                    });
                }
                
                // Regular join notification
                sendEmbed({
                    title: '🎉 Player Joined',
                    description: `**Welcome!** ${username} has joined the server\n\n*Playing on ${os}*`,
                    color: '#00D26A',
                    channelId: activeConfig.logChannels.joinsAndLeaves,
                    timestamp: true,
                    thumbnail: 'https://mc-heads.net/avatar/' + username + '/64',
                    footer: {
                        text: 'FairplayX Server Monitor',
                        iconURL: 'https://cdn.discordapp.com/emojis/1234567890123456789.png'
                    },
                    fields: [
                        {
                            name: '📱 Device',
                            value: os,
                            inline: true
                        },
                        {
                            name: '👤 Player',
                            value: username,
                            inline: true
                        },
                        {
                            name: '🌟 Status',
                            value: 'Online',
                            inline: true
                        }
                    ]
                });

                // --- Banned Device Detection ---
                if (!typedConfig.whitelist.includes(username) && typedConfig.bannedDevices && typedConfig.bannedDevices.includes(os)) {
                    log(`Kicking ${username} - banned device: ${os}`);
                    securityMonitor.logSecurityEvent(
                        'device_spoof',
                        username,
                        `Player using banned device: ${os}`,
                        'medium'
                    );
                    sendCommand(client, `/kick "${username}" Banned device ${os} is not allowed`);
                    sendEmbed({
                        title: '📱 Banned Device Detected',
                        description: `**Player:** ${username}\n**Device:** ${os}\n**Reason:** Device is banned\n\n*This device type is not permitted on this server*`,
                        color: '#FF3838',
                        channelId: activeConfig.logChannels.kicks,
                        timestamp: true,
                        thumbnail: 'https://mc-heads.net/avatar/' + username + '/64',
                        footer: {
                            text: 'FairplayX Device Filter',
                            iconURL: 'https://cdn.discordapp.com/emojis/1234567890123456789.png'
                        },
                        fields: [
                            {
                                name: '🚫 Banned Device',
                                value: os,
                                inline: true
                            },
                            {
                                name: '⚡ Action',
                                value: 'Immediate Kick',
                                inline: true
                            }
                        ]
                    });
                    players.delete(username);
                    continue;
                }

                // --- Device Spoof Detection ---
                try {
                    const presence = await axios.get(`https://userpresence.xboxlive.com/users/xuid(${xuid})`, {
                        headers: {
                            "Authorization": `XBL3.0 x=${auth.userHash};${auth.XSTSToken}`,
                            "Accept": "application/json",
                            "x-xbl-contract-version": "3"
                        }
                    });

                    if (presence.data.devices === undefined) {
                        log(`Skipping spoof check for ${username} - private profile`);
                    } else {
                        const activeDevices = presence.data.devices.filter((device: any) =>
                            device.titles.some((title: any) => title.name.startsWith("Minecraft") && title.state === "Active")
                        );

                        if (!activeDevices.length) {
                            log(`Kicking ${username} - No active Minecraft found`);
                            sendCommand(client, `/kick "${username}" No active Minecraft session found`);
                            sendEmbed({
                                title: '🕵️ Spoof Detection Alert',
                                description: `**Player:** ${username}\n**Reason:** No active Minecraft session detected\n\n*Anti-spoof system detected suspicious activity*`,
                                color: '#FF5722',
                                channelId: activeConfig.logChannels.kicks,
                                timestamp: true,
                                thumbnail: 'https://mc-heads.net/avatar/' + username + '/64',
                                footer: {
                                    text: 'FairplayX Anti-Spoof System',
                                    iconURL: 'https://cdn.discordapp.com/emojis/1234567890123456789.png'
                                },
                                fields: [
                                    {
                                        name: '🔍 Detection',
                                        value: 'No Active Session',
                                        inline: true
                                    },
                                    {
                                        name: '🛡️ Protection',
                                        value: 'Spoof Prevention',
                                        inline: true
                                    }
                                ]
                            });
                            players.delete(username);
                            continue;
                        }

                        let foundValidDevice = false;
                        for (const device of activeDevices) {
                            for (const title of device.titles) {
                                if (devicetotid[os] === title.id) {
                                    foundValidDevice = true;
                                    break;
                                }
                            }
                            if (foundValidDevice) break;
                        }

                        if (!foundValidDevice) {
                            let trueDevice = "Unknown";
                            for (const device of activeDevices) {
                                for (const title of device.titles) {
                                    if (devicetotid[os] !== title.id && title.id !== "750323071") {
                                        trueDevice = tidtodevice[title.id] || "Unknown";
                                        break;
                                    }
                                }
                                if (trueDevice !== "Unknown") break;
                            }
                            log(`Kicking ${username} - Device Spoof detected (${os} vs ${trueDevice})`);
                            sendCommand(client, `/kick "${username}" EditionFaker not allowed`);
                            sendEmbed({
                                title: '🎭 EditionFaker Detected',
                                description: `**Player:** ${username}\n**Spoofed Device:** ${os}\n**Real Device:** ${trueDevice}\n\n*Advanced anti-cheat detected device spoofing*`,
                                color: '#E74C3C',
                                channelId: activeConfig.logChannels.kicks,
                                timestamp: true,
                                thumbnail: 'https://mc-heads.net/avatar/' + username + '/64',
                                footer: {
                                    text: 'FairplayX EditionFaker Detection',
                                    iconURL: 'https://cdn.discordapp.com/emojis/1234567890123456789.png'
                                },
                                fields: [
                                    {
                                        name: '🎭 Fake Device',
                                        value: os,
                                        inline: true
                                    },
                                    {
                                        name: '📱 Real Device',
                                        value: trueDevice,
                                        inline: true
                                    },
                                    {
                                        name: '🚨 Threat Level',
                                        value: 'High',
                                        inline: true
                                    }
                                ]
                            });
                            players.delete(username);
                        }
                    }
                } catch (err: any) {
                    log(`Error checking device for ${username}: ${err.message}`);
                }
            } else {
                const entry = players.get(username)!;
                entry.lastSeen = Date.now();
                players.set(username, entry);
            }
        }

        // --- Player Left Check ---
        for (const [username, entry] of players) {
            if (!currentPlayers.has(username)) {
                setTimeout(() => {
                    const currentEntry = players.get(username);
                    if (currentEntry && (Date.now() - currentEntry.lastSeen >= LEAVE_THRESHOLD)) {
                        // Track activity
                        activityTracker.trackPlayerLeave(username);
                        
                        // Clean up entity mapping
                        for (const [entityId, playerName] of entityToPlayer) {
                            if (playerName === username) {
                                entityToPlayer.delete(entityId);
                                break;
                            }
                        }
                        
                        // Calculate session time for Discord before clearing sessionStart
                        const sessionTimeForDiscord = typedConfig.playerStats?.[username]?.sessionStart ? 
                            Math.round((Date.now() - typedConfig.playerStats[username]!.sessionStart) / 60000) : 0;
                        
                        // Update playtime statistics
                        if (typedConfig.playerStats && typedConfig.playerStats[username] && typedConfig.playerStats[username].sessionStart) {
                            const sessionTime = Date.now() - typedConfig.playerStats[username].sessionStart;
                            typedConfig.playerStats[username].totalPlaytime += sessionTime;
                            typedConfig.playerStats[username].lastSeen = Date.now();
                            typedConfig.playerStats[username].sessionStart = undefined; // Clear session start
                            
                            // Check and save milestone progress
                            checkAndSaveMilestoneProgress(username);
                            
                            // Save updated config
                fs.writeFileSync('./config.json', JSON.stringify(typedConfig, null, 2));                            
                            // Enhanced logging
                            if (typedConfig.logging?.detailedLogs) {
                                const sessionMinutes = Math.round(sessionTime / 60000);
                                const totalHours = Math.round(typedConfig.playerStats[username].totalPlaytime / 3600000);
                                log(`[DETAILED] Player ${username} left - Session: ${sessionMinutes}m, Total: ${totalHours}h`);
                            }
                        }
                        
                        players.delete(username);
                        
                        log(`Player left: ${username}`);
                        
                        sendEmbed({
                            title: '👋 Player Left',
                            description: `**Goodbye!** ${username} has left the server\n\n*Thanks for playing!*`,
                            color: '#FF9500',
                            channelId: activeConfig.logChannels.joinsAndLeaves,
                            timestamp: true,
                            thumbnail: 'https://mc-heads.net/avatar/' + username + '/64',
                            footer: {
                                text: 'FairplayX Server Monitor',
                                iconURL: 'https://cdn.discordapp.com/emojis/1234567890123456789.png'
                            },
                            fields: [
                                {
                                    name: '👤 Player',
                                    value: username,
                                    inline: true
                                },
                                {
                                    name: '📊 Status',
                                    value: 'Offline',
                                    inline: true
                                },
                                {
                                    name: '⏰ Session',
                                    value: `${sessionTimeForDiscord}m`,
                                    inline: true
                                }
                            ]
                        });
                    }
                }, LEAVE_THRESHOLD);
            }
        }
    });

    client.on('error', (err: Error) => {
        const connectionName = activeConfig.serverName;
        log(`Bot error in server ${connectionName}: ${err.message}`);
        
        // If it's a serverIdConflict, wait longer before reconnecting
        const delay = err.message.includes('serverIdConflict') ? 30000 : 5000;
        log(`Waiting ${delay/1000} seconds before reconnecting...`);
        setTimeout(() => spawnBot(), delay);
    });

    client.on('kick', (reason: any) => {
        const connectionName = activeConfig.serverName;
        const reasonStr = typeof reason === 'string' ? reason : JSON.stringify(reason);
        log(`Bot was kicked from server ${connectionName}: ${reasonStr}`);
        sendEmbed({
            title: '🤖 Bot Disconnected',
            description: `**Connection Lost**\n**Server:** ${connectionName}\n**Reason:** ${reasonStr}\n\n*Attempting to reconnect...*`,
            color: '#DC143C',
            channelId: activeConfig.logChannels.kicks,
            timestamp: true,
            footer: {
                text: 'FairplayX Connection Monitor',
                iconURL: 'https://cdn.discordapp.com/emojis/1234567890123456789.png'
            },
            fields: [
                {
                    name: '🔌 Connection',
                    value: 'Lost',
                    inline: true
                },
                {
                    name: '🔄 Recovery',
                    value: 'Auto-Reconnect',
                    inline: true
                },
                {
                    name: '⏱️ Delay',
                    value: reasonStr.includes('serverIdConflict') ? '30s' : '5s',
                    inline: true
                }
            ]
        });

        // If it's a serverIdConflict, wait longer and clear any cached data
        if (reasonStr.includes('serverIdConflict')) {
            log('ServerIdConflict detected - waiting 30 seconds and clearing client cache...');
            clients.clear();
            globalClient = null;
            setTimeout(() => spawnBot(), 30000);
        } else {
            setTimeout(() => spawnBot(), 5000);
        }
    });

    // --- Packet Listeners ---
    
    // Monitor text packets for chat relay to Discord
    // Generic packet listener removed per user request

        client.on('text', async (packet: any) => {
        if (!packet) return;
        
        // Debug logging to see what packets we're receiving
        log(`Text packet received: ${JSON.stringify(packet, null, 2)}`);
        
        // Skin change detection removed per user request
        
        let playerName: string | null = null;
        let message = '';
        
        // Handle different packet types to extract player name and message
        // Priority 1: Use XUID to find player name from current players list
        if (packet.xuid && packet.xuid !== '') {
            // Find player by XUID in current players
            for (const [username, playerEntry] of players.entries()) {
                if (playerEntry.data && playerEntry.data.xbox_user_id === packet.xuid) {
                    playerName = username;
                    message = packet.message || '';
                    log(`Player identified by XUID: ${playerName}`);
                    break;
                }
            }
        }
        
        // Priority 2: Use source_name if available and XUID lookup failed
        if (!playerName && packet.source_name) {
            // Verify source_name exists in current players to avoid false matches
            const currentPlayersList = getCurrentPlayers();
            if (currentPlayersList.has(packet.source_name)) {
                playerName = packet.source_name;
                message = packet.message || '';
                log(`Player identified by source_name: ${playerName}`);
            }
        }
        
        // Priority 3: Fallback for JSON messages with complex formatting
        if (!playerName && packet.type === 'json' && packet.message) {
            try {
                const jsonMessage = JSON.parse(packet.message);
                if (jsonMessage.rawtext && Array.isArray(jsonMessage.rawtext)) {
                    const fullText = jsonMessage.rawtext.map((part: any) => part.text || '').join('');
                    
                    // Simple pattern to extract player name from formatted text
                    const match = fullText.match(/§7\| §7([^§]+)§r [0-9]+:[0-9]+ [AP]M: §7(.+)/);
                    if (match) {
                        const potentialPlayer = match[1].trim();
                        const currentPlayersList = getCurrentPlayers();
                        if (currentPlayersList.has(potentialPlayer)) {
                            playerName = potentialPlayer;
                            message = match[2].trim();
                            log(`Player identified from JSON format: ${playerName}`);
                        }
                    }
                }
            } catch (error) {
                // If JSON parsing fails, ignore
            }
        }
        
        // Priority 4: Fallback for chat type packets
        if (!playerName && packet.type === 'chat') {
            const currentPlayersList = getCurrentPlayers();
            if (packet.source_name && currentPlayersList.has(packet.source_name)) {
                playerName = packet.source_name;
                message = packet.message || '';
                log(`Player identified from chat packet: ${playerName}`);
            }
        }
        
        // Skip if no valid player name, system message, or command
        if (!playerName || playerName.includes('§') || playerName === '!§r' || playerName === '' || message.trim() === '') {
            return;
        }
        
        // Skip command messages (messages that start with /)
        if (message.trim().startsWith('/')) {
            if (typedConfig.commandUsageMonitor && typedConfig.commandUsageMonitor.enabled && typedConfig.commandUsageMonitor.logChannelId && discordClient) {
                const alertChannel = await discordClient.channels.fetch(typedConfig.commandUsageMonitor.logChannelId);
                if (alertChannel && alertChannel.isTextBased() && 'send' in alertChannel) {
                    const embed = new discord.EmbedBuilder()
                        .setTitle('Command Usage')
                        .setDescription(`Player **${playerName}** used a command`)
                        .addFields(
                            { name: 'Player', value: playerName, inline: true },
                            { name: 'Command', value: message, inline: true }
                        )
                        .setColor('#FFA500')
                        .setTimestamp();
                    alertChannel.send({ embeds: [embed] });
                }
            }
            return;
        }
        
        // Skip bot's own messages to prevent loops
        if (playerName === typedConfig.username) {
            return;
        }
        
        log(`Chat message from ${playerName}: ${message}`);
        
        // Get player rank and apply it
        const playerRank = applyPlayerRank(client, playerName);
        let displayName = playerName;
        
        if (playerRank) {
            // Update display name for Discord
            displayName = `[${playerRank.rank}] ${playerName}`;
        }
        
        // Relay message to Discord
        if (discordClient && activeConfig && activeConfig.logChannels && activeConfig.logChannels.chat) {
            if (typedConfig.keywordAlerts?.enabled && typedConfig.keywordAlerts?.alertChannelId) {
                const messageContent = message.toLowerCase();
                for (const keyword of typedConfig.keywordAlerts.keywords) {
                    if (messageContent.includes(keyword.toLowerCase())) {
                        if (!discordClient) continue;
                        const alertChannel = await discordClient.channels.fetch(typedConfig.keywordAlerts.alertChannelId);
                        if (alertChannel && alertChannel.isTextBased() && 'send' in alertChannel) {
                            const embed = new discord.EmbedBuilder()
                                .setTitle('Keyword Alert')
                                .setDescription(`Player **${playerName}** said a keyword: **${keyword}**`)
                                .addFields(
                                    { name: 'Player', value: playerName, inline: true },
                                    { name: 'Message', value: message, inline: true }
                                )
                                .setColor('#FF0000')
                                .setTimestamp();
                            alertChannel.send({ embeds: [embed] });
                        }
                        break; // Stop after first keyword match
                    }
                }
            }
            try {
                const cleanMessage = message.replace(/§[0-9a-fk-or]/g, ''); // Remove Minecraft color codes
                sendEmbed({
                    title: '💬 Chat Message',
                    description: `**${displayName}**: ${cleanMessage}`,
                    color: playerRank ? '#FFD700' : '#00FF00', // Gold for ranked players, green for others
                    channelId: activeConfig.logChannels.chat,
                    timestamp: true
                });
                log(`Relayed message to Discord: ${displayName}: ${cleanMessage}`);
            } catch (err: any) {
                log(`Error relaying message to Discord: ${err.message}`);
            }
        }
    });
    
    client.on('command_request', (packet: any) => {
        if (!packet || !packet.origin || !packet.origin.uuid) return;
        
        // We need to find the player name from UUID - this is more complex
        // For now, we'll rely on the text packet monitoring for most cases
        // Commands that produce text output will be caught by the text listener
        
        // Note: Direct command monitoring requires UUID-to-name mapping
        // which would need to be maintained from player_list events
    });
    
    // Command output monitoring removed - Discord relay is now working

    return client;
}

function relayMessageFromDiscordToMinecraft(message: discord.Message): void {
    // Try to use globalClient first, then fall back to clients map
    let client = globalClient;
    
    if (!client) {
        const clientKey = `${activeConfig.host}:${activeConfig.port}`;
        client = clients.get(clientKey);
    }
    
    if (!client) {
        log(`[ERROR] No active client found for Discord relay`);
        return;
    }

    try {
        const username = message.member?.displayName || message.author.username;
        const cleanMessage = message.content.replace(/[§#"\\]/g, '');
        const tellrawCommand = `/tellraw @a {"rawtext":[{"text":"§9[Discord] §f${username} §8» §r${cleanMessage}"}]}`;
        sendCommand(client, tellrawCommand);
    } catch (err: any) {
        log(`Error relaying Discord message: ${err.message}`);
    }
}

// Function to get current players
function getCurrentPlayers(): Set<string> {
    return new Set(players.keys());
}

// Function to get global client
function getGlobalClient(): any {
    return globalClient;
}

// Function to kick all non-allowlisted players
function kickNonAllowlistedPlayers(): number {
    if (!globalClient) {
        log('[ERROR] No active client found for kicking players');
        return 0;
    }

    const allowlist = typedConfig.allowlist || [];
    let kickedCount = 0;

    // Get current online players
    const onlinePlayers = Array.from(players.keys());
    
    for (const username of onlinePlayers) {
        // Skip if player is in allowlist
        if (allowlist.includes(username)) {
            continue;
        }

        try {
            sendCommand(globalClient, `/kick "${username}" Server is in maintenance mode. Only allowlisted players can join.`);
            log(`Kicked non-allowlisted player: ${username}`);
            kickedCount++;
            
            // Log security event
            securityMonitor.logSecurityEvent(
                'maintenance_kick',
                username,
                'Non-allowlisted player kicked during maintenance mode',
                'low'
            );
        } catch (err: any) {
            log(`Error kicking player ${username}: ${err.message}`);
        }
    }

    return kickedCount;
}

export { 
    spawnBot, 
    relayMessageFromDiscordToMinecraft, 
    setDiscordClient, 
    getDiscordClient, 
    getCurrentPlayers, 
    getGlobalClient, 
    sendCommand, 
    kickNonAllowlistedPlayers 
};
