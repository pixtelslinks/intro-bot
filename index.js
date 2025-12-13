require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', message => {
    if (message.content === '!intro') {

    }
});

client.login(process.env.DISCORD_TOKEN);

//functions

/**
 * finds the first (or last) message sent by a specific user in a channel.
 * @param {TextChannel} channel - the channel to search in.
 * @param {string} userId - the ID of the user to search for.
 * @param {boolean} [before=false] - when true, searches in the opposite direction and returns the last message by the user; when false, returns the first message.
 */
async function findFirstMessageByUser(channel, userId, isBefore = false) {
    let lastMessageId = isBefore ? (channel.lastMessageId ?? channel.id) : channel.id;
    let targetMessage = null;
    let hasMoreMessages = true;

    console.log(`Searching for user ${userId} in #${channel.name}...`);

    while (hasMoreMessages && !targetMessage) {
        const fetchOptions = { limit: 100 };
        if (lastMessageId !== channel.id) {
            fetchOptions[isBefore ? 'before' : 'after'] = lastMessageId;
        }
        const messages = await channel.messages.fetch(fetchOptions);

        if (messages.size === 0) {
            hasMoreMessages = false;
            break;
        }
        for (const [id, message] of messages) {
            if (message.author.id === userId) {
                targetMessage = message;
                break;
            }
            lastMessageId = id;
        }
    }
    return targetMessage;
}

/**
 * finds all messages sent by a specific user in a channel. and returns them as an array.
 * @param {TextChannel} channel - the channel to search in.
 * @param {string} userId - the ID of the user to search for.
 */
async function findAllMessagesByUser(channel, userId) {
    let lastMessageId = isBefore ? (channel.lastMessageId ?? channel.id) : channel.id;
    let messagesByUser = [];
    let hasMoreMessages = true;

    console.log(`Searching for user ${userId} in #${channel.name}...`);

    while (hasMoreMessages && !targetMessage) {
        const fetchOptions = { limit: 100 };
        if (lastMessageId !== channel.id) {
            fetchOptions[isBefore ? 'before' : 'after'] = lastMessageId;
        }
        const messages = await channel.messages.fetch(fetchOptions);

        if (messages.size === 0) {
            hasMoreMessages = false;
            break;
        }
        for (const [id, message] of messages) {
            if (message.author.id === userId) {
                targetMessage = message;
                messagesByUser.push(message);
            }
            lastMessageId = id;
        }
    }
    return messagesByUser;
}

/**
 * caches the message ID of the intro message for a specific user as `userid: messageId`
 * @param {string} userId - the ID of the user
 * @param {string} messageId - the ID of the intro message
 */
async function writeToIntroCache(userId, messageId) {
    let writeBack;
    try {
        const gameSave = fs.readFileSync("./intro-cache.json", 'utf8');
        writeBack = JSON.parse(gameSave);
    } catch (err) {
        writeBack = {}; // if the file doesn't exist or is empty
    }
    writeBack[userId] = messageId;
    try {
        fs.writeFileSync('./intro-cache.json', JSON.stringify(writeBack, null, 2));
    } catch (error) {
    }
}