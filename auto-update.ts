import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export class AutoUpdater {
  private updateInterval: NodeJS.Timeout | null = null;
  private readonly checkIntervalMs = 24 * 60 * 60 * 1000; // 24 hours

  constructor() {
    this.startAutoUpdate();
  }

  private startAutoUpdate(): void {
    console.log('🔄 Auto-updater initialized - checking for updates every 24 hours');
    
    // Check immediately on startup
    this.checkForUpdates();
    
    // Set up periodic checks
    this.updateInterval = setInterval(() => {
      this.checkForUpdates();
    }, this.checkIntervalMs);
  }

  private async checkForUpdates(): Promise<void> {
    try {
      console.log('🔍 Checking for bedrock-protocol and prismarine-auth updates...');
      
      // Check for outdated packages
      const { stdout } = await execAsync('npm outdated --json');
      
      if (stdout.trim()) {
        const outdated = JSON.parse(stdout);
        const targetPackages = ['bedrock-protocol', 'prismarine-auth'];
        const packagesToUpdate = targetPackages.filter(pkg => outdated[pkg]);
        
        if (packagesToUpdate.length > 0) {
          console.log(`📦 Found ${packagesToUpdate.length} target packages to update:`);
          packagesToUpdate.forEach(pkg => {
            const info = outdated[pkg];
            console.log(`  - ${pkg}: ${info.current} → ${info.latest}`);
          });
          
          await this.updatePackages(packagesToUpdate);
        } else {
          console.log('✅ Target packages (bedrock-protocol, prismarine-auth) are up to date');
        }
      } else {
        console.log('✅ Target packages (bedrock-protocol, prismarine-auth) are up to date');
      }
    } catch (error: any) {
      // npm outdated returns exit code 1 when packages are outdated, which is normal
      if (error.code === 1 && error.stdout) {
        try {
          const outdated = JSON.parse(error.stdout);
          const targetPackages = ['bedrock-protocol', 'prismarine-auth'];
          const packagesToUpdate = targetPackages.filter(pkg => outdated[pkg]);
          
          if (packagesToUpdate.length > 0) {
            console.log(`📦 Found ${packagesToUpdate.length} target packages to update:`);
            packagesToUpdate.forEach(pkg => {
              const info = outdated[pkg];
              console.log(`  - ${pkg}: ${info.current} → ${info.latest}`);
            });
            
            await this.updatePackages(packagesToUpdate);
          }
        } catch (parseError) {
          console.error('❌ Error parsing npm outdated output:', parseError);
        }
      } else {
        console.error('❌ Error checking for updates:', error.message);
      }
    }
  }

  private async updatePackages(packages?: string[]): Promise<void> {
    try {
      const packagesToUpdate = packages || ['bedrock-protocol', 'prismarine-auth'];
      console.log(`🔄 Updating packages: ${packagesToUpdate.join(', ')}...`);
      
      // Update specific packages
      const updateCommand = `npm update ${packagesToUpdate.join(' ')}`;
      await execAsync(updateCommand);
      
      console.log(`✅ Packages updated successfully: ${packagesToUpdate.join(', ')}`);
      
      // Check if package-lock.json was modified
      const packageLockPath = path.join(process.cwd(), 'package-lock.json');
      if (fs.existsSync(packageLockPath)) {
        console.log('📝 package-lock.json updated');
      }
      
    } catch (error: any) {
      console.error('❌ Error updating packages:', error.message);
    }
  }

  public async manualUpdate(): Promise<{ success: boolean; message: string }> {
    try {
      console.log('🔄 Manual update triggered for bedrock-protocol and prismarine-auth');
      await this.updatePackages(['bedrock-protocol', 'prismarine-auth']);
      return { success: true, message: 'Target packages (bedrock-protocol, prismarine-auth) updated successfully' };
    } catch (error: any) {
      console.error('❌ Manual update failed:', error.message);
      return { success: false, message: `Update failed: ${error.message}` };
    }
  }

  public stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
      console.log('🛑 Auto-updater stopped');
    }
  }

  public getStatus(): { enabled: boolean; nextCheck: string } {
    return {
      enabled: this.updateInterval !== null,
      nextCheck: this.updateInterval 
        ? new Date(Date.now() + this.checkIntervalMs).toISOString()
        : 'Disabled'
    };
  }
}

// Export singleton instance
export const autoUpdater = new AutoUpdater();