require('dotenv').config();
const fs = require('fs');
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', message => {
    if (message.content.startsWith('!ntro') || message.content.startsWith('!intro')) {
        let args = message.content.split(' ').slice(1);

        if (!args[0] || args[0] === 'help') {
            message.channel.send({ embeds: [createHelpMessage()] });
            return;
        } else if (args[0] === 'config') {
            if (message.member.permissions.has('ManageMessages')) {
                if (args[1] === 'add') {
                    if (args[2]) {
                        const channelId = args[2].replace(/[<#>]/g, '');
                        const guildId = message.guild.id;
                        readGuildConfig(guildId).then(config => {
                            if (!config) {
                                config = { chId: channelId };
                            } else {
                                config.chId = channelId;
                            }
                            writeGuildConfig(guildId, config).then(() => {
                                message.channel.send(createSimpleEmbed('Intro Channel Set', `Intro channel set to <#${channelId}> for this server.`));
                            });
                        });
                    } else {
                        message.channel.send({ embeds: [createHelpMessage()] });
                    }
                } else if (args[1] === 'mode') {
                    if (args[2] === 'first' || args[2] === 'last' || args[2] === 'largest' || args[2] === 'smart') {
                        const mode = args[2];
                        const guildId = message.guild.id;
                        readGuildConfig(guildId).then(config => {
                            if (!config) {
                                config = { mode: mode };
                            } else {
                                config.mode = mode;
                            }
                            writeGuildConfig(guildId, config).then(() => {
                                message.channel.send(createSimpleEmbed('Intro Mode Set', `Intro selection mode set to **${mode}** for this server.`));
                            });
                        });
                    } else {
                        message.channel.send({ embeds: [createHelpMessage()] });
                    }
                } else {
                    message.channel.send({ embeds: [createHelpMessage()] });
                }
            } else {
                message.channel.send(createSimpleEmbed('You do not have permission to configure for this server.', '(Requires Manage Messages permission)', 0xFF0000));
            }
        } else if (["me", "my", "mine", "myself"].includes(args[0])) {
            const userId = message.author.id;
            const guildId = message.guild.id;
            let introMessage = findIntro(guildId, userId, message);
            message.channel.send(createSimpleEmbed(introMessage.author.username + "'s Intro", introMessage.url));
        } else {
            (async () => {
                const userId = await resolveUserId(args[0], message.guild);
                if (!userId) {
                    message.channel.send(createSimpleEmbed('User not found', `Could not resolve user identifier: ${args[0]}`, 0xFF0000));
                    return;
                }
                const guildId = message.guild.id;
                let introMessage = findIntro(guildId, userId, message);
                message.channel.send(createSimpleEmbed(introMessage.author.username + "'s Intro", introMessage.url));
            })();
        }
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

async function findIntro(guildId, userId, message) {
    // finds intro message in cache first
    const cachedMessageId = await readFromIntroCache(userId);
    if (cachedMessageId) {
        try {
            const cachedMessage = await channel.messages.fetch(cachedMessageId);
            if (cachedMessage && cachedMessage.author.id === userId) {
                return cachedMessage;
            }
        } catch (error) {
        }
    } else {
        // if not in cache, find the first message by the user
        readGuildConfig(guildId).then(async config => {
            if (!config || !config.chId) {
                message.channel.send('Intro channel not configured for this server. Please set it up using `!intro config add #channel`.');
                return;
            }
            const introChannel = await client.channels.fetch(config.chId);
            if (!introChannel || introChannel.type !== 0) { // 0 is Text Channel
                message.channel.send('Configured intro channel is invalid.');
                return;
            }

            let introMessage = null;
            const mode = config.mode || 'first';

            if (mode === 'first') {
                introMessage = await findFirstMessageByUser(introChannel, userId, false);
            } else if (mode === 'last') {
                introMessage = await findFirstMessageByUser(introChannel, userId, true);
            } else if (mode === 'largest') {
                const allMessages = await findAllMessagesByUser(introChannel, userId);
                if (allMessages && allMessages.length > 0) {
                    allMessages.sort((a, b) => (b.content ? b.content.length : 0) - (a.content ? a.content.length : 0));
                    introMessage = allMessages[0];
                }
            } else if (mode === 'smart') {
                const allMessages = await findAllMessagesByUser(introChannel, userId);
                if (allMessages && allMessages.length > 0) {
                    const lengths = allMessages.map(m => (m.content ? m.content.length : 0));
                    const avg = lengths.reduce((s, l) => s + l, 0) / lengths.length;
                    allMessages.sort((a, b) => b.createdTimestamp - a.createdTimestamp);
                    introMessage = allMessages.find(m => (m.content ? m.content.length : 0) > avg) || allMessages[0];
                }
            }

            if (introMessage) {
                await writeToIntroCache(userId, introMessage.id);
                return introMessage;
            } else {
                message.channel.send(`No intro message found for <@${userId}>.`);
            }
            return null;
        });
    }
}

/**
 * finds all messages sent by a specific user in a channel and returns them as an array.
 * @param {TextChannel} channel - the channel to search in.
 * @param {string} userId - the ID of the user to search for.
 */
async function findAllMessagesByUser(channel, userId) {
    let lastMessageId = channel.id;
    let messagesByUser = [];
    let hasMoreMessages = true;
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
        const save = fs.readFileSync("./intro-cache.json", 'utf8');
        writeBack = JSON.parse(save);
    } catch (err) {
        writeBack = {}; // if the file doesn't exist or is empty
    }
    writeBack[userId] = messageId;
    try {
        fs.writeFileSync('./intro-cache.json', JSON.stringify(writeBack, null, 2));
    } catch (error) {
    }
}

/** retrieves the cached intro message ID for a specific user
 * @param {string} userId - the ID of the user
 */
async function readFromIntroCache(userId) {
    try {
        const save = fs.readFileSync("./intro-cache.json", 'utf8');
        const parsed = JSON.parse(save);
        return parsed[userId];
    } catch (err) {
        return null;
    }
}

/** writes a guild's configuration to configs.json
 * @param {string} guildId - the ID of the guild
 * @param {object} config - the configuration object to save
 */
async function writeGuildConfig(guildId, config) {
    let writeBack;
    try {
        const save = fs.readFileSync("./configs.json", 'utf8');
        writeBack = JSON.parse(save);
    } catch (err) {
        writeBack = {}; // if the file doesn't exist or is empty
    }
    writeBack[guildId] = config;
    try {
        fs.writeFileSync('./configs.json', JSON.stringify(writeBack, null, 2));
    } catch (error) {
    }
}

/** retrieves a guild's configuration from configs.json
 * @param {string} guildId - the ID of the guild
 */
async function readGuildConfig(guildId) {
    try {
        const save = fs.readFileSync("./configs.json", 'utf8');
        const parsed = JSON.parse(save);
        return parsed[guildId];
    } catch (err) {
        return null;
    }
}

/** resolves a username, mention, or ID to a user ID
 * @param {string} identifier - the username, mention, or ID of the user
 * @param {Guild} guild - the guild to search in
 */
async function resolveUserId(identifier, guild) {
    // Check if it's a mention
    const mentionMatch = identifier.match(/^<@!?(\d+)>$/);
    if (mentionMatch) {
        return mentionMatch[1];
    }

    // Check if it's a user ID
    if (/^\d+$/.test(identifier)) {
        return identifier;
    }

    // Otherwise, try to find by username
    const members = await guild.members.fetch();
    const member = members.find(m => m.user.username === identifier);
    if (member) {
        return member.user.id;
    }
    return null;
}

/** creates a help message embed */
function createHelpMessage() {
    const embed = new EmbedBuilder()
        .setTitle("Intro Bot Help")
        .setDescription("Commands:\n" +
            "`!intro help` - Show this help message\n" +
            "`!intro @user` - Get the intro message for the specified user\n" +
            "`!intro config add #channel` - Set the intro channel for this server\n" +
            "`!intro config mode [first|last|largest|smart]` - Set the intro selection mode for this server\n\n" +
            "Modes:\n" +
            "- `first`: Selects the first message sent by the user in the intro channel.\n" +
            "- `last`: Selects the last message sent by the user in the intro channel.\n" +
            "- `largest`: Selects the longest message sent by the user in the intro channel.\n" +
            "- `smart`: Selects a message longer than the average length of the user's messages in the intro channel, preferring more recent messages.")
        .setColor(0x00AE86);
    return embed;
}

/** creates a simple single-line embed message
 * @param {string} title - the title of the embed
 * @param {string} description - the description of the embed
 */
function createSimpleEmbed(title, description, color = 0x00AE86) {
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color);
    return embed;
}