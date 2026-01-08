require('dotenv').config();
const fs = require('fs');
const { Client, GatewayIntentBits, EmbedBuilder, SimpleContextFetchingStrategy, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { clear } = require('console');
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers] });
const uptimestamp = Math.floor(Date.now() / 1000);
let guildLastUsed = {};
let introCache = {};

// colors
const COLOR_SIMPLE = 0x5ECEB6;
const COLOR_INFO = 0x85A6FF;
const COLOR_ERROR = 0xFF5C5C;

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
        if (!isManage) return send(createTemplateEmbed('error', ['You do not have permission to configure for this server', 'This command requires the Manage Channels permission']));
        const sub = (args[1] || '').toLowerCase();
        const guildId = message.guild.id;
        if (['channel', 'add', 'set'].includes(sub)) {
            if (!args[2]) {
                const config = await readGuildConfig(guildId);
                if (config?.chId) {
                    send(createTemplateEmbed('one-line', `The current intro channel is <#${config.chId}>`));
                    return send(createDetailedHelpMessage('config channel', message));
                }
                send(createTemplateEmbed('warning', 'Intro Channel Not Set'));
                return send(createDetailedHelpMessage('config channel', message));
            } else if (args[2].toLowerCase() === 'help') {
                return send(createDetailedHelpMessage('config channel', message));
            }
            const channelId = args[2].replace(/[<#>]/g, '');
            if (!(await message.guild.channels.fetch(channelId).catch(() => null))) {
                send(createTemplateEmbed('error', ['Channel Not Found', `Could not find a channel with ID: ${channelId}`]));
                return send(createDetailedHelpMessage('config channel', message));
            }
            const cfg = (await readGuildConfig(guildId)) || {};
            cfg.chId = channelId;
            await writeGuildConfig(guildId, cfg);
            await clearGuildIntroCache(guildId);
            return send(createTemplateEmbed('simple', ['Intro Channel Set', `Intro channel set to <#${channelId}> for this server.`]));
        }

        if (sub === 'mode') {
            const mode = (args[2] || '').toLowerCase();
            if (!mode) {
                send(createTemplateEmbed('one-line', `The current mode is **${(await readGuildConfig(guildId))?.mode || 'not set'}**`));
                return send(createDetailedHelpMessage('config mode', message));
            }
            if (!['first', 'last', 'largest', 'smart'].includes(mode)) return send(createDetailedHelpMessage('config mode', message));
            const cfg = (await readGuildConfig(guildId)) || {};
            cfg.mode = mode;
            await writeGuildConfig(guildId, cfg);
            send(createTemplateEmbed('simple', ['Intro Mode Set', `Intro selection mode set to **${mode}** for this server.`]));
            await clearGuildIntroCache(guildId);
            cacheAllGuildIntros(guildId).catch(err => send(createTemplateEmbed('error', ['Error Caching Intros', err.message])));
            return;
        }

        return send(createDetailedHelpMessage('config', message));
    };

    const handleUpdate = async () => {
        const sub = (args[1] || '').toLowerCase();
        const guildId = message.guild.id;
        if (['server', 'guild', 'all', 'everything'].includes(sub)) {
            if (!isManage) return send(createTemplateEmbed('error', ['You do not have permission to update the intro cache for this server', 'This command requires the Manage Channels permission']));
            await clearGuildIntroCache(guildId);
            send(createTemplateEmbed('simple', ['Updating Intro Cache', 'This may take a while depending on the number of intro messages.']));
            try {
                await cacheAllGuildIntros(guildId);
                return send(createTemplateEmbed('simple', ['Intro Cache Updated', 'All intro messages have been cached.']));
            } catch (err) {
                return send(createTemplateEmbed('error', ['Error Caching Intros', err.message]));
            }
        }

        const userId = message.author.id;
        if (['force', 'override', 'reset'].includes(sub)) {
            await removeGuildOverride(guildId, userId);
            await clearUserIntroCache(guildId, userId);
            const introMessage = await findIntro(guildId, userId, message);
            await writeToIntroCache(userId, introMessage ? introMessage.id : null, guildId);
            if (typeof introMessage === 'string') {
                return send(createTemplateEmbed('error', ['Error', introMessage]));
            }
            if (!introMessage) return send(createTemplateEmbed('error', ['Intro Not Found', `${message.guild.members.cache.get(userId).user.username} has not sent an intro yet.`]));
            return send(createTemplateEmbed('intro', [(introMessage.author.globalName || introMessage.author.username) + `'s intro`, `Your intro has been updated\n${introMessage.url}`, (introMessage.author?.displayAvatarURL ? introMessage.author.displayAvatarURL() : null), 'Did I get this intro wrong?\nTry \`!ntro override\` with a message link to set one manually!']));
        }

        // update me (default)
        const overrides = await readOverridesForGuild(message.guildId);
        if (overrides.includes(userId)) return send(createTemplateEmbed('error', ['Intro Override Active', 'You have manually set an intro. Use `!ntro update force` to update anyway.']));
        await clearUserIntroCache(guildId, userId);
        const introMessage = await findIntro(guildId, userId, message);
        await writeToIntroCache(userId, introMessage ? introMessage.id : null, guildId);
        if (typeof introMessage === 'string') {
            return send(createTemplateEmbed('error', ['Error', introMessage]));
        }
        if (!introMessage) return send(createTemplateEmbed('simple', ['Intro Not Found', `${message.guild.members.cache.get(userId).user.globalName || message.guild.members.cache.get(userId).user.username} has not sent an intro yet.`]));
        return send(createTemplateEmbed('intro', [(introMessage.author.globalName || introMessage.author.username) + `'s intro`, `Your intro has been updated\n${introMessage.url}`, (introMessage.author?.displayAvatarURL ? introMessage.author.displayAvatarURL() : null), 'Did I get this intro wrong?\nTry \`!ntro override\` with a message link to set one manually!']));
    };

    const handleOverride = async () => {
        if (!args[1]) return send(createDetailedHelpMessage('override', message));
        const userId = message.author.id;
        const guildId = message.guild.id;
        if (['clear', 'remove', 'delete', 'update'].includes(args[1].toLowerCase())) {
            await removeGuildOverride(guildId, userId);
            return send(createTemplateEmbed('simple', ['Intro Override Removed', 'Your intro override has been removed. Future `!ntro` commands will use the cached intro message. Use `!ntro update force` to refresh your intro cache.']));
        }
        const overriddenMessage = await overrideCacheWithLink(guildId, userId, args[1], message);
        if (overriddenMessage?.content) return send(createTemplateEmbed('simple', ['Intro Cache Overridden', `Your intro cache has been overridden with the provided message: ${overriddenMessage.url}`]));
    };

    const handleMe = async () => {
        const userId = message.author.id;
        const guildId = message.guild.id;
        const introMessage = await findIntro(guildId, userId, message);
        if (typeof introMessage === 'string') {
            return send(createTemplateEmbed('error', ['Error', introMessage]));
        }
        if (!introMessage) return send(createTemplateEmbed('simple', ['Intro Not Found', `${message.guild.members.cache.get(userId).user.globalName || message.guild.members.cache.get(userId).user.username} has not sent an intro yet.`]));
        const introEmbed = createTemplateEmbed('intro', [(introMessage.author.globalName || introMessage.author.username) + `'s intro`, introMessage.url, (introMessage.author?.displayAvatarURL ? introMessage.author.displayAvatarURL() : null), 'Did I get this intro wrong?']);
        const updateRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`ntro_update:${message.guild.id}:${userId}`)
                .setLabel('Update Intro')
                .setStyle(ButtonStyle.Secondary)
        );
        return message.channel.send({ embeds: [introEmbed], components: [updateRow] });
    };

    const handleLookup = async () => {
        const identifier = args[0];
        if (['first', 'last', 'largest', 'smart', 'channel', 'add', 'set', 'mode', 'update', 'override', 'force', 'reset', '#'].includes(identifier.toLowerCase())) {
            if (identifier === 'mode') {
                return send(createTemplateEmbed('error', ['Did you mean `!ntro config mode`?', 'Use `!ntro help` to see available commands.']));
            } else if (['channel', 'add', 'set'].includes(identifier.toLowerCase())) {
                return send(createTemplateEmbed('error', ['Did you mean `!ntro config channel`?', 'Use `!ntro help` to see available commands.']));
            } else if (['force', 'reset'].includes(identifier.toLowerCase())) {
                return send(createTemplateEmbed('error', ['Did you mean `!ntro update force`?', 'Use `!ntro help` to see available commands.']));
            } else if (['first', 'last', 'largest', 'smart'].includes(identifier.toLowerCase())) {
                return send(createTemplateEmbed('error', [`Did you mean \`!ntro config mode ${identifier.toLowerCase()}\`?`, 'Use `!ntro help` to see available commands.']));
            } else if (['<#', '#'].includes(identifier.toLowerCase())) {
                return send(createTemplateEmbed('error', ['Did you mean `!ntro config channel`?', 'Use `!ntro help` to see available commands.']));
            }
        }
        const userId = await resolveUserId(identifier, message.guildId);
        if (!userId) return send(createTemplateEmbed('error', ['User not found', `Could not find a user with: ${identifier}`]));
        try {
            await message.guild.members.fetch(userId);
        } catch (err) {
            return send(createTemplateEmbed('error', ['User not found', `Could not find a user with: ${identifier}`]));
        }
        const introMessage = await findIntro(message.guild.id, userId, message);
        if (typeof introMessage === 'string') {
            return send(createTemplateEmbed('error', ['Error', introMessage]));
        }
        if (!introMessage) return send(createTemplateEmbed('simple', ['Intro Not Found', `${message.guild.members.cache.get(userId).user.globalName || message.guild.members.cache.get(userId).user.username} has not sent an intro yet.`]));
        const introEmbed = createTemplateEmbed('intro', [(introMessage.author.globalName || introMessage.author.username) + `'s intro`, introMessage.url, (introMessage.author?.displayAvatarURL ? introMessage.author.displayAvatarURL() : null), 'Did I get this intro wrong?']);
        const updateRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`ntro_update:${message.guild.id}:${userId}`)
                .setLabel('Update Intro')
                .setStyle(ButtonStyle.Secondary)
        );
        return message.channel.send({ embeds: [introEmbed], components: [updateRow] });
    };

    const handleUptime = async () => {
        const embed = createTemplateEmbed('uptime', ['!ntro Status', 'Uptime', `<t:${uptimestamp}:R>, <t:${uptimestamp}>`, 'Last Updated', `<t:${await fetchGithubCommitTimestamp()}:R>, <t:${await fetchGithubCommitTimestamp()}>`]).setFooter({ text: 'github.com/pixtelslinks/intro-bot', iconURL: 'https://github.githubassets.com/favicons/favicon-dark.png' })
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Visit GitHub')
                .setStyle(ButtonStyle.Link)
                .setURL('https://github.com/pixtelslinks/intro-bot')
        );
        return message.channel.send({ embeds: [embed], components: [row] });
    };

    // dispatch
    if (cmd === 'help') return send(createHelpMessage(isManage));
    if (['config', 'configure', 'setup'].includes(cmd)) return handleConfig();
    if (['update', 'refresh', 'recache'].includes(cmd)) return handleUpdate();
    if (cmd === 'override') return handleOverride();
    if (['me', 'my', 'mine', 'myself'].includes(cmd)) return handleMe();
    if (['uptime', 'status', 'about'].includes(cmd)) return handleUptime();
    return handleLookup();
});

// Interaction handler for update buttons
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    if (!interaction.customId || !interaction.customId.startsWith('ntro_update:')) return;
    const parts = interaction.customId.split(':');
    if (parts.length < 3) return;
    const guildId = parts[1];
    const targetUserId = parts[2];
    const overrides = await readOverridesForGuild(guildId).catch(() => []);

    // await interaction.deferReply({ ephemeral: false }).catch(() => { });
    await interaction.channel.sendTyping().catch(() => { });
    if (interaction.user.id !== targetUserId) return interaction.reply({ content: 'You are not allowed to update this intro.' }).catch(() => { });
    if (overrides.includes(targetUserId)) return interaction.reply({ content: 'You have a manual intro override set. Use `!ntro override clear` to remove it before updating.' }).catch(() => { });

    try {
        await clearUserIntroCache(guildId, targetUserId).catch(() => { });
        const guild = await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) return interaction.reply({ content: 'Could not access the guild to update intro.' });
        const fakeMessage = { guild: guild, guildId: guildId };
        const introMessage = await findIntro(guildId, targetUserId, fakeMessage);
        await writeToIntroCache(targetUserId, introMessage ? introMessage.id : null, guildId).catch(() => { });

        if (typeof introMessage === 'string') {
            return interaction.reply({ content: `Error updating intro: ${introMessage}` }).catch(() => { });
        }
        if (!introMessage) {
            return interaction.reply({ content: 'Intro not found for that user.' }).catch(() => { });
        }

        try {
            const newComponents = interaction.message.components.map(row => {
                const newRow = new ActionRowBuilder();
                const comps = row.components.map(comp => {
                    const btn = new ButtonBuilder()
                        .setCustomId(comp.customId)
                        .setLabel(comp.label || '')
                        .setStyle(comp.style || ButtonStyle.Secondary)
                        .setDisabled(comp.customId === interaction.customId ? true : (comp.disabled || false));
                    if (comp.url) btn.setURL(comp.url);
                    return btn;
                });
                newRow.addComponents(...comps);
                return newRow;
            });
            await interaction.message.edit({ components: newComponents }).catch(() => { });
        } catch (err) {
            // non-fatal
        }

        const user = await client.users.fetch(targetUserId).catch(() => null);
        const introEmbed = createTemplateEmbed('intro', [(user?.globalName || user?.username) + `'s intro`, `Your intro has been updated\n${introMessage.url}`, (user?.displayAvatarURL ? user.displayAvatarURL() : null), 'Did I get this intro wrong?\nTry `!ntro override` with a message link to set one manually!']);
        return interaction.reply({ embeds: [introEmbed] }).catch(() => { });
    } catch (err) {
        return interaction.reply({ content: `Error during update: ${err?.message || err}` }).catch(() => { });
    }
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
 * @param {string} guildId - the ID of the guild
 * @param {boolean} force - if true, forces writing to disk even if memory cache exists
 */
async function writeToIntroCache(userId, messageId, guildId, force = false) {
    guildPriorityCheck(guildId);
    try {
        const overrides = await readOverridesForGuild(guildId);
        if (overrides && overrides.includes(userId)) {
            return;
        }
    } catch (err) {
    }
    if (introCache[guildId] && !force) {
        introCache[guildId][userId] = messageId;
        return;
    }
    let writeBack;
    try {
        const save = fs.readFileSync("./intro-cache.json", 'utf8');
        writeBack = JSON.parse(save);
    } catch (err) {
        writeBack = {}; // if the file doesn't exist or is empty
    }
    if (!writeBack[guildId]) {
        writeBack[guildId] = {};
    }
    writeBack[guildId][userId] = messageId;
    try {
        fs.writeFileSync('./intro-cache.json', JSON.stringify(writeBack, null, 2));
    } catch (error) {
    }
}

/** caches the entire intro cache for a specific guild
 * @param {string} guildId - the ID of the guild
 * @param {object} cache - the intro cache object to save
 * @param {boolean} force - if true, forces writing to disk even if memory cache exists
 */
async function writeGuildIntroCache(guildId, cache, force = false) {
    if (introCache[guildId] && !force) {
        introCache[guildId] = cache;
        return;
    }

    let writeBack;
    try {
        const save = fs.readFileSync("./intro-cache.json", 'utf8');
        writeBack = JSON.parse(save);
    } catch (err) {
        writeBack = {}; // if the file doesn't exist or is empty
    }
    writeBack[guildId] = cache;
    try {
        fs.writeFileSync('./intro-cache.json', JSON.stringify(writeBack, null, 2));
    } catch (error) {
    }
}

/** retrieves the cached intro message ID for a specific user
 * @param {string} userId - the ID of the user
 * @param {string} guildId - the ID of the guild
 */
async function readFromIntroCache(userId, guildId) {
    guildPriorityCheck(guildId);
    if (introCache[guildId] && introCache[guildId][userId]) {
        return introCache[guildId][userId];
    } else {
        try {
            const save = fs.readFileSync("./intro-cache.json", 'utf8');
            const parsed = JSON.parse(save);
            return parsed[guildId][userId];
        } catch (err) {
            return null;
        }
    }
}

/** retrieves entire intro cache for a specific guild
 * @param {string} guildId - the ID of the guild
 * @return {object} - the intro cache object for the guild
 */
async function readGuildIntroCache(guildId) {
    if (introCache[guildId]) {
        return introCache[guildId];
    } else {
        try {
            const save = fs.readFileSync("./intro-cache.json", 'utf8');
            const parsed = JSON.parse(save);
            return parsed[guildId] || {};
        } catch (err) {
            return {};
        }
    }
}

/** retrieves entire intro cache
 * @return {object} - the intro cache object
 */
async function readEntireIntroCache() {
    try {
        const save = fs.readFileSync("./intro-cache.json", 'utf8');
        const parsed = JSON.parse(save);
        return parsed;
    } catch (err) {
        return {};
    }
}

/** clears the intro cache for a specific guild
 * @param {string} guildId - the ID of the guild
 * @param {boolean} force - if true, forces clearing from disk even if memory cache exists
 */
async function clearGuildIntroCache(guildId, force = false) {
    guildPriorityCheck(guildId);
    let overrides = [];
    try {
        overrides = await readOverridesForGuild(guildId);
    } catch (err) {
        overrides = [];
    }
    if (introCache[guildId] && !force) {
        for (const userId of Object.keys(introCache[guildId])) {
            if (overrides.includes(userId)) continue;
            delete introCache[guildId][userId];
        }
        if (Object.keys(introCache[guildId]).length === 0) delete introCache[guildId];
        return;
    }
    let writeBack;
    try {
        const save = fs.readFileSync("./intro-cache.json", 'utf8');
        writeBack = JSON.parse(save);
    } catch (err) {
        writeBack = {}; // if the file doesn't exist or is empty
    }
    if (writeBack[guildId]) {
        for (const userId of Object.keys(writeBack[guildId])) {
            if (overrides.includes(userId)) continue;
            delete writeBack[guildId][userId];
        }
        if (Object.keys(writeBack[guildId]).length === 0) delete writeBack[guildId];
    }
    try {
        fs.writeFileSync('./intro-cache.json', JSON.stringify(writeBack, null, 2));
    } catch (error) {
    }
}

/** clears the intro cache for a specific user in a specific guild
 * @param {string} guildId - the ID of the guild
 * @param {string} userId - the ID of the user
 * @param {boolean} force - if true, forces clearing from disk even if memory cache exists
 */
async function clearUserIntroCache(guildId, userId, force = false) {
    guildPriorityCheck(guildId);
    if (!guildId || !userId) return;
    if (introCache[guildId] && !force) {
        if (introCache[guildId][userId]) {
            delete introCache[guildId][userId];
        }
        if (Object.keys(introCache[guildId]).length === 0) delete introCache[guildId];
        return;
    }
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
    guildPriorityCheck(guildId);
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
    if (!regmsg) return message.channel.send({ embeds: [createTemplateEmbed('error', ['Invalid Message Link', 'Please provide a valid Discord message link.'])] });
    const [_, linkGuildId, channelId, messageId] = regmsg;

    if (linkGuildId !== guildId) return message.channel.send({ embeds: [createTemplateEmbed('error', ['Guild Mismatch', 'The message link provided is not from this server.'])] });
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return message.channel.send({ embeds: [createTemplateEmbed('error', ['Channel Not Found', 'Could not find the channel from the provided message link.'])] });

    const msg = await channel.messages.fetch(messageId).catch(() => null);
    if (!msg) return message.channel.send({ embeds: [createTemplateEmbed('error', ['Message Not Found', 'Could not find the message from the provided message link.'])] });
    if (msg.author.id !== userId) return message.channel.send({ embeds: [createTemplateEmbed('error', ['User Mismatch', 'This message does not belong to you.'])] });
    if (msg.guild.id !== guildId) return message.channel.send({ embeds: [createTemplateEmbed('error', ['Guild Mismatch', 'The message link provided is not from this server.'])] });
    if (msg.channel.id !== (await readGuildConfig(guildId))?.chId) return message.channel.send({ embeds: [createTemplateEmbed('error', ['Channel Mismatch', 'The message is not from the configured intro channel for this server.'])] });

    await overrideUserIntroCache(guildId, userId, messageId);
    await addGuildOverride(guildId, userId);
    return msg;
}

//===========================
// memory management functions

/** checks and manages guild priority in memory
 * @param {string} guildId - the ID of the guild
 */
async function guildPriorityCheck(guildId) {
    const now = Math.floor(Date.now() / 1000);
    if (guildLastUsed[guildId]) {
        if ((now - guildLastUsed[guildId]) < 300) { // 5 minutes
            introCache[guildId] = await readGuildIntroCache(guildId);
        } else if (introCache[guildId]) {
            await clearGuildMemoryCache(guildId);
        }
    }
    guildLastUsed[guildId] = now
}

/** clears all guild caches from memory and writes them to disk
 * 
 */
async function clearMemoryCache() {
    for (const guildId of Object.keys(introCache)) {
        await writeGuildIntroCache(guildId, introCache[guildId] || {}, true);
        delete introCache[guildId];
    }
}

/** clears memory cache for a specific guild
 * @param {string} guildId - the ID of the guild
 */
async function clearGuildMemoryCache(guildId) {
    if (introCache[guildId]) {
        await writeGuildIntroCache(guildId, introCache[guildId] || {}, true);
        delete introCache[guildId];
    }
}

/** clears memory cache for a specific user in a specific guild
 * @param {string} guildId - the ID of the guild
 * @param {string} userId - the ID of the user
 */
async function clearUserMemoryCache(guildId, userId) {
    if (introCache[guildId] && introCache[guildId][userId]) {
        await writeGuildIntroCache(guildId, introCache[guildId] || {}, true);
        delete introCache[guildId][userId];
        if (Object.keys(introCache[guildId]).length === 0) {
            delete introCache[guildId];
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

/** fetches time since most recent github commit
 * @return {Promise<number>} - the unix timestamp of the most recent commit
 */
async function fetchGithubCommitTimestamp() {
    try {
        const response = await fetch('https://api.github.com/repos/pixtelslinks/intro-bot/commits/main');
        const data = await response.json();
        return Math.floor(new Date(data.commit.author.date).getTime() / 1000);
    } catch (error) {
        return Math.floor(Date.now() / 1000);
    }
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
        .setColor(COLOR_INFO);
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

/** creates more detailed help messages based on topic
 * @param {string} topic - the help topic
 * @param {Message} message - the original message that triggered the command
 * @return {EmbedBuilder} - the help message embed
 */
function createDetailedHelpMessage(topic, message) {
    const embed = new EmbedBuilder().setColor(COLOR_INFO);
    if (topic === 'config') {
        embed.setTitle('Configuring !ntro')
            .setDescription('Commands to configure the !ntro for this server.')
            .addFields(
                { name: 'Channels', value: 'Use `!ntro config channel [#channel|channelID]` to set or view the intro channel for this server.' },
                { name: 'Modes', value: 'Use `!ntro config mode [first|last|largest|smart]` to set how the intro message is selected.' },
                { name: 'Example', value: `!ntro config channel <#${message.channel.id || 'channelId'}>\n!ntro config mode largest` }
            );
        return embed;
    }
    if (topic === 'config channel') {
        embed.setTitle('Configuring Intro Channel')
            .setDescription('Set or view the intro channel for this server.')
            .addFields(
                { name: 'To set', value: 'Provide a channel mention or ID. Otherwise, the current intro channel will be shown.' },
                { name: 'Example', value: `!ntro config channel <#${message?.channel?.id || 'channelId'}>` }
            );
        return embed;
    }
    if (topic === 'config mode') {
        embed.setTitle('Configuring Intro Mode')
            .setDescription("Choose how a user's intro message is selected from the intro channel.")
            .addFields(
                { name: 'Available modes', value: '- `first` — first message by the user\n- `last` — last message by the user\n- `largest` — longest message by the user\n- `smart` — message longer than the user\'s average, preferring recent ones' },
                { name: 'Example', value: '!ntro config mode largest' }
            );
        return embed;
    }
    if (topic === 'update all') {
        embed.setTitle('Updating All Intros')
            .setDescription('Re-cache all intro messages for this server. This may take time depending on message volume.')
            .addFields(
                { name: 'Requires', value: 'Manage Channels permission' },
                { name: 'Example', value: '!ntro update all' }
            );
        return embed;
    }
    if (topic === 'override') {
        embed.setTitle('Overriding Intro Cache')
            .setDescription("Manually select your intro message if !ntro didn't get it right.")
            .addFields(
                { name: 'Requirements', value: 'The message must be from the configured intro channel and belong to you. Overriding adds you to the override list so your intro won\'t be auto-updated.' },
                { name: 'To use', value: 'Provide a valid Discord message link. To get the link, right-click or long-press your intro message and select "Copy Message Link".' },
                { name: 'Example', value: message && message.url ? `!ntro override ${message.url}` : '!ntro override <message link>' }
            );
        return embed;
    }
    return embed.setTitle('Help');
}

/** creates an embed with a template
 * @param {string} type - embed template to use
 * @param {string[]} text - text fields in order
 * @return {EmbedBuilder} - the created embed
 */
function createTemplateEmbed(type, text) {
    if (type === 'simple') {
        const embed = new EmbedBuilder()
            .setTitle(text[0])
            .setDescription(text[1])
            .setColor(COLOR_SIMPLE);
        return embed;
    } else if (type === 'error') {
        const embed = new EmbedBuilder()
            .setTitle(text[0])
            .setDescription(text[1])
            .setColor(COLOR_ERROR);
        return embed;
    } else if (type === 'intro') {
        const embed = new EmbedBuilder()
            .setAuthor({ name: text[0], iconURL: text[2] })
            .setTitle(text[1])
            .setFooter({ text: text[3] })//, iconURL: client.user.displayAvatarURL() })
            .setColor(COLOR_SIMPLE);
        return embed;
    } else if (type === 'info') {
        const embed = new EmbedBuilder()
            .setTitle(text[0])
            .setDescription(text[1])
            .setColor(COLOR_INFO);
        return embed;
    } else if (type === 'one-line') {
        const embed = new EmbedBuilder()
            .setTitle(text || text[0])
            .setColor(COLOR_SIMPLE);
        return embed;
    } else if (type === 'warning') {
        const embed = new EmbedBuilder()
            .setTitle(text || text[0])
            .setColor(COLOR_ERROR);
        return embed;
    } else if (type === 'uptime') {
        const embed = new EmbedBuilder()
            .setTitle(text[0])
            .addFields(
                { name: text[1], value: text[2] },
                { name: text[3], value: text[4] }
            )
            .setColor(COLOR_SIMPLE);
        return embed;
    }
}

//===========================