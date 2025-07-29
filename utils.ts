import * as discord from 'discord.js';
import * as fs from 'fs';
import config from './config.json';

let client: discord.Client | null = null; // <-- Ensure this is set from your main file

// Get player rank based on playtime and rewards configuration
function getPlayerRank(username: string): { rank: string; color: string } | null {
    try {
        // Read config dynamically to get latest data
        const configData = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
        
        // Check if rewards system is enabled
        if (!configData.rewardsConfig?.enabled || !configData.rewardsConfig?.milestones) {
            return null;
        }
        
        // Get player stats
        const playerStats = configData.playerStats?.[username];
        if (!playerStats) {
            return null;
        }
        
        // Calculate total playtime including current session
        let totalPlaytime = playerStats.totalPlaytime || 0;
        if (playerStats.sessionStart) {
            const sessionTime = Date.now() - playerStats.sessionStart;
            totalPlaytime += sessionTime;
        }
        
        const totalMinutes = Math.floor(totalPlaytime / (1000 * 60));
        
        // Find the highest milestone the player has achieved
        const milestones = configData.rewardsConfig.milestones
            .sort((a: any, b: any) => b.timeMinutes - a.timeMinutes); // Sort descending
        
        for (const milestone of milestones) {
            if (totalMinutes >= milestone.timeMinutes) {
                // Extract rank name from reward (remove emojis and extra text)
                const rankName = milestone.reward.replace(/[🌟⚔️🏆👑💎🔥]/g, '').trim();
                
                // Assign colors based on rank name
                const colorMap: { [key: string]: string } = {
                    'God': '§4', // Dark Red
                    'Legend': '§5', // Purple
                    'Elite': '§c', // Red
                    'Veteran': '§6', // Gold
                    'Member': '§b', // Aqua
                    'Regular': '§a', // Green
                    'Newcomer': '§f', // White
                    'Warrior': '§6', // Gold
                    'Champion': '§b', // Aqua
                    'Master': '§c', // Red
                };
                
                const color = colorMap[rankName] || colorMap[milestone.reward] || '§7'; // Default gray
                return { rank: rankName, color };
            }
        }
        
        return null;
    } catch (error) {
        log('Error reading config for player rank:', error);
        return null;
    }
}

// Allow setting client externally
function setClient(c: discord.Client): void {
    client = c;
}

// Logging function
function log(...text: any[]): void {
    const timestamp = new Date().toLocaleString();
    console.log(timestamp, '|', ...text);
    
    // Also send to Discord log channel if configured
    try {
        const fs = require('fs');
        const configPath = './config.json';
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (config.logChannelId && client) {
                const logMessage = text.join(' ');
                sendEmbed({
                    title: '📋 Bot Log',
                    description: `\`\`\`\n${logMessage}\`\`\``,
                    color: '#5865F2',
                    channelId: config.logChannelId,
                    timestamp: true
                }).catch(err => {
                    // Don't log this error to avoid infinite loops
                    console.error('Failed to send log to Discord:', err.message);
                });
            }
        }
    } catch (err) {
        // Silently fail to avoid breaking the logging system
    }
}

interface SendEmbedOptions {
    title?: string;
    description: string;
    color?: discord.ColorResolvable;
    channelId: string;
    timestamp?: boolean;
    thumbnail?: string;
    image?: string;
    author?: {
        name: string;
        iconURL?: string;
        url?: string;
    };
    footer?: {
        text: string;
        iconURL?: string;
    };
    fields?: {
        name: string;
        value: string;
        inline?: boolean;
    }[];
    url?: string;
}

// Send Embed to Discord Channel (object-based)
async function sendEmbed({ 
    title = "Bot Message", 
    description, 
    color = '#5865F2', 
    channelId, 
    timestamp = true,
    thumbnail,
    image,
    author,
    footer,
    fields,
    url
}: SendEmbedOptions): Promise<void> {
    const embed = new discord.EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color);

    if (timestamp) embed.setTimestamp();
    if (thumbnail) embed.setThumbnail(thumbnail);
    if (image) embed.setImage(image);
    if (url) embed.setURL(url);
    
    if (author) {
        embed.setAuthor({
            name: author.name,
            iconURL: author.iconURL,
            url: author.url
        });
    }
    
    if (footer) {
        embed.setFooter({
            text: footer.text,
            iconURL: footer.iconURL
        });
    }
    
    if (fields && fields.length > 0) {
        embed.addFields(fields);
    }

    try {
        if (!client) {
            throw new Error('Discord client not set');
        }
        
        const channel = await client.channels.fetch(channelId);
        if (!channel || !channel.isTextBased()) {
            throw new Error('Channel not found or not text-based');
        }
        
        if (channel && 'send' in channel) {
            await channel.send({ embeds: [embed] });
        }
    } catch (err: any) {
        log("Error sending embed:", err.message);
    }
}

export { log, sendEmbed, setClient, getPlayerRank };