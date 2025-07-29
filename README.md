# FairplayX Servers - Advanced Minecraft Bedrock Discord Bot

![FairplayX Logo](https://img.shields.io/badge/FairplayX-Servers-blue?style=for-the-badge)
![Version](https://img.shields.io/badge/Version-2.0.0-green?style=for-the-badge)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![Discord.js](https://img.shields.io/badge/Discord.js-5865F2?style=for-the-badge&logo=discord&logoColor=white)

A comprehensive Discord bot designed for Minecraft Bedrock Edition servers with advanced anti-cheat features, player management, and server monitoring capabilities.

## 🚀 Current Features

### 🎮 Core Server Management
- **Multi-Server Support**: Connect and manage multiple Minecraft Bedrock servers
- **Real-time Player Monitoring**: Track player joins, leaves, and activities
- **Chat Relay**: Bidirectional chat between Discord and Minecraft
- **Server Status Monitoring**: Real-time server health and player count
- **Automatic Backup System**: Hourly configuration backups with restore capabilities
- **Activity Tracking**: Comprehensive server uptime and player activity monitoring

### 👥 Player Management
- **Whitelist System**: Advanced player whitelist with easy management
- **Admin Management**: Role-based administrator system
- **Player Statistics**: Detailed playtime, join count, and last seen tracking
- **Player Notes & Warnings**: Administrative note-taking and warning system
- **Kick/Ban System**: Automated and manual player moderation with reason tracking
- **Welcome Messages**: Customizable welcome system with MOTD support

### 🛡️ Anti-Cheat & Security
- **Alternative Account Detection**: Xbox Live profile analysis
  - Gamer Score thresholds
  - Friends count analysis
  - Followers count verification
- **Device Restrictions**: Platform-based access control
  - Android, iOS, Xbox, Windows, PlayStation, FireOS, Nintendo Switch
- **Security Monitoring**: Advanced threat detection system
  - Rapid join detection
  - Suspicious activity logging
  - Real-time security alerts
- **Bot Detection**: Automated bot account identification
- **Invalid Character Detection**: Username validation

### 📊 Advanced Analytics & Monitoring
- **Player Statistics**: Comprehensive playtime and activity tracking
- **Activity Analytics**: Daily and weekly server statistics
- **Security Logs**: Detailed security event tracking and analysis
- **Uptime Monitoring**: Server availability and performance metrics
- **Data Persistence**: Automatic data backup and recovery

### 🎛️ Discord Integration
- **Slash Commands**: Modern Discord command interface with 15+ commands
- **Interactive Panels**: Rich embed-based management interfaces
- **Channel Configuration**: Customizable logging channels
- **Role Management**: Automated role assignment
- **Rich Embeds**: Beautiful, informative Discord messages
- **Enhanced Logging**: Configurable command and activity logging

## 📋 Available Commands

### Core Management

#### `/manage`
Opens the main management dashboard with access to:
- 🔐 Whitelist Management
- 📋 Allowlist Management
- 👑 Administrator Management
- 🔧 Maintenance Mode
- 🕵️ Alt Detection Configuration
- 📱 Device Restrictions
- 📺 Channel Settings
- 🎭 Role Configuration

### System Management

#### `/update`
Check for and install npm package updates automatically

## 🛠️ Installation & Setup

### Prerequisites
- Node.js 18+ and npm
- Discord Bot Token
- Minecraft Bedrock Server access

### Quick Start

1. **Clone the repository**
   ```bash
   git clone https://github.com/Verxcy120/FairplayX-servers.git
   cd FairplayX-servers
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure the bot**
   - Edit `config.json` with your settings:
   ```json
   {
     "botToken": "YOUR_DISCORD_BOT_TOKEN",
     "clientId": "YOUR_DISCORD_CLIENT_ID",
     "username": "Bot Username",
     "servers": [
       {
         "serverName": "Your Server Name",
         "host": "server.ip.address",
         "port": 19132,
         "logChannels": {
           "chat": "DISCORD_CHANNEL_ID",
           "kicks": "DISCORD_CHANNEL_ID",
           "joinsAndLeaves": "DISCORD_CHANNEL_ID"
         }
       }
     ]
   }
   ```

4. **Build and start**
   ```bash
   npm run build
   npm start
   ```

### Windows Quick Setup
Use the provided batch files:
- `install.bat` - Install dependencies
- `build.bat` - Build the project
- `start.bat` - Start the bot
- `update.bat` - Update dependencies

## 🔧 Configuration Guide

### Basic Configuration

#### Discord Settings
- `botToken`: Your Discord bot token
- `clientId`: Your Discord application client ID

#### Server Configuration
```json
"servers": [{
  "serverName": "Display name for your server",
  "host": "Server IP address",
  "port": 19132,
  "logChannels": {
    "chat": "Channel ID for chat logs",
    "kicks": "Channel ID for kick notifications",
    "joinsAndLeaves": "Channel ID for join/leave logs"
  }
}]
```

#### Enhanced Logging Configuration
```json
"logging": {
  "logCommands": true,
  "detailedLogs": true
}
```

#### Welcome System Configuration
```json
"welcomeSystem": {
  "enabled": true,
  "channelId": "DISCORD_CHANNEL_ID",
  "customMessage": "Welcome {player} to our server!",
  "motd": "Enjoy your stay and follow the rules!"
}
```

#### Security Monitoring Configuration
```json
"security": {
  "enabled": true,
  "alertChannelId": "DISCORD_CHANNEL_ID",
  "rapidJoinThreshold": 5,
  "rapidJoinWindow": 60000,
  "logToFile": true
}
```

#### Anti-Cheat Settings
```json
"altSystem": {
  "maxGamerScore": 1000,
  "maxFriends": 50,
  "maxFollowers": 100
}
```

#### Player Statistics Configuration
```json
"playerStats": {
  "trackPlaytime": true,
  "trackJoinCount": true,
  "trackLastSeen": true
}
```

#### Device Restrictions
```json
"deviceRestrictions": {
  "Android": true,
  "iOS": true,
  "Xbox": true,
  "Windows": false,
  "PlayStation": true,
  "FireOS": false,
  "NintendoSwitch": true
}
```

#### Allowlist Configuration
```json
"allowlist": [
  "PlayerName1",
  "PlayerName2",
  "AdminPlayer"
]
```

#### Maintenance Mode Configuration
```json
"maintenanceMode": {
  "enabled": false,
  "enabledBy": "",
  "enabledAt": "",
  "reason": "Server maintenance in progress"
}
```

### Advanced Configuration

#### Channel Setup
1. Use `/manage` command
2. Select "📺 Channel Configuration"
3. Set channels for different log types

#### Role Configuration
1. Use `/manage` command
2. Select "🎭 Role Configuration"
3. Configure member and muted roles

## 🚀 New Features & Enhancements

### 📦 Automatic Backup System
- **Hourly automatic backups** of configuration files
- **Manual backup creation** via `/backup create` command
- **Backup restoration** with `/backup restore` command
- **Automatic cleanup** - keeps last 24 backups
- **Backup listing** to view available restore points

### 📈 Activity Tracking & Analytics
- **Real-time player activity monitoring**
- **Server uptime tracking** with detailed statistics
- **Daily and weekly join/leave statistics**
- **Player playtime tracking** with persistent data
- **Activity commands** (`/uptime`, `/activity`) for insights

### 🛡️ Enhanced Security Monitoring
- **Rapid join detection** to prevent spam attacks
- **Comprehensive security event logging**
- **Real-time Discord alerts** for security events
- **Security statistics** and event history
- **Configurable thresholds** for different security checks

### 👥 Advanced Player Management
- **Player notes system** for administrative records
- **Warning system** with escalation tracking
- **Enhanced player statistics** with detailed metrics
- **Welcome message system** with customizable greetings
- **Player profile lookup** with comprehensive data
- **Allowlist management** for exclusive server access
- **Maintenance mode** with allowlist-only access control

### 📊 Data Persistence & Analytics
- **JSON-based data storage** for all tracking systems
- **Daily statistics persistence** for long-term analysis
- **Security event logging** with severity levels
- **Activity data retention** for historical analysis
- **Backup system** for data protection

### 🎮 Enhanced Discord Integration
- **Expanded slash command suite** with 15+ new commands
- **Rich embed responses** with detailed formatting
- **Interactive command menus** for better UX
- **Enhanced logging** with command tracking
- **Real-time notifications** for all server events

## 📊 Monitoring & Analytics

### Real-time Monitoring
- Player join/leave tracking
- Chat message logging
- Violation detection alerts
- Server performance metrics

### Data Export
- Violation reports
- Player statistics
- Behavior analysis data
- Custom analytics dashboards

## 🔒 Security Features

### Player Verification
- Xbox Live profile validation
- Alternative account detection
- Device fingerprinting
- Behavior pattern analysis

### Access Control
- Role-based permissions
- Device-specific restrictions
- Whitelist management
- Automated moderation


## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

For support, please:
1. Join The New Discord
2. Message Owner

## 🔄 Version History

### v2.0.0 - Enhanced Features Update
- Automatic backup system with hourly configuration backups
- Activity tracking with comprehensive server uptime monitoring
- Enhanced security monitoring with advanced threat detection
- Enhanced player management with notes/warnings system
- Welcome system with customizable MOTD support
- Improved Discord integration with modern slash commands
- Enhanced logging and data persistence
- Multi-server support improvements

### v1.0.0 Beta
- Initial release
- Core server management features
- Basic anti-cheat system
- Discord integration

---

**Made with ❤️ for the Minecraft Bedrock community**
