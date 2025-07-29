import * as fs from 'fs';
import * as path from 'path';

// Simple backup utility for FairplayX
export class BackupManager {
    private backupDir: string;
    
    constructor() {
        this.backupDir = path.join(__dirname, 'backups');
        this.ensureBackupDir();
    }
    
    private ensureBackupDir(): void {
        if (!fs.existsSync(this.backupDir)) {
            fs.mkdirSync(this.backupDir, { recursive: true });
        }
    }
    
    public createBackup(): string {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFileName = `config-backup-${timestamp}.json`;
        const backupPath = path.join(this.backupDir, backupFileName);
        
        try {
            const configContent = fs.readFileSync('./config.json', 'utf8');
            fs.writeFileSync(backupPath, configContent);
            console.log(`✅ Backup created: ${backupFileName}`);
            return backupPath;
        } catch (error) {
            console.error('❌ Failed to create backup:', error);
            throw error;
        }
    }
    
    public listBackups(): string[] {
        try {
            return fs.readdirSync(this.backupDir)
                .filter(file => file.startsWith('config-backup-') && file.endsWith('.json'))
                .sort()
                .reverse(); // Most recent first
        } catch (error) {
            console.error('❌ Failed to list backups:', error);
            return [];
        }
    }
    
    public restoreBackup(backupFileName: string): boolean {
        const backupPath = path.join(this.backupDir, backupFileName);
        
        try {
            if (!fs.existsSync(backupPath)) {
                console.error('❌ Backup file not found:', backupFileName);
                return false;
            }
            
            const backupContent = fs.readFileSync(backupPath, 'utf8');
            // Validate JSON before restoring
            JSON.parse(backupContent);
            
            // Create a backup of current config before restoring
            this.createBackup();
            
            fs.writeFileSync('./config.json', backupContent);
            console.log(`✅ Config restored from: ${backupFileName}`);
            return true;
        } catch (error) {
            console.error('❌ Failed to restore backup:', error);
            return false;
        }
    }
    
    public autoBackup(): void {
        // Create automatic backup every hour
        setInterval(() => {
            this.createBackup();
            this.cleanOldBackups();
        }, 60 * 60 * 1000); // 1 hour
    }
    
    private cleanOldBackups(): void {
        const backups = this.listBackups();
        const maxBackups = 24; // Keep last 24 backups (24 hours)
        
        if (backups.length > maxBackups) {
            const toDelete = backups.slice(maxBackups);
            toDelete.forEach(backup => {
                try {
                    fs.unlinkSync(path.join(this.backupDir, backup));
                    console.log(`🗑️ Deleted old backup: ${backup}`);
                } catch (error) {
                    console.error(`❌ Failed to delete backup ${backup}:`, error);
                }
            });
        }
    }
}

// Export singleton instance
export const backupManager = new BackupManager();