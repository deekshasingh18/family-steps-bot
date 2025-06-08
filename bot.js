const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

class FamilyStepsTracker {
    constructor() {
        this.client = new Client({
            authStrategy: new LocalAuth()
        });
        
        // In-memory storage (replace with database for production)
        this.familyMembers = new Map();
        this.stepsData = new Map(); // userId -> { daily: [], weekly: [], monthly: [] }
        this.groupId = null; // Will be set when bot joins group
        
        this.initializeBot();
    }

    initializeBot() {
        // Generate QR code for authentication
        this.client.on('qr', (qr) => {
            console.log('Scan this QR code with WhatsApp:');
            qrcode.generate(qr, { small: true });
        });

        this.client.on('ready', () => {
            console.log('WhatsApp Bot is ready!');
        });

        // Handle incoming messages
        this.client.on('message', async (message) => {
            await this.handleMessage(message);
        });

        this.client.initialize();
    }

    async handleMessage(message) {
        const chat = await message.getChat();
        const contact = await message.getContact();
        const text = message.body.toLowerCase().trim();
        
        // Only respond in group chats or if it's a command
        if (!chat.isGroup && !text.startsWith('/')) return;
        
        // Set group ID if this is a group message
        if (chat.isGroup && !this.groupId) {
            this.groupId = chat.id._serialized;
        }

        // Parse commands
        if (text.startsWith('/')) {
            await this.handleCommand(message, text, contact);
        }
    }

    async handleCommand(message, command, contact) {
        const userId = contact.id._serialized;
        const userName = contact.pushname || contact.name || 'Unknown';
        
        try {
            if (command.startsWith('/register')) {
                await this.registerUser(message, userId, userName);
            }
            else if (command.startsWith('/steps')) {
                await this.addSteps(message, userId, userName, command);
            }
            else if (command === '/daily' || command === '/leaderboard') {
                await this.showDailyLeaderboard(message);
            }
            else if (command === '/weekly') {
                await this.showWeeklyLeaderboard(message);
            }
            else if (command === '/monthly') {
                await this.showMonthlyLeaderboard(message);
            }
            else if (command === '/mystats') {
                await this.showUserStats(message, userId, userName);
            }
            else if (command === '/help') {
                await this.showHelp(message);
            }
            else if (command === '/reset') {
                await this.resetUserData(message, userId);
            }
        } catch (error) {
            console.error('Error handling command:', error);
            await message.reply('Sorry, there was an error processing your request. Please try again.');
        }
    }

    async registerUser(message, userId, userName) {
        this.familyMembers.set(userId, {
            name: userName,
            joinDate: new Date(),
            totalSteps: 0
        });
        
        if (!this.stepsData.has(userId)) {
            this.stepsData.set(userId, {
                daily: [],
                weekly: [],
                monthly: []
            });
        }
        
        await message.reply(`🎉 Welcome to the family steps challenge, ${userName}!\n\nYou're now registered. Use /steps <number> to log your daily steps.\n\nExample: /steps 8500`);
    }

    async addSteps(message, userId, userName, command) {
        if (!this.familyMembers.has(userId)) {
            await message.reply('❌ Please register first using /register');
            return;
        }

        const steps = parseInt(command.split(' ')[1]);
        if (isNaN(steps) || steps < 0) {
            await message.reply('❌ Please enter a valid number of steps.\nExample: /steps 8500');
            return;
        }

        const today = new Date().toDateString();
        const userData = this.stepsData.get(userId);
        
        // Check if user already logged steps today
        const todayEntry = userData.daily.find(entry => entry.date === today);
        if (todayEntry) {
            todayEntry.steps = steps;
            await message.reply(`✅ Updated your steps for today: ${steps.toLocaleString()} steps`);
        } else {
            userData.daily.push({ date: today, steps: steps });
            await message.reply(`✅ Logged ${steps.toLocaleString()} steps for today!`);
        }

        // Update weekly and monthly data
        this.updateWeeklyMonthlyData(userId, steps, today);
        
        // Update total steps
        const member = this.familyMembers.get(userId);
        member.totalSteps = userData.daily.reduce((sum, entry) => sum + entry.steps, 0);
    }

    updateWeeklyMonthlyData(userId, steps, dateStr) {
        const date = new Date(dateStr);
        const userData = this.stepsData.get(userId);
        
        // Weekly data (week starting Monday)
        const weekStart = this.getWeekStart(date);
        const weekKey = weekStart.toDateString();
        let weekEntry = userData.weekly.find(entry => entry.week === weekKey);
        if (!weekEntry) {
            weekEntry = { week: weekKey, steps: 0 };
            userData.weekly.push(weekEntry);
        }
        
        // Monthly data
        const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
        let monthEntry = userData.monthly.find(entry => entry.month === monthKey);
        if (!monthEntry) {
            monthEntry = { month: monthKey, steps: 0, monthName: date.toLocaleDateString('en', { month: 'long', year: 'numeric' }) };
            userData.monthly.push(monthEntry);
        }
        
        // Recalculate weekly and monthly totals
        weekEntry.steps = userData.daily
            .filter(entry => this.getWeekStart(new Date(entry.date)).toDateString() === weekKey)
            .reduce((sum, entry) => sum + entry.steps, 0);
            
        monthEntry.steps = userData.daily
            .filter(entry => {
                const entryDate = new Date(entry.date);
                return `${entryDate.getFullYear()}-${entryDate.getMonth()}` === monthKey;
            })
            .reduce((sum, entry) => sum + entry.steps, 0);
    }

    getWeekStart(date) {
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday as week start
        return new Date(d.setDate(diff));
    }

    async showDailyLeaderboard(message) {
        const today = new Date().toDateString();
        const dailyRankings = [];
        
        for (const [userId, userData] of this.stepsData.entries()) {
            const todayEntry = userData.daily.find(entry => entry.date === today);
            if (todayEntry) {
                const member = this.familyMembers.get(userId);
                dailyRankings.push({
                    name: member.name,
                    steps: todayEntry.steps
                });
            }
        }
        
        dailyRankings.sort((a, b) => b.steps - a.steps);
        
        let leaderboard = `🏆 *DAILY LEADERBOARD* 🏆\n📅 ${new Date().toLocaleDateString()}\n\n`;
        
        if (dailyRankings.length === 0) {
            leaderboard += '😴 No steps logged today yet!\nUse /steps <number> to log your steps.';
        } else {
            dailyRankings.forEach((entry, index) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🏃';
                leaderboard += `${medal} *${index + 1}.* ${entry.name}\n    👟 ${entry.steps.toLocaleString()} steps\n\n`;
            });
        }
        
        await message.reply(leaderboard);
    }

    async showWeeklyLeaderboard(message) {
        const weekStart = this.getWeekStart(new Date()).toDateString();
        const weeklyRankings = [];
        
        for (const [userId, userData] of this.stepsData.entries()) {
            const weekEntry = userData.weekly.find(entry => entry.week === weekStart);
            if (weekEntry && weekEntry.steps > 0) {
                const member = this.familyMembers.get(userId);
                weeklyRankings.push({
                    name: member.name,
                    steps: weekEntry.steps
                });
            }
        }
        
        weeklyRankings.sort((a, b) => b.steps - a.steps);
        
        let leaderboard = `🏆 *WEEKLY LEADERBOARD* 🏆\n📅 Week of ${new Date(weekStart).toLocaleDateString()}\n\n`;
        
        if (weeklyRankings.length === 0) {
            leaderboard += '😴 No steps logged this week yet!';
        } else {
            weeklyRankings.forEach((entry, index) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🏃';
                leaderboard += `${medal} *${index + 1}.* ${entry.name}\n    👟 ${entry.steps.toLocaleString()} steps\n\n`;
            });
        }
        
        await message.reply(leaderboard);
    }

    async showMonthlyLeaderboard(message) {
        const currentDate = new Date();
        const monthKey = `${currentDate.getFullYear()}-${currentDate.getMonth()}`;
        const monthlyRankings = [];
        
        for (const [userId, userData] of this.stepsData.entries()) {
            const monthEntry = userData.monthly.find(entry => entry.month === monthKey);
            if (monthEntry && monthEntry.steps > 0) {
                const member = this.familyMembers.get(userId);
                monthlyRankings.push({
                    name: member.name,
                    steps: monthEntry.steps
                });
            }
        }
        
        monthlyRankings.sort((a, b) => b.steps - a.steps);
        
        const monthName = currentDate.toLocaleDateString('en', { month: 'long', year: 'numeric' });
        let leaderboard = `🏆 *MONTHLY LEADERBOARD* 🏆\n📅 ${monthName}\n\n`;
        
        if (monthlyRankings.length === 0) {
            leaderboard += '😴 No steps logged this month yet!';
        } else {
            monthlyRankings.forEach((entry, index) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🏃';
                leaderboard += `${medal} *${index + 1}.* ${entry.name}\n    👟 ${entry.steps.toLocaleString()} steps\n\n`;
            });
        }
        
        await message.reply(leaderboard);
    }

    async showUserStats(message, userId, userName) {
        if (!this.familyMembers.has(userId)) {
            await message.reply('❌ Please register first using /register');
            return;
        }

        const userData = this.stepsData.get(userId);
        const member = this.familyMembers.get(userId);
        
        // Calculate averages
        const totalDays = userData.daily.length;
        const avgDaily = totalDays > 0 ? Math.round(member.totalSteps / totalDays) : 0;
        
        // Get today's steps
        const today = new Date().toDateString();
        const todayEntry = userData.daily.find(entry => entry.date === today);
        const todaySteps = todayEntry ? todayEntry.steps : 0;
        
        // Get this week's steps
        const weekStart = this.getWeekStart(new Date()).toDateString();
        const weekEntry = userData.weekly.find(entry => entry.week === weekStart);
        const weekSteps = weekEntry ? weekEntry.steps : 0;
        
        // Get this month's steps
        const currentDate = new Date();
        const monthKey = `${currentDate.getFullYear()}-${currentDate.getMonth()}`;
        const monthEntry = userData.monthly.find(entry => entry.month === monthKey);
        const monthSteps = monthEntry ? monthEntry.steps : 0;

        const stats = `📊 *YOUR STATS* - ${userName}\n\n` +
                     `👟 Today: ${todaySteps.toLocaleString()} steps\n` +
                     `📅 This Week: ${weekSteps.toLocaleString()} steps\n` +
                     `📆 This Month: ${monthSteps.toLocaleString()} steps\n\n` +
                     `🏆 Total Steps: ${member.totalSteps.toLocaleString()}\n` +
                     `📈 Daily Average: ${avgDaily.toLocaleString()} steps\n` +
                     `📅 Active Days: ${totalDays}`;

        await message.reply(stats);
    }

    async resetUserData(message, userId) {
        if (!this.familyMembers.has(userId)) {
            await message.reply('❌ You are not registered.');
            return;
        }

        this.stepsData.set(userId, {
            daily: [],
            weekly: [],
            monthly: []
        });
        
        const member = this.familyMembers.get(userId);
        member.totalSteps = 0;
        
        await message.reply('✅ Your step data has been reset!');
    }

    async showHelp(message) {
        const help = `🤖 *FAMILY STEPS TRACKER BOT* 🤖\n\n` +
                    `*Commands:*\n` +
                    `/register - Join the family challenge\n` +
                    `/steps <number> - Log your daily steps\n` +
                    `/daily or /leaderboard - Daily rankings\n` +
                    `/weekly - Weekly leaderboard\n` +
                    `/monthly - Monthly leaderboard\n` +
                    `/mystats - Your personal statistics\n` +
                    `/reset - Reset your step data\n` +
                    `/help - Show this help message\n\n` +
                    `*Examples:*\n` +
                    `/steps 8500\n` +
                    `/steps 12000\n\n` +
                    `💡 *Tips:*\n` +
                    `• Log your steps daily for accurate tracking\n` +
                    `• Check leaderboards to stay motivated\n` +
                    `• Compete with family members!\n\n` +
                    `🏃‍♂️ Happy stepping! 🏃‍♀️`;

        await message.reply(help);
    }
}

// Initialize and start the bot
const bot = new FamilyStepsTracker();

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down bot...');
    bot.client.destroy();
    process.exit(0);
});