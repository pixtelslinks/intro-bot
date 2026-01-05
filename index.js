require('dotenv').config();
const fs = require('fs');
const { Client, GatewayIntentBits, EmbedBuilder, SimpleContextFetchingStrategy } = require('discord.js');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers] });

client.once('ready', () => {
    //console.log(`Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', async message => {
    if (message.author?.bot) return;
    const triggers = [`!ntro`, `!intro`, `<@!${client.user.id}>`, `<@${client.user.id}>`];
    if (!triggers.some(t => message.content.startsWith(t))) return;
    message.channel.sendTyping();

    // normalize and parse args after the trigger
    const cleaned = message.content.replace(new RegExp(`^(${triggers.map(t => t.replace(/[.*+?^${}()|[\\]\\]/g, '\\\\$&')).join('|')})`), '').trim();
    const args = cleaned.length ? cleaned.split(/\s+/) : [];
    const cmd = (args[0] || 'help').toLowerCase();
    const isManage = message.member?.permissions?.has('ManageChannels');
    const send = embed => message.channel.send({ embeds: [embed] });

    const handleConfig = async () => {
        if (!isManage) return send(createSimpleEmbed('You do not have permission to configure for this server', 'This command requires the Manage Channels permission', 0xC72E2E));
        const sub = (args[1] || '').toLowerCase();
        const guildId = message.guild.id;
        if (['channel', 'add', 'set'].includes(sub)) {
            if (!args[2]) {
                const config = await readGuildConfig(guildId);
                if (config?.chId) return send(createSimpleEmbed(`The current intro channel is <#${config.chId}>.`, 'Use `!ntro config add #channel` to choose a different intro channel'));
                return send(createSimpleEmbed('Intro Channel Not Set', 'No intro channel has been set for this server yet. Use `!ntro config add #channel` to set one.'));
            }
            const channelId = args[2].replace(/[<#>]/g, '');
            if (!(await message.guild.channels.fetch(channelId).catch(() => null))) return send(createSimpleEmbed('Channel Not Found', `Could not find a channel with ID: ${channelId}`, 0xC72E2E));
            const cfg = (await readGuildConfig(guildId)) || {};
            cfg.chId = channelId;
            await writeGuildConfig(guildId, cfg);
            await clearGuildIntroCache(guildId);
            return send(createSimpleEmbed('Intro Channel Set', `Intro channel set to <#${channelId}> for this server.`));
        }

        if (sub === 'mode') {
            const mode = (args[2] || '').toLowerCase();
            if (!mode) return send(createSimpleEmbed(`The current mode is \`${(await readGuildConfig(guildId))?.mode || 'not set'}\``, 'Use `!ntro config mode [first|last|largest|smart]` to change the mode'));
            if (!['first', 'last', 'largest', 'smart'].includes(mode)) return send(createHelpMessage(isManage));
            const cfg = (await readGuildConfig(guildId)) || {};
            cfg.mode = mode;
            await writeGuildConfig(guildId, cfg);
            send(createSimpleEmbed('Intro Mode Set', `Intro selection mode set to **${mode}** for this server.`));
            await clearGuildIntroCache(guildId);
            cacheAllGuildIntros(guildId).catch(err => send(createSimpleEmbed('Error Caching Intros', err.message, 0xC72E2E)));
            return;
        }

        return send(createHelpMessage(isManage));
    };

    const handleUpdate = async () => {
        const sub = (args[1] || '').toLowerCase();
        const guildId = message.guild.id;
        if (sub === 'all') {
            if (!isManage) return send(createSimpleEmbed('You do not have permission to update the intro cache for this server', 'This command requires the Manage Channels permission', 0xC72E2E));
            await clearGuildIntroCache(guildId);
            send(createSimpleEmbed('Updating Intro Cache', 'This may take a while depending on the number of intro messages.'));
            try {
                await cacheAllGuildIntros(guildId);
                return send(createSimpleEmbed('Intro Cache Updated', 'All intro messages have been cached.'));
            } catch (err) {
                return send(createSimpleEmbed('Error Caching Intros', err.message, 0xC72E2E));
            }
        }

        const userId = message.author.id;
        if (['force', 'override', 'reset'].includes(sub)) {
            await clearUserIntroCache(guildId, userId);
            const introMessage = await findIntro(guildId, userId, message);
            if (typeof introMessage === 'string') {
                return send(createSimpleEmbed('Error', introMessage, 0xC72E2E));
            }
            if (!introMessage) return send(createSimpleEmbed('Intro Not Found', `${message.guild.members.cache.get(userId).user.username} has not sent an intro yet.`));
            await removeGuildOverride(guildId, userId);
            const embed = createSimpleEmbed('Intro Updated', `Your intro has been updated: ${introMessage.url}`);
            embed.setFooter({ text: `Did I get this intro wrong?\nTry \`!ntro override\` with a message link to set one manually!`, iconURL: client.user.displayAvatarURL() });
            return send(embed);
        }

        // update me (default)
        const overrides = await readOverridesForGuild(message.guildId);
        if (overrides.includes(userId)) return send(createSimpleEmbed('Intro Override Active', 'You have manually set an intro. Use `!ntro update force` to update anyway.', 0xC72E2E));
        await clearUserIntroCache(guildId, userId);
        const introMessage = await findIntro(guildId, userId, message);
        if (typeof introMessage === 'string') {
            return send(createSimpleEmbed('Error', introMessage, 0xC72E2E));
        }
        if (!introMessage) return send(createSimpleEmbed('Intro Not Found', `${message.guild.members.cache.get(userId).user.username} has not sent an intro yet.`));
        const embed = createSimpleEmbed('Intro Updated', `Your intro has been updated: ${introMessage.url}`);
        embed.setFooter({ text: `Did I get this intro wrong?\nTry \`!ntro override\` to search again!`, iconURL: client.user.displayAvatarURL() });
        return send(embed);
    };

    const handleOverride = async () => {
        if (!args[1]) return send(createHelpMessage(isManage));
        const userId = message.author.id;
        const guildId = message.guild.id;
        const overriddenMessage = await overrideCacheWithLink(guildId, userId, args[1], message);
        if (overriddenMessage?.content) return send(createSimpleEmbed('Intro Cache Overridden', `Your intro cache has been overridden with the provided message: ${overriddenMessage.url}`));
    };

    const handleMe = async () => {
        const userId = message.author.id;
        const guildId = message.guild.id;
        const introMessage = await findIntro(guildId, userId, message);
        if (typeof introMessage === 'string') {
            return send(createSimpleEmbed('Error', introMessage, 0xC72E2E));
        }
        if (!introMessage) return send(createSimpleEmbed('Intro Not Found', `${message.guild.members.cache.get(userId).user.username} has not sent an intro yet.`));
        const embed = createSimpleEmbed((introMessage.author.globalName || introMessage.author.username) + "'s Intro", introMessage.url);
        embed.setFooter({ text: `Did I get this intro wrong?\nTry \`!ntro update\` to search again!`, iconURL: client.user.displayAvatarURL() });
        return send(embed);
    };

    const handleLookup = async () => {
        const identifier = args[0];
        const userId = await resolveUserId(identifier, message.guildId);
        if (!userId) return send(createSimpleEmbed('User not found', `Could not find a user with: ${identifier}`, 0xC72E2E));
        try {
            await message.guild.members.fetch(userId);
        } catch (err) {
            return send(createSimpleEmbed('User not found', `Could not find a user with: ${identifier}`, 0xC72E2E));
        }
        const introMessage = await findIntro(message.guild.id, userId, message);
        if (typeof introMessage === 'string') {
            return send(createSimpleEmbed('Error', introMessage, 0xC72E2E));
        }
        if (!introMessage) return send(createSimpleEmbed('Intro Not Found', `${message.guild.members.cache.get(userId).user.username} has not sent an intro yet.`));
        const embed = createSimpleEmbed((introMessage.author.globalName || introMessage.author.username) + "'s Intro", introMessage.url);
        embed.setFooter({ text: `Did I get this intro wrong?\nTry \`!ntro update\` to search again!`, iconURL: client.user.displayAvatarURL() });
        return send(embed);
    };

    // dispatch
    if (cmd === 'help') return send(createHelpMessage(isManage));
    if (cmd === 'config') return handleConfig();
    if (['update', 'refresh', 'recache'].includes(cmd)) return handleUpdate();
    if (cmd === 'override') return handleOverride();
    if (['me', 'my', 'mine', 'myself'].includes(cmd)) return handleMe();
    return handleLookup();
});

client.login(process.env.DISCORD_TOKEN);

//===========================
// functions

//===========================
// search functions

/** finds the intro message for a specific user in a guild
 * @param {string} guildId - the ID of the guild
 * @param {string} userId - the ID of the user
 * @param {Message} message - the original message that triggered the command
 * @return {Promise<Message>} - the intro message
 */
async function findIntro(guildId, userId, message) {
    // check cache first
    let cachedMessageId = await readFromIntroCache(userId, guildId);
    let guildConfig = await readGuildConfig(guildId);
    if (!guildConfig || !guildConfig.chId) return 'No intro channel configured for this server.';
    // fetch message from discord if cached
    const introChannel = await message.guild.channels.fetch(guildConfig.chId);
    if (cachedMessageId) {
        try {
            const cachedMessage = await introChannel.messages.fetch(cachedMessageId);
            if (cachedMessage && cachedMessage.author.id === userId) {
                return cachedMessage;
            }
        } catch (error) {
            // cache miss, proceed to find the message
        }
    }
    let introMessage = null;
    if (guildConfig.mode === 'first') {
        introMessage = await findFirstMessageByUser(introChannel, userId, false);
    } else if (guildConfig.mode === 'last') {
        introMessage = await findFirstMessageByUser(introChannel, userId, true);
    } else if (guildConfig.mode === 'largest') {
        const allMessages = await findAllMessagesByUser(introChannel, userId);
        introMessage = allMessages.reduce((max, msg) => msg.content.length > max.content.length ? msg : max, allMessages[0]);
    } else if (guildConfig.mode === 'smart' || !guildConfig.mode) { // smart mode
        const allMessages = await findAllMessagesByUser(introChannel, userId);
        const avgLength = (allMessages.reduce((sum, msg) => sum + msg.content.length, 0) / allMessages.length) - 1;
        const longerThanAvg = allMessages.filter(msg => msg.content.length > avgLength);
        if (longerThanAvg.length > 0) {
            introMessage = longerThanAvg.reduce((max, msg) => msg.content.length > max.content.length ? msg : max, longerThanAvg[0]);
        } else {
            introMessage = allMessages.reduce((max, msg) => msg.content.length > max.content.length ? msg : max, allMessages[0]);
        }
    }
    if (!introMessage) {
        // throw new Error('No intro message found for this user in the configured channel.');
        return null;
    }
    // cache the found message
    await writeToIntroCache(userId, introMessage.id, guildId);
    return introMessage;
}

/**
 * finds the first (or last) message sent by a specific user in a channel.
 * @param {TextChannel} channel - the channel to search in.
 * @param {string} userId - the ID of the user to search for.
 * @param {boolean} [before=false] - when true, searches in the opposite direction and returns the last message by the user; when false, returns the first message.
 * @return {Promise<Message|null>} - the first (or last) message sent by the user, or null if not found.
 */
async function findFirstMessageByUser(channel, userId, isBefore = false) {
    // Use findAllMessagesByUser and pick the first/last depending on mode.
    const all = await findAllMessagesByUser(channel, userId);
    if (!all || all.length === 0) return null;
    return isBefore ? all[all.length - 1] : all[0];
}

/**
 * finds all messages sent by a specific user in a channel and returns them as an array.
 * @param {TextChannel} channel - the channel to search in.
 * @param {string} userId - the ID of the user to search for.
 * @return {Promise<Message[]>} - an array of messages sent by the user.
 */
async function findAllMessagesByUser(channel, userId) {
    // Collect all messages by the user in the channel. We'll paginate using 'before' to walk
    // backwards through history, then sort the collected results by timestamp ascending.
    let before = null;
    const collected = [];
    while (true) {
        const options = { limit: 100 };
        if (before) options.before = before;
        const messages = await channel.messages.fetch(options).catch(() => null);
        if (!messages || messages.size === 0) break;
        for (const msg of messages.values()) {
            if (msg.author.id === userId) collected.push(msg);
        }
        if (messages.size < 100) break;
        const last = messages.last();
        if (!last) break;
        before = last.id;
    }
    collected.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    return collected;
}

//===========================
// cache functions

/**
 * caches the message ID of the intro message for a specific user as `userid: messageId`
 * @param {string} userId - the ID of the user
 * @param {string} messageId - the ID of the intro message
 * @param {string} guildID - the ID of the guild
 */
async function writeToIntroCache(userId, messageId, guildID) {
    try {
        const overrides = await readOverridesForGuild(guildID);
        if (overrides && overrides.includes(userId)) {
            return;
        }
    } catch (err) {
    }

    let writeBack;
    try {
        const save = fs.readFileSync("./intro-cache.json", 'utf8');
        writeBack = JSON.parse(save);
    } catch (err) {
        writeBack = {}; // if the file doesn't exist or is empty
    }
    if (!writeBack[guildID]) {
        writeBack[guildID] = {};
    }
    writeBack[guildID][userId] = messageId;
    try {
        fs.writeFileSync('./intro-cache.json', JSON.stringify(writeBack, null, 2));
    } catch (error) {
    }
}

/** retrieves the cached intro message ID for a specific user
 * @param {string} userId - the ID of the user
 * @param {string} guildID - the ID of the guild
 */
async function readFromIntroCache(userId, guildID) {
    try {
        const save = fs.readFileSync("./intro-cache.json", 'utf8');
        const parsed = JSON.parse(save);
        return parsed[guildID][userId];
    } catch (err) {
        return null;
    }
}

/** clears the intro cache for a specific guild
 * @param {string} guildId - the ID of the guild
 */
async function clearGuildIntroCache(guildId) {
    let writeBack;
    try {
        const save = fs.readFileSync("./intro-cache.json", 'utf8');
        writeBack = JSON.parse(save);
    } catch (err) {
        writeBack = {}; // if the file doesn't exist or is empty
    }
    if (writeBack[guildId]) {
        let overrides = [];
        try {
            overrides = await readOverridesForGuild(guildId);
        } catch (err) {
            overrides = [];
        }
        for (const userId of Object.keys(writeBack[guildId])) {
            if (overrides.includes(userId)) {
                continue;
            }
            delete writeBack[guildId][userId];
        }
        if (Object.keys(writeBack[guildId]).length === 0) {
            delete writeBack[guildId];
        }
    }
    try {
        fs.writeFileSync('./intro-cache.json', JSON.stringify(writeBack, null, 2));
    } catch (error) {
    }
}

/** clears the intro cache for a specific user in a specific guild
 * @param {string} guildId - the ID of the guild
 * @param {string} userId - the ID of the user
 */
async function clearUserIntroCache(guildId, userId) {
    if (!guildId || !userId) return;
    let writeBack;
    try {
        const save = fs.readFileSync("./intro-cache.json", 'utf8');
        writeBack = JSON.parse(save);
    } catch (err) {
        writeBack = {}; // if the file doesn't exist or is empty
    }
    if (writeBack[guildId] && writeBack[guildId][userId]) {
        delete writeBack[guildId][userId];
    }
    try {
        fs.writeFileSync('./intro-cache.json', JSON.stringify(writeBack, null, 2));
    } catch (error) {
    }
}

/** caches all intro messages for a specific guild
 * @param {string} guildId - the ID of the guild
 */
async function cacheAllGuildIntros(guildId) {
    let guildConfig = await readGuildConfig(guildId);
    if (!guildConfig || !guildConfig.chId) {
        throw new Error('Intro channel not configured for this server.');
    }
    const introChannel = await client.channels.fetch(guildConfig.chId);
    const messagesByUser = new Map(); // userId -> Array<Message>
    let lastMessageId = null;
    while (true) {
        const fetchOptions = { limit: 100 };
        if (lastMessageId) fetchOptions.before = lastMessageId;
        const messages = await introChannel.messages.fetch(fetchOptions);
        if (!messages || messages.size === 0) break;
        for (const [, msg] of messages) {
            const arr = messagesByUser.get(msg.author.id) || [];
            arr.push(msg);
            messagesByUser.set(msg.author.id, arr);
        }
        const last = messages.last();
        if (!last) break;
        lastMessageId = last.id;
        if (messages.size < 100) break;
    }
    for (const [userId, msgs] of messagesByUser.entries()) {
        if (!msgs || msgs.length === 0) continue;

        let selected = null;
        const mode = guildConfig.mode;

        if (mode === 'first') {
            selected = msgs.reduce((a, b) => (a.createdTimestamp < b.createdTimestamp ? a : b), msgs[0]);
        } else if (mode === 'last') {
            selected = msgs.reduce((a, b) => (a.createdTimestamp > b.createdTimestamp ? a : b), msgs[0]);
        } else if (mode === 'largest') {
            selected = msgs.reduce((a, b) => ((a.content ? a.content.length : 0) > (b.content ? b.content.length : 0) ? a : b), msgs[0]);
        } else if (mode === 'smart' || !mode) { // smart mode
            const lengths = msgs.map(m => (m.content ? m.content.length : 0));
            const avg = lengths.reduce((s, l) => s + l, 0) / lengths.length;
            const longer = msgs.filter(m => (m.content ? m.content.length : 0) > avg);
            if (longer.length > 0) {
                selected = longer.reduce((a, b) => (a.createdTimestamp > b.createdTimestamp ? a : b), longer[0]);
            } else {
                selected = msgs.reduce((a, b) => (a.createdTimestamp > b.createdTimestamp ? a : b), msgs[0]);
            }
        }
        if (selected) {
            await writeToIntroCache(userId, selected.id, guildId);
        }
    }
}

/** overrides the cache for a specific user in a specific guild
 * @param {string} guildId - the ID of the guild
 * @param {string} userId - the ID of the user
 * @param {string} message - the message ID to cache
 */
async function overrideUserIntroCache(guildId, userId, messageId) {
    await writeToIntroCache(userId, messageId, guildId);
}

/**
 * Retrieves override user IDs for a guild from overrides.json
 * @param {string} guildId
 * @returns {Promise<string[]>}
 */
async function readOverridesForGuild(guildId) {
    try {
        const save = fs.readFileSync('./overrides.json', 'utf8');
        const parsed = JSON.parse(save);
        return parsed[guildId] || [];
    } catch (err) {
        return [];
    }
}

/**
 * Overwrite a user's intro cache using a Discord message link and add the user to overrides.
 * @param {string} guildId
 * @param {string} userId
 * @param {string} messageLink - must be a Discord message URL
 * @param {Message} message - the original message that triggered the command
 * @returns {Promise<Message>} the fetched message
 */
async function overrideCacheWithLink(guildId, userId, messageLink, message) {
    const regex = /^https?:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)(?:\/.*)?$/i;
    const regmsg = messageLink.match(regex);
    if (!regmsg) return message.channel.send({ embeds: [createSimpleEmbed('Invalid Message Link', 'Please provide a valid Discord message link.', 0xC72E2E)] });
    const [_, linkGuildId, channelId, messageId] = regmsg;

    if (linkGuildId !== guildId) return message.channel.send({ embeds: [createSimpleEmbed('Guild Mismatch', 'The message link provided is not from this server.', 0xC72E2E)] });
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return message.channel.send({ embeds: [createSimpleEmbed('Channel Not Found', 'Could not find the channel from the provided message link.', 0xC72E2E)] });

    const msg = await channel.messages.fetch(messageId).catch(() => null);
    if (!msg) return message.channel.send({ embeds: [createSimpleEmbed('Message Not Found', 'Could not find the message from the provided message link.', 0xC72E2E)] });
    if (msg.author.id !== userId) return message.channel.send({ embeds: [createSimpleEmbed('User Mismatch', 'This message does not belong to you.', 0xC72E2E)] });
    if (msg.guild.id !== guildId) return message.channel.send({ embeds: [createSimpleEmbed('Guild Mismatch', 'The message link provided is not from this server.', 0xC72E2E)] });
    if (msg.channel.id !== (await readGuildConfig(guildId))?.chId) return message.channel.send({ embeds: [createSimpleEmbed('Channel Mismatch', 'The message is not from the configured intro channel for this server.', 0xC72E2E)] });

    await overrideUserIntroCache(guildId, userId, messageId);
    await addGuildOverride(guildId, userId);
    return msg;
}

//===========================
// config functions

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
 * @return {object|null} - the configuration object, or null if not found
 */
async function readGuildConfig(guildId) {
    try {
        const save = fs.readFileSync("./configs.json", 'utf8');
        const parsed = JSON.parse(save);
        if (parsed[guildId].mode === undefined) {
            parsed[guildId].mode = 'smart';
        }
        return parsed[guildId];
    } catch (err) {
        return null;
    }
}

//===========================
// override functions

/**
 * Adds a userId to the override list for a guild
 * @param {string} guildId
 * @param {string} userId
 */
async function addGuildOverride(guildId, userId) {
    let writeBack;
    try {
        const save = fs.readFileSync('./overrides.json', 'utf8');
        writeBack = JSON.parse(save);
    } catch (err) {
        writeBack = {};
    }
    if (!writeBack[guildId]) writeBack[guildId] = [];
    if (!writeBack[guildId].includes(userId)) {
        writeBack[guildId].push(userId);
        try {
            fs.writeFileSync('./overrides.json', JSON.stringify(writeBack, null, 2));
        } catch (err) {
            // ignore write errors
        }
    }
}

/**
 * Removes a userId from the override list for a guild
 * @param {string} guildId
 * @param {string} userId
 */
async function removeGuildOverride(guildId, userId) {
    let writeBack;
    try {
        const save = fs.readFileSync('./overrides.json', 'utf8');
        writeBack = JSON.parse(save);
    } catch (err) {
        return;
    }
    if (!writeBack[guildId]) return;
    const idx = writeBack[guildId].indexOf(userId);
    if (idx !== -1) {
        writeBack[guildId].splice(idx, 1);
        if (writeBack[guildId].length === 0) delete writeBack[guildId];
        try {
            fs.writeFileSync('./overrides.json', JSON.stringify(writeBack, null, 2));
        } catch (err) {
            // ignore write errors
        }
    }
}

//===========================
// utility functions

/** resolves a username, mention, or ID to a user ID
 * @param {string} identifier - the username, mention, or ID of the user
 * @param {string} guildid - the guild to search in
 * @return {Promise<string|null>} - the user ID, or null if not found
 */
async function resolveUserId(identifier, guildid) {
    const mentionMatch = identifier.match(/^<@!?(\d+)>$/);
    if (mentionMatch) {
        return mentionMatch[1];
    }
    if (/^\d+$/.test(identifier)) {
        return identifier;
    }
    const members = await client.guilds.fetch(guildid).then(guild => guild.members.fetch({ query: identifier, limit: 100 }));
    const member = members.find(m => m.user.username === identifier);
    if (member) {
        return member.user.id;
    }
    return null;
}

//===========================
// embed functions

/** creates a help message embed 
 * @param {boolean} [extra=false] - whether to include extra information
 * @return {EmbedBuilder} - the help message embed
*/
function createHelpMessage(extra = false) {
    const embed = new EmbedBuilder()
        .setTitle("!ntro Guide")
        .setDescription("### Commands\n" +
            "`!ntro help` - Show this help message\n" +
            "`!ntro [@user|userID|username]` - Get the intro message for the specified user\n" +
            "`!ntro me` - Get your own intro message\n" +
            "`!ntro update` - updates your cached intro message\n" +
            "`!ntro override [message link]` - Override your intro cache with a specific message link")
        .setColor(0x00AE86);
    if (extra) {
        embed.addFields(
            {
                name: "ㅤ\nConfiguration Commands", value:
                    "`!ntro config channel [#channel|channelID]`\n" +
                    "- Sets the intro channel for this server.\n" +
                    "\n" +
                    "`!ntro config mode [first|last|largest|smart]`\n" +
                    "- Set the intro selection mode for this server\n" +
                    "\nModes:\n" +
                    "- `first`: Selects the first message sent by the user in the intro channel.\n" +
                    "- `last`: Selects the last message sent by the user in the intro channel.\n" +
                    "- `largest`: Selects the longest message sent by the user in the intro channel.\n" +
                    "- `smart`: Selects a message longer than the average length of the user's messages in the intro channel, preferring more recent messages.\n" +
                    "\n`!ntro update all` - Re-caches all intro messages for this server\n" +
                    "- This may take a while depending on the number of intro messages."
            });
    }
    return embed;
}

/** creates a simple single-line embed message
 * @param {string} title - the title of the embed
 * @param {string} description - the description of the embed
 * @param {number} [color=0x00AE86] - the color of the embed
 * @return {EmbedBuilder} - the created embed
 */
function createSimpleEmbed(title, description, color = 0x00AE86) {
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color);
    return embed;
}

//===========================