import * as fs from 'fs';

// Simple activity tracking for FairplayX
export class ActivityTracker {
    private startTime: Date;
    private playerSessions: Map<string, Date> = new Map();
    private dailyStats: { [date: string]: { joins: number, uniquePlayers: Set<string> } } = {};
    
    constructor() {
        this.startTime = new Date();
        this.loadDailyStats();
    }
    
    private loadDailyStats(): void {
        try {
            if (fs.existsSync('./daily-stats.json')) {
                const data = JSON.parse(fs.readFileSync('./daily-stats.json', 'utf8'));
                // Convert Set back from array
                Object.keys(data).forEach(date => {
                    this.dailyStats[date] = {
                        joins: data[date].joins,
                        uniquePlayers: new Set(data[date].uniquePlayers)
                    };
                });
            }
        } catch (error) {
            console.error('Failed to load daily stats:', error);
        }
    }
    
    private saveDailyStats(): void {
        try {
            // Convert Set to array for JSON serialization
            const dataToSave: any = {};
            Object.keys(this.dailyStats).forEach(date => {
                dataToSave[date] = {
                    joins: this.dailyStats[date].joins,
                    uniquePlayers: Array.from(this.dailyStats[date].uniquePlayers)
                };
            });
            fs.writeFileSync('./daily-stats.json', JSON.stringify(dataToSave, null, 2));
        } catch (error) {
            console.error('Failed to save daily stats:', error);
        }
    }
    
    public trackPlayerJoin(playerName: string): void {
        const today = new Date().toISOString().split('T')[0];
        
        if (!this.dailyStats[today]) {
            this.dailyStats[today] = {
                joins: 0,
                uniquePlayers: new Set()
            };
        }
        
        this.dailyStats[today].joins++;
        this.dailyStats[today].uniquePlayers.add(playerName);
        this.playerSessions.set(playerName, new Date());
        
        this.saveDailyStats();
    }
    
    public trackPlayerLeave(playerName: string): void {
        this.playerSessions.delete(playerName);
    }
    
    public getUptime(): string {
        const now = new Date();
        const uptimeMs = now.getTime() - this.startTime.getTime();
        
        const days = Math.floor(uptimeMs / (1000 * 60 * 60 * 24));
        const hours = Math.floor((uptimeMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((uptimeMs % (1000 * 60)) / 1000);
        
        return `${days}d ${hours}h ${minutes}m ${seconds}s`;
    }
    
    public getCurrentOnlinePlayers(): string[] {
        return Array.from(this.playerSessions.keys());
    }
    
    public getTodayStats(): { joins: number, uniquePlayers: number } {
        const today = new Date().toISOString().split('T')[0];
        const stats = this.dailyStats[today];
        
        return {
            joins: stats?.joins || 0,
            uniquePlayers: stats?.uniquePlayers.size || 0
        };
    }
    
    public getWeeklyStats(): { totalJoins: number, totalUniquePlayers: number, avgDaily: number } {
        const now = new Date();
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        
        let totalJoins = 0;
        const allPlayers = new Set<string>();
        let daysWithData = 0;
        
        Object.keys(this.dailyStats).forEach(dateStr => {
            const date = new Date(dateStr);
            if (date >= weekAgo && date <= now) {
                const stats = this.dailyStats[dateStr];
                totalJoins += stats.joins;
                stats.uniquePlayers.forEach(player => allPlayers.add(player));
                daysWithData++;
            }
        });
        
        return {
            totalJoins,
            totalUniquePlayers: allPlayers.size,
            avgDaily: daysWithData > 0 ? Math.round(totalJoins / daysWithData) : 0
        };
    }
    
    public cleanOldStats(): void {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        Object.keys(this.dailyStats).forEach(dateStr => {
            const date = new Date(dateStr);
            if (date < thirtyDaysAgo) {
                delete this.dailyStats[dateStr];
            }
        });
        
        this.saveDailyStats();
    }
}

// Export singleton instance
export const activityTracker = new ActivityTracker();