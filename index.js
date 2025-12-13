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
 * Finds the first (or last) message sent by a specific user in a channel.
 * @param {TextChannel} channel - The channel to search in.
 * @param {string} userId - The ID of the user to search for.
 * @param {boolean} [before=false] - When true, searches in the opposite direction and returns the last message by the user; when false, returns the first message.
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
