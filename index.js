const fs = require('node:fs');
const path = require('node:path');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelSelectMenuBuilder,
    ChannelType,
    Client,
    GatewayIntentBits,
    ModalBuilder,
    PermissionsBitField,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');

const DATA_FILE = path.join(__dirname, 'hinh_data.json');
const DM_REMINDER =
    'Bạn nhỏ check tin nhắn DM xem có link hay chưa? Hay bạn nhỏ xem mình có cài nhận tin nhắn không nhé!';
const ALREADY_SENT_REMINDER =
    'Bạn nhỏ ơi, nãy bạn gửi proof nhận character này rồi á, bạn nhỏ thử kiểm tra xem có nhận được qua tin nhắn DM hoặc là mình có mở mục nhận DM chưa nhé 🍵💌';
const MAX_TRIGGERS_PER_PAGE = 25;

const EMPTY_DATA = {
    triggers: {},
    logChannel: ''
};

function normalizeKeyword(keyword) {
    return keyword.trim().toLowerCase();
}

function normalizeTrigger(trigger) {
    return {
        content: typeof trigger.content === 'string' ? trigger.content : '',
        requireImage: Boolean(trigger.requireImage ?? trigger.require_image),
        channelId: typeof trigger.channelId === 'string' ? trigger.channelId : '',
        sendOnce: Boolean(trigger.sendOnce ?? trigger.send_once),
        sentUsers: Array.isArray(trigger.sentUsers)
            ? [...new Set(trigger.sentUsers.filter(userId => typeof userId === 'string'))]
            : []
    };
}

function loadData() {
    if (!fs.existsSync(DATA_FILE)) {
        return structuredClone(EMPTY_DATA);
    }

    try {
        const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        const triggers = {};

        if (raw.triggers && typeof raw.triggers === 'object') {
            for (const [keyword, trigger] of Object.entries(raw.triggers)) {
                triggers[normalizeKeyword(keyword)] = normalizeTrigger(trigger);
            }
        }

        return {
            triggers,
            logChannel: typeof raw.logChannel === 'string' ? raw.logChannel : ''
        };
    } catch (error) {
        console.error(`Không thể đọc dữ liệu ${DATA_FILE}:`, error);
        throw error;
    }
}

function saveData(data) {
    const temporaryFile = `${DATA_FILE}.tmp`;
    fs.writeFileSync(temporaryFile, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(temporaryFile, DATA_FILE);
}

const db = loadData();
const deliveryLocks = new Set();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

function adminCommand(command) {
    return command.setDefaultMemberPermissions(
        PermissionsBitField.Flags.ManageGuild
    );
}

function addTriggerOptions(command) {
    return command
        .addStringOption(option =>
            option
                .setName('keyword')
                .setDescription('Từ khóa, ví dụ: hn01')
                .setRequired(true)
                .setMaxLength(64)
        )
        .addStringOption(option =>
            option
                .setName('content')
                .setDescription('Nội dung hoặc link gửi qua DM')
                .setRequired(true)
                .setMaxLength(2000)
        )
        .addChannelOption(option =>
            option
                .setName('channel')
                .setDescription('Kênh duy nhất được phép nhận trigger này')
                .addChannelTypes(
                    ChannelType.GuildText,
                    ChannelType.GuildAnnouncement
                )
                .setRequired(true)
        )
        .addBooleanOption(option =>
            option
                .setName('require_image')
                .setDescription('Có bắt buộc tin nhắn trigger phải kèm ảnh không?')
                .setRequired(true)
        )
        .addBooleanOption(option =>
            option
                .setName('send_once')
                .setDescription('True = mỗi user chỉ nhận DM một lần')
                .setRequired(true)
        );
}

function buildAddTriggerCommand(commandName, description) {
    return addTriggerOptions(
        new SlashCommandBuilder()
            .setName(commandName)
            .setDescription(description)
    );
}

function buildRemoveTriggerCommand(commandName, description) {
    return new SlashCommandBuilder()
        .setName(commandName)
        .setDescription(description)
        .addStringOption(option =>
            option
                .setName('keyword')
                .setDescription('Từ khóa trigger cần xoá')
                .setRequired(true)
                .setMaxLength(64)
                .setAutocomplete(true)
        );
}

function buildCommands() {
    const addTriggerCommand = buildAddTriggerCommand(
        'trigger_add',
        'Tạo trigger với đầy đủ cấu hình'
    );

    const removeTriggerCommand = buildRemoveTriggerCommand(
        'trigger_remove',
        'Xoá một trigger theo từ khóa'
    );

    return [
        adminCommand(addTriggerCommand),
        adminCommand(removeTriggerCommand),
        adminCommand(
            new SlashCommandBuilder()
                .setName('edit-trigger')
                .setDescription('Chọn một trigger để chỉnh sửa')
        ),
        adminCommand(
            new SlashCommandBuilder()
                .setName('log-channel')
                .setDescription('Chọn kênh nhận log trigger')
                .addChannelOption(option =>
                    option
                        .setName('channel')
                        .setDescription('Kênh dùng để lưu log trigger')
                        .addChannelTypes(
                            ChannelType.GuildText,
                            ChannelType.GuildAnnouncement
                        )
                        .setRequired(true)
                )
        ),
        adminCommand(
            new SlashCommandBuilder()
                .setName('send')
                .setDescription('Gửi một tin nhắn vào kênh hiện tại')
                .addStringOption(option =>
                    option
                        .setName('content')
                        .setDescription('Nội dung muốn gửi')
                        .setRequired(true)
                        .setMaxLength(2000)
                )
        )
    ];
}

function isValidKeyword(keyword) {
    return keyword.length > 0 && keyword.length <= 64 && !/\s/.test(keyword);
}

function channelMention(channelId) {
    return channelId ? `<#${channelId}>` : 'Chưa cấu hình';
}

function yesNo(value) {
    return value ? 'Có' : 'Không';
}

function encodeKeyword(keyword) {
    return encodeURIComponent(keyword);
}

function decodeKeyword(value) {
    return decodeURIComponent(value);
}

function editCustomId(prefix, userId, keyword) {
    return `${prefix}:${userId}:${encodeKeyword(keyword)}`;
}

function parseEditCustomId(customId, prefix) {
    const expectedPrefix = `${prefix}:`;
    if (!customId.startsWith(expectedPrefix)) return null;

    const remainder = customId.slice(expectedPrefix.length);
    const separatorIndex = remainder.indexOf(':');
    if (separatorIndex === -1) return null;

    try {
        return {
            userId: remainder.slice(0, separatorIndex),
            keyword: decodeKeyword(remainder.slice(separatorIndex + 1))
        };
    } catch {
        return null;
    }
}

function assertComponentOwner(interaction, ownerId) {
    return interaction.user.id === ownerId;
}

function buildTriggerListPage(userId, page = 0) {
    const keywords = Object.keys(db.triggers).sort((a, b) => a.localeCompare(b));
    const pageCount = Math.max(1, Math.ceil(keywords.length / MAX_TRIGGERS_PER_PAGE));
    const safePage = Math.min(Math.max(page, 0), pageCount - 1);
    const pageKeywords = keywords.slice(
        safePage * MAX_TRIGGERS_PER_PAGE,
        (safePage + 1) * MAX_TRIGGERS_PER_PAGE
    );

    const menu = new StringSelectMenuBuilder()
        .setCustomId(`trigger-list:${userId}:${safePage}`)
        .setPlaceholder('Chọn trigger cần chỉnh sửa')
        .addOptions(
            pageKeywords.map(keyword =>
                new StringSelectMenuOptionBuilder()
                    .setLabel(keyword.slice(0, 100))
                    .setValue(keyword)
                    .setDescription(
                        `Kênh: ${db.triggers[keyword].channelId ? 'đã chọn' : 'chưa chọn'}`
                    )
            )
        );

    const rows = [new ActionRowBuilder().addComponents(menu)];
    if (pageCount > 1) {
        rows.push(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`trigger-page:${userId}:${safePage - 1}`)
                    .setLabel('Trang trước')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(safePage === 0),
                new ButtonBuilder()
                    .setCustomId(`trigger-page:${userId}:${safePage + 1}`)
                    .setLabel('Trang sau')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(safePage === pageCount - 1)
            )
        );
    }

    return {
        content: `Chọn trigger cần chỉnh sửa (trang ${safePage + 1}/${pageCount}):`,
        components: rows,
        ephemeral: true
    };
}

function buildEditPanel(keyword, userId) {
    const trigger = db.triggers[keyword];
    if (!trigger) {
        return {
            content: 'Trigger này không còn tồn tại.',
            components: [],
            ephemeral: true
        };
    }

    const previewContent =
        trigger.content.length > 900
            ? `${trigger.content.slice(0, 897)}...`
            : trigger.content;

    const channelRow = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId(editCustomId('edit-channel', userId, keyword))
            .setPlaceholder('Chọn kênh được phép gửi trigger')
            .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setMinValues(1)
            .setMaxValues(1)
    );

    const imageRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(editCustomId('edit-image', userId, keyword))
            .setPlaceholder(`Bắt buộc ảnh: ${yesNo(trigger.requireImage)}`)
            .addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel('True - bắt buộc kèm ảnh')
                    .setValue('true')
                    .setDefault(trigger.requireImage),
                new StringSelectMenuOptionBuilder()
                    .setLabel('False - không bắt buộc ảnh')
                    .setValue('false')
                    .setDefault(!trigger.requireImage)
            )
    );

    const onceRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(editCustomId('edit-once', userId, keyword))
            .setPlaceholder(`Chỉ gửi một lần: ${yesNo(trigger.sendOnce)}`)
            .addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel('True - mỗi user chỉ nhận một lần')
                    .setValue('true')
                    .setDefault(trigger.sendOnce),
                new StringSelectMenuOptionBuilder()
                    .setLabel('False - có thể nhận lại')
                    .setValue('false')
                    .setDefault(!trigger.sendOnce)
            )
    );

    const buttonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(editCustomId('edit-content', userId, keyword))
            .setLabel('Sửa nội dung / link')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`trigger-list:${userId}:0`)
            .setLabel('Quay lại danh sách')
            .setStyle(ButtonStyle.Secondary)
    );

    return {
        content:
            `**Đang chỉnh sửa trigger:** \`${keyword}\`\n` +
            `**Nội dung hiện tại:**\n${previewContent}\n\n` +
            `**Kênh:** ${channelMention(trigger.channelId)}\n` +
            `**Bắt buộc ảnh:** ${yesNo(trigger.requireImage)}\n` +
            `**Chỉ gửi một lần / user:** ${yesNo(trigger.sendOnce)}\n` +
            `**Đã gửi cho:** ${trigger.sentUsers.length} user`,
        components: [channelRow, imageRow, onceRow, buttonRow],
        ephemeral: true
    };
}

function buildContentModal(keyword, userId) {
    const input = new TextInputBuilder()
        .setCustomId('content')
        .setLabel('Nội dung hoặc link gửi qua DM')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(2000)
        .setValue(db.triggers[keyword].content);

    return new ModalBuilder()
        .setCustomId(editCustomId('edit-content-modal', userId, keyword))
        .setTitle(`Sửa trigger: ${keyword.slice(0, 35)}`)
        .addComponents(new ActionRowBuilder().addComponents(input));
}

async function sendTemporaryMessage(channel, content, userId) {
    const temporaryMessage = await channel.send({
        content: `${userId ? `<@${userId}> ` : ''}${content}`,
        allowedMentions: userId ? { users: [userId] } : { parse: [] }
    });

    setTimeout(() => {
        temporaryMessage.delete().catch(error => {
            if (error.code !== 10008) {
                console.error('Lỗi xóa tin nhắn tạm thời:', error);
            }
        });
    }, 7000);
}

async function downloadAttachment(sourceAttachment) {
    const response = await fetch(sourceAttachment.url);
    if (!response.ok) {
        throw new Error(`Không tải được ảnh đính kèm: HTTP ${response.status}`);
    }

    return {
        attachment: Buffer.from(await response.arrayBuffer()),
        name: sourceAttachment.name || 'trigger-attachment'
    };
}

async function sendTriggerLog({ message, keyword, attachment }) {
    if (!db.logChannel) return;

    const logChannel = await client.channels.fetch(db.logChannel);
    if (!logChannel || !logChannel.isTextBased()) {
        throw new Error(`Kênh log ${db.logChannel} không phải kênh text hợp lệ.`);
    }

    const files = attachment ? [attachment] : [];
    await logChannel.send({
        content:
            `Trigger log\n` +
            `User: ${message.author.tag} (${message.author.id})\n` +
            `Trigger: ${keyword}\n` +
            `Kênh: ${message.channel.id}`,
        files
    });
}

async function handleChatInputCommand(interaction) {
    // Defer ngay lập tức để tránh lỗi "Ứng dụng không phản hồi" khi
    // xử lý mất hơn 3 giây (ví dụ bot vừa mới khởi động, I/O chậm...).
    // Sau defer, Discord cho tối đa 15 phút để trả lời qua editReply().
    await interaction.deferReply({ ephemeral: true });

    if (interaction.commandName === 'trigger_add') {
        const keyword = normalizeKeyword(interaction.options.getString('keyword'));
        const content = interaction.options.getString('content').trim();
        const channel = interaction.options.getChannel('channel');
        const requireImage = interaction.options.getBoolean('require_image');
        const sendOnce = interaction.options.getBoolean('send_once');

        if (!isValidKeyword(keyword)) {
            await interaction.editReply({
                content: '❌ Keyword phải viết liền, không chứa khoảng trắng và dài tối đa 64 ký tự.'
            });
            return;
        }

        if (!content) {
            await interaction.editReply({
                content: '❌ Nội dung DM không được để trống.'
            });
            return;
        }

        if (db.triggers[keyword]) {
            await interaction.editReply({
                content: `❌ Trigger **${keyword}** đã tồn tại. Dùng \`/edit-trigger\` để chỉnh sửa.`
            });
            return;
        }

        db.triggers[keyword] = {
            content,
            requireImage,
            channelId: channel.id,
            sendOnce,
            sentUsers: []
        };
        saveData(db);

        await interaction.editReply({
            content:
                `✅ Đã thêm trigger **${keyword}**.\n` +
                `- Kênh được phép: <#${channel.id}>\n` +
                `- Bắt buộc ảnh: **${yesNo(requireImage)}**\n` +
                `- Chỉ gửi một lần / user: **${yesNo(sendOnce)}**`
        });
        return;
    }

    if (interaction.commandName === 'trigger_remove') {
        const keyword = normalizeKeyword(interaction.options.getString('keyword'));

        if (!db.triggers[keyword]) {
            await interaction.editReply({
                content: `❌ Không tìm thấy trigger **${keyword}**.`
            });
            return;
        }

        delete db.triggers[keyword];
        saveData(db);

        await interaction.editReply({
            content: `✅ Đã xoá trigger **${keyword}**.`
        });
        return;
    }

    if (interaction.commandName === 'edit-trigger') {
        const keywords = Object.keys(db.triggers);
        if (keywords.length === 0) {
            await interaction.editReply({
                content: 'Chưa có trigger nào. Hãy dùng `/trigger_add` trước.'
            });
            return;
        }

        const page = buildTriggerListPage(interaction.user.id);
        await interaction.editReply({
            content: page.content,
            components: page.components
        });
        return;
    }

    if (interaction.commandName === 'log-channel') {
        const channel = interaction.options.getChannel('channel');
        db.logChannel = channel.id;
        saveData(db);

        await interaction.editReply({
            content: `✅ Đã lưu kênh log trigger tại <#${channel.id}>.`
        });
        return;
    }

    if (interaction.commandName === 'send') {
        const content = interaction.options.getString('content');
        await interaction.channel.send(content);
        await interaction.editReply({
            content: '✅ Đã gửi tin nhắn vào kênh hiện tại.'
        });
    }
}

async function handleAutocompleteInteraction(interaction) {
    if (interaction.commandName !== 'trigger_remove') return;

    const focused = interaction.options.getFocused().toLowerCase();
    const choices = Object.keys(db.triggers)
        .filter(keyword => keyword.includes(focused))
        .slice(0, 25)
        .map(keyword => ({ name: keyword, value: keyword }));

    await interaction.respond(choices).catch(() => {});
}

async function handleSelectMenuInteraction(interaction) {
    if (interaction.customId.startsWith('trigger-list:')) {
        const [, ownerId] = interaction.customId.split(':');
        if (!assertComponentOwner(interaction, ownerId)) {
            await interaction.reply({
                content: 'Bảng chỉnh sửa này thuộc về người đã mở nó.',
                ephemeral: true
            });
            return;
        }

        const keyword = normalizeKeyword(interaction.values[0]);
        if (!db.triggers[keyword]) {
            await interaction.update({
                content: 'Trigger này không còn tồn tại.',
                components: []
            });
            return;
        }

        await interaction.update(buildEditPanel(keyword, ownerId));
        return;
    }

    for (const prefix of ['edit-channel', 'edit-image', 'edit-once']) {
        const parsed = parseEditCustomId(interaction.customId, prefix);
        if (!parsed) continue;

        if (!assertComponentOwner(interaction, parsed.userId)) {
            await interaction.reply({
                content: 'Bảng chỉnh sửa này thuộc về người đã mở nó.',
                ephemeral: true
            });
            return;
        }

        const trigger = db.triggers[parsed.keyword];
        if (!trigger) {
            await interaction.update({
                content: 'Trigger này không còn tồn tại.',
                components: []
            });
            return;
        }

        if (prefix === 'edit-channel') {
            trigger.channelId = interaction.values[0];
        } else if (prefix === 'edit-image') {
            trigger.requireImage = interaction.values[0] === 'true';
        } else {
            const newSendOnce = interaction.values[0] === 'true';
            if (newSendOnce && !trigger.sendOnce) {
                trigger.sentUsers = [];
            }
            trigger.sendOnce = newSendOnce;
        }

        saveData(db);
        await interaction.update(buildEditPanel(parsed.keyword, parsed.userId));
        return;
    }
}

async function handleButtonInteraction(interaction) {
    if (interaction.customId.startsWith('trigger-page:')) {
        const [, ownerId, pageValue] = interaction.customId.split(':');
        if (!assertComponentOwner(interaction, ownerId)) {
            await interaction.reply({
                content: 'Bảng chỉnh sửa này thuộc về người đã mở nó.',
                ephemeral: true
            });
            return;
        }

        await interaction.update(
            buildTriggerListPage(ownerId, Number.parseInt(pageValue, 10))
        );
        return;
    }

    if (interaction.customId.startsWith('trigger-list:')) {
        const [, ownerId] = interaction.customId.split(':');
        if (!assertComponentOwner(interaction, ownerId)) {
            await interaction.reply({
                content: 'Bảng chỉnh sửa này thuộc về người đã mở nó.',
                ephemeral: true
            });
            return;
        }

        await interaction.update(buildTriggerListPage(ownerId));
        return;
    }

    const parsed = parseEditCustomId(interaction.customId, 'edit-content');
    if (!parsed) return;

    if (!assertComponentOwner(interaction, parsed.userId)) {
        await interaction.reply({
            content: 'Bảng chỉnh sửa này thuộc về người đã mở nó.',
            ephemeral: true
        });
        return;
    }

    if (!db.triggers[parsed.keyword]) {
        await interaction.reply({
            content: 'Trigger này không còn tồn tại.',
            ephemeral: true
        });
        return;
    }

    await interaction.showModal(buildContentModal(parsed.keyword, parsed.userId));
}

async function handleModalSubmit(interaction) {
    const parsed = parseEditCustomId(interaction.customId, 'edit-content-modal');
    if (!parsed) return;

    if (!assertComponentOwner(interaction, parsed.userId)) {
        await interaction.reply({
            content: 'Bảng chỉnh sửa này thuộc về người đã mở nó.',
            ephemeral: true
        });
        return;
    }

    const trigger = db.triggers[parsed.keyword];
    if (!trigger) {
        await interaction.reply({
            content: 'Trigger này không còn tồn tại.',
            ephemeral: true
        });
        return;
    }

    trigger.content = interaction.fields.getTextInputValue('content').trim();
    saveData(db);
    await interaction.reply({
        content: `✅ Đã cập nhật nội dung trigger **${parsed.keyword}**.`,
        ephemeral: true
    });
}

client.once('clientReady', async readyClient => {
    console.log(`Bot ${readyClient.user.tag} đã đăng nhập.`);

    for (const guild of readyClient.guilds.cache.values()) {
        try {
            await guild.commands.set(buildCommands());
            console.log(`Đã đăng ký slash command cho server: ${guild.name}`);
        } catch (error) {
            console.error(`Không thể đăng ký lệnh cho server ${guild.id}:`, error);
        }
    }
});

client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isChatInputCommand()) {
            await handleChatInputCommand(interaction);
        } else if (interaction.isAutocomplete()) {
            await handleAutocompleteInteraction(interaction);
        } else if (interaction.isStringSelectMenu() || interaction.isChannelSelectMenu()) {
            await handleSelectMenuInteraction(interaction);
        } else if (interaction.isButton()) {
            await handleButtonInteraction(interaction);
        } else if (interaction.isModalSubmit()) {
            await handleModalSubmit(interaction);
        }
    } catch (error) {
        console.error('Lỗi khi xử lý interaction:', error);

        if (interaction.isAutocomplete()) return;

        const reply = {
            content: 'Đã xảy ra lỗi khi xử lý lệnh. Vui lòng thử lại sau.',
            ephemeral: true
        };

        if (interaction.replied || interaction.deferred) {
            await interaction.editReply(reply).catch(() => {
                interaction.followUp(reply).catch(console.error);
            });
        } else {
            await interaction.reply(reply).catch(console.error);
        }
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    const keyword = normalizeKeyword(message.content);
    const trigger = db.triggers[keyword];
    if (!trigger) return;

    if (trigger.channelId && trigger.channelId !== message.channel.id) {
        await sendTemporaryMessage(
            message.channel,
            `⚠️ Trigger **${keyword}** chỉ được phép gửi tại ${channelMention(
                trigger.channelId
            )}. Bạn nhỏ gửi lại đúng kênh nhé!`,
            message.author.id
        );
        return;
    }

    const lockKey = `${keyword}:${message.author.id}`;
    if (trigger.sendOnce && trigger.sentUsers.includes(message.author.id)) {
        await sendTemporaryMessage(message.channel, ALREADY_SENT_REMINDER, message.author.id);
        return;
    }

    if (deliveryLocks.has(lockKey)) return;
    deliveryLocks.add(lockKey);

    try {
        const sourceAttachment = message.attachments.first();
        if (trigger.requireImage && !sourceAttachment) {
            await sendTemporaryMessage(
                message.channel,
                'Trigger này cần kèm ảnh. Bạn nhỏ gửi lại keyword cùng với ảnh nhé!',
                message.author.id
            );
            return;
        }

        let attachment;
        if (sourceAttachment) {
            try {
                attachment = await downloadAttachment(sourceAttachment);
            } catch (error) {
                console.error('Không thể tải file đính kèm để log:', error);
                await sendTemporaryMessage(
                    message.channel,
                    'Bot chưa lấy được ảnh đính kèm. Bạn nhỏ thử lại nhé!',
                    message.author.id
                );
                return;
            }
        }

        try {
            await message.author.send(trigger.content);
        } catch (error) {
            console.error(`Không thể gửi DM cho ${message.author.tag}:`, error.code || error.message);
            await sendTemporaryMessage(message.channel, DM_REMINDER, message.author.id);
            return;
        }

        if (trigger.sendOnce && !trigger.sentUsers.includes(message.author.id)) {
            trigger.sentUsers.push(message.author.id);
            saveData(db);
        }

        await message.delete().catch(error => {
            if (error.code !== 10008) {
                console.error('Không thể xóa tin nhắn trigger:', error);
            }
        });

        try {
            await sendTriggerLog({ message, keyword, attachment });
        } catch (error) {
            console.error('Không thể gửi log trigger:', error);
        }
    } finally {
        deliveryLocks.delete(lockKey);
    }
});

client.on('error', error => {
    console.error('Discord client error:', error);
});

if (!process.env.DISCORD_TOKEN) {
    console.error('Thiếu secret DISCORD_TOKEN. Hãy thêm token bot vào Secrets rồi chạy lại.');
    process.exitCode = 1;
} else {
    client.login(process.env.DISCORD_TOKEN).catch(error => {
        console.error('Đăng nhập Discord thất bại:', error);
        process.exitCode = 1;
    });
}
