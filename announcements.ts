import fs from 'fs';
import { getGlobalClient } from './server';
import { v4 as uuidv4 } from 'uuid';

interface Announcement {
    id: string;
    message: string;
    cronTime: string;
}

let announcements: Announcement[] = [];
let activeIntervals: NodeJS.Timeout[] = [];

function loadAnnouncements() {
    try {
        const data = fs.readFileSync('./announcements.json', 'utf8');
        announcements = JSON.parse(data);
        scheduleAnnouncements();
    } catch (error) {
        console.error('Error loading announcements:', error);
    }
}

function saveAnnouncements() {
    fs.writeFileSync('./announcements.json', JSON.stringify(announcements, null, 2));
}

function clearAllIntervals() {
    activeIntervals.forEach(interval => clearInterval(interval));
    activeIntervals = [];
}

function scheduleAnnouncements() {
    // Clear existing intervals first
    clearAllIntervals();
    
    announcements.forEach(announcement => {
        // For every 1 minute announcements, use the cronTime as interval in minutes
        // If cronTime is "1", it will send every 1 minute
        // If cronTime is "5", it will send every 5 minutes
        const intervalMinutes = parseInt(announcement.cronTime) || 1;
        
        const intervalId = setInterval(async () => {
            // Send announcement to in-game chat
            try {
                const client = getGlobalClient();
                if (client) {
                    client.write('command_request', {
                        command: `say ${announcement.message}`,
                        origin: { type: 'player', uuid: uuidv4(), request_id: uuidv4() },
                        internal: true,
                        version: 52,
                    });
                } else {
                    console.error('No Minecraft client available for announcement');
                }
            } catch (err: any) {
                console.error(`Error sending announcement: ${err.message}`);
            }
        }, intervalMinutes * 60000); // Convert minutes to milliseconds
        
        activeIntervals.push(intervalId);
    });
}

function addAnnouncement(message: string, cronTime: string) {
    const newAnnouncement: Announcement = {
        id: Date.now().toString(),
        message,
        cronTime
    };
    announcements.push(newAnnouncement);
    saveAnnouncements();
    scheduleAnnouncements();
}

function removeAnnouncement(id: string) {
    announcements = announcements.filter(ann => ann.id !== id);
    saveAnnouncements();
    scheduleAnnouncements(); // Reschedule to clear old intervals
}

loadAnnouncements();

export { addAnnouncement, removeAnnouncement, announcements };

