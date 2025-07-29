import { EmbedBuilder, TextChannel } from 'discord.js';
import * as fs from 'fs';
import config from './config.json';

interface SecurityEvent {
    type: 'alt_detection' | 'device_spoof' | 'banned_player_attempt' | 'rapid_joins' | 'suspicious_activity' | 'maintenance_kick';
    player: string;
    details: string;
    timestamp: number;
    severity: 'low' | 'medium' | 'high';
}

interface SecurityConfig {
    enabled: boolean;
    alertChannelId: string | null;
    rapidJoinThreshold: number; // joins per minute
    rapidJoinWindow: number; // time window in minutes
    logToFile: boolean;
}

class SecurityMonitor {
    private events: SecurityEvent[] = [];
    private playerJoinTimes: Map<string, number[]> = new Map();
    private securityLogPath = './security-log.json';

    constructor() {
        this.loadSecurityLog();
    }

    private loadSecurityLog() {
        try {
            if (fs.existsSync(this.securityLogPath)) {
                const data = fs.readFileSync(this.securityLogPath, 'utf8');
                this.events = JSON.parse(data);
            }
        } catch (error) {
            console.error('Failed to load security log:', error);
        }
    }

    private saveSecurityLog() {
        try {
            // Keep only last 1000 events to prevent file from growing too large
            const recentEvents = this.events.slice(-1000);
            fs.writeFileSync(this.securityLogPath, JSON.stringify(recentEvents, null, 2));
        } catch (error) {
            console.error('Failed to save security log:', error);
        }
    }

    private getSecurityConfig(): SecurityConfig {
        const typedConfig = config as any;
        return typedConfig.security || {
            enabled: true,
            alertChannelId: null,
            rapidJoinThreshold: 5,
            rapidJoinWindow: 2,
            logToFile: true
        };
    }

    logSecurityEvent(type: SecurityEvent['type'], player: string, details: string, severity: SecurityEvent['severity'] = 'medium') {
        const securityConfig = this.getSecurityConfig();
        if (!securityConfig.enabled) return;

        const event: SecurityEvent = {
            type,
            player,
            details,
            timestamp: Date.now(),
            severity
        };

        this.events.push(event);
        
        if (securityConfig.logToFile) {
            this.saveSecurityLog();
        }

        console.log(`[SECURITY] ${severity.toUpperCase()}: ${type} - ${player}: ${details}`);

        // Send alert to Discord if configured
        this.sendSecurityAlert(event, securityConfig);
    }

    private async sendSecurityAlert(event: SecurityEvent, securityConfig: SecurityConfig) {
        if (!securityConfig.alertChannelId) return;

        try {
            const { getDiscordClient } = await import('./server');
            const client = getDiscordClient();
            if (!client) return;

            const channel = client.channels.cache.get(securityConfig.alertChannelId) as TextChannel;
            if (!channel) return;

            const severityColors = {
                low: 0xffff00,    // Yellow
                medium: 0xff9900, // Orange
                high: 0xff0000    // Red
            };

            const severityEmojis = {
                low: '⚠️',
                medium: '🚨',
                high: '🔴'
            };

            const embed = new EmbedBuilder()
                .setTitle(`${severityEmojis[event.severity]} Security Alert`)
                .setColor(severityColors[event.severity])
                .addFields(
                    { name: 'Event Type', value: event.type.replace('_', ' ').toUpperCase(), inline: true },
                    { name: 'Player', value: event.player, inline: true },
                    { name: 'Severity', value: event.severity.toUpperCase(), inline: true },
                    { name: 'Details', value: event.details, inline: false },
                    { name: 'Time', value: new Date(event.timestamp).toLocaleString(), inline: true }
                )
                .setTimestamp();

            await channel.send({ embeds: [embed] });
        } catch (error) {
            console.error('Failed to send security alert:', error);
        }
    }

    checkRapidJoins(player: string): boolean {
        const securityConfig = this.getSecurityConfig();
        if (!securityConfig.enabled) return false;

        const now = Date.now();
        const windowMs = securityConfig.rapidJoinWindow * 60 * 1000;
        
        // Get or create join times array for this player
        if (!this.playerJoinTimes.has(player)) {
            this.playerJoinTimes.set(player, []);
        }
        
        const joinTimes = this.playerJoinTimes.get(player)!;
        
        // Add current join time
        joinTimes.push(now);
        
        // Remove old join times outside the window
        const recentJoins = joinTimes.filter(time => now - time <= windowMs);
        this.playerJoinTimes.set(player, recentJoins);
        
        // Check if threshold exceeded
        if (recentJoins.length >= securityConfig.rapidJoinThreshold) {
            this.logSecurityEvent(
                'rapid_joins',
                player,
                `${recentJoins.length} joins in ${securityConfig.rapidJoinWindow} minutes`,
                'high'
            );
            return true;
        }
        
        return false;
    }

    getRecentEvents(hours: number = 24): SecurityEvent[] {
        const cutoff = Date.now() - (hours * 60 * 60 * 1000);
        return this.events.filter(event => event.timestamp >= cutoff);
    }

    getEventsByPlayer(player: string, hours: number = 24): SecurityEvent[] {
        const cutoff = Date.now() - (hours * 60 * 60 * 1000);
        return this.events.filter(event => 
            event.player === player && event.timestamp >= cutoff
        );
    }

    getEventsByType(type: SecurityEvent['type'], hours: number = 24): SecurityEvent[] {
        const cutoff = Date.now() - (hours * 60 * 60 * 1000);
        return this.events.filter(event => 
            event.type === type && event.timestamp >= cutoff
        );
    }

    getSeverityStats(hours: number = 24): { low: number; medium: number; high: number } {
        const recentEvents = this.getRecentEvents(hours);
        return {
            low: recentEvents.filter(e => e.severity === 'low').length,
            medium: recentEvents.filter(e => e.severity === 'medium').length,
            high: recentEvents.filter(e => e.severity === 'high').length
        };
    }

    clearOldEvents(days: number = 30) {
        const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
        this.events = this.events.filter(event => event.timestamp >= cutoff);
        this.saveSecurityLog();
    }
}

export const securityMonitor = new SecurityMonitor();
export { SecurityEvent, SecurityConfig };