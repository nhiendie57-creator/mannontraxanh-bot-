index.js

const express = require('express');
const app = express();
app.get('/', (req, res) => res.send('Osin của Hinh đang thức nha!'));
app.listen(3000, () => console.log('Đã cắm bình truyền thái y thành công!'));




const fs = require('fs');
const path = require('path');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Client,
    EmbedBuilder,
    GatewayIntentBits,
    ModalBuilder,
    SlashCommandBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');

const DATA_FILE = path.join(__dirname, 'hinh_data.json');
const DEFAULT_DATA = { triggers: {}, embeds: {}, logChannel: '' };

function loadData() {
    if (!fs.existsSync(DATA_FILE)) {
        return { ...DEFAULT_DATA };
    }

    try {
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        return {
            triggers: data.triggers && typeof data.triggers === 'object' ? data.triggers : {},
            embeds: data.embeds && typeof data.embeds === 'object' ? data.embeds : {},
            logChannel: typeof data.logChannel === 'string' ? data.logChannel : ''
        };
    } catch (error) {
        console.error(`Không thể đọc ${DATA_FILE}:`, error);
        throw error;
    }
}

function saveData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 4), 'utf8');
}

const db = loadData();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

function buildCommands() {
    return [
        new SlashCommandBuilder()
            .setName('setup-welcome')
            .setDescription('Chỉ định kênh để Osin đứng đón khách')
            .addChannelOption(option =>
                option
                    .setName('kenh')
                    .setDescription('Bấm vào để chọn kênh trong server')
                    .setRequired(true)
            ),
        new SlashCommandBuilder()
            .setName('send')
            .setDescription('Sai Osin gửi tin nhắn hộ Chủ tiệm')
            .addStringOption(option =>
                option
                    .setName('noidung')
                    .setDescription('Nhập nội dung thư muốn gửi đi')
                    .setRequired(true)
                    .setMaxLength(2000)
            ),
        new SlashCommandBuilder()
            .setName('log_channel')
            .setDescription('Chọn kênh nhận log trigger')
            .addChannelOption(option =>
                option
                    .setName('channel')
                    .setDescription('Kênh dùng để lưu log trigger')
                    .setRequired(true)
            ),
        new SlashCommandBuilder()
            .setName('trigger_add')
            .setDescription('Tạo từ khóa ẩn giấu link')
            .addStringOption(option =>
                option
                    .setName('keyword')
                    .setDescription('Từ khóa kích hoạt, ví dụ: hn01')
                    .setRequired(true)
                    .setMaxLength(100)
            )
            .addStringOption(option =>
                option
                    .setName('content')
                    .setDescription('Nội dung hoặc link sẽ gửi qua DM')
                    .setRequired(true)
                    .setMaxLength(2000)
            )
            .addBooleanOption(option =>
                option
                    .setName('require_image')
                    .setDescription('Có bắt buộc tin nhắn phải kèm ảnh không?')
                    .setRequired(true)
            ),
        new SlashCommandBuilder()
            .setName('embed_create')
            .setDescription('Tạo một khuôn Embed mới')
            .addStringOption(option =>
                option
                    .setName('name')
                    .setDescription('Tên khuôn Embed')
                    .setRequired(true)
                    .setMaxLength(60)
            ),
        new SlashCommandBuilder()
            .setName('embed_edit')
            .setDescription('Mở bảng trang trí Embed')
            .addStringOption(option =>
                option
                    .setName('name')
                    .setDescription('Tên khuôn Embed cần chỉnh sửa')
                    .setRequired(true)
                    .setMaxLength(60)
            ),
        new SlashCommandBuilder()
            .setName('embed_remove')
            .setDescription('Xóa một khuôn Embed')
            .addStringOption(option =>
                option
                    .setName('name')
                    .setDescription('Tên khuôn Embed cần xóa')
                    .setRequired(true)
                    .setMaxLength(60)
            )
    ];
}

function getEmbedButtonRows(embedName) {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`embed:author:${embedName}`)
                .setLabel('Đầu Embed')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`embed:content:${embedName}`)
                .setLabel('Tiêu đề & Nội dung')
                .setStyle(ButtonStyle.Success)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`embed:footer:${embedName}`)
                .setLabel('Chân Embed')
                .setStyle(ButtonStyle.Success)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`embed:color:${embedName}`)
                .setLabel('Màu')
                .setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`embed:test:${embedName}`)
                .setLabel('Gửi Test')
                .setStyle(ButtonStyle.Primary)
        )
    ];
}

function getEmbedContentModal(embedName) {
    const titleInput = new TextInputBuilder()
        .setCustomId('embed-title')
        .setLabel('Tiêu đề Embed')
        .setStyle(TextInputStyle.Short)
        .setRequired(false);

    const descriptionInput = new TextInputBuilder()
        .setCustomId('embed-description')
        .setLabel('Nội dung chính')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

    return new ModalBuilder()
        .setCustomId(`embed-content:${embedName}`)
        .setTitle('Soạn Thảo Nội Dung')
        .addComponents(
            new ActionRowBuilder().addComponents(titleInput),
            new ActionRowBuilder().addComponents(descriptionInput)
        );
}

async function handleChatInputCommand(interaction) {
    if (interaction.commandName === 'setup-welcome') {
        const channel = interaction.options.getChannel('kenh');
        await interaction.reply(`*Khẽ cúi đầu* Đệ đã cắm chốt tại kênh <#${channel.id}> rồi ạ.`);
        return;
    }

    if (interaction.commandName === 'send') {
        const text = interaction.options.getString('noidung');
        await interaction.channel.send(text);
        await interaction.reply({
            content: 'Đã truyền tin đi không để lại dấu vết!',
            ephemeral: true
        });
        return;
    }

    if (interaction.commandName === 'log_channel') {
        const channel = interaction.options.getChannel('channel');
        db.logChannel = channel.id;
        saveData(db);

        await interaction.reply({
            content: `✅ Đã lưu kênh log tại <#${channel.id}> thành công.`,
            ephemeral: true
        });
        return;
    }

    if (interaction.commandName === 'trigger_add') {
        const keyword = interaction.options.getString('keyword').trim().toLowerCase();
        const content = interaction.options.getString('content');
        const requireImage = interaction.options.getBoolean('require_image');

        db.triggers[keyword] = { content, requireImage };
        saveData(db);
        await interaction.reply({
            content: `✅ Đã lên đạn cho từ khóa **${keyword}**!`,
            ephemeral: true
        });
        return;
    }

    if (interaction.commandName === 'embed_create') {
        const name = interaction.options.getString('name').trim();
        if (db.embeds[name]) {
            await interaction.reply({ content: 'Tên này có rồi đại ca!', ephemeral: true });
            return;
        }

        db.embeds[name] = {};
        saveData(db);
        await interaction.reply({
            content: `✅ Đã tạo khuôn: ${name}. Dùng \`/embed_edit\` để trang trí.`,
            ephemeral: true
        });
        return;
    }

    if (interaction.commandName === 'embed_edit') {
        const name = interaction.options.getString('name').trim();
        if (!db.embeds[name]) {
            await interaction.reply({ content: 'Không tìm thấy Embed này!', ephemeral: true });
            return;
        }

        await interaction.reply({
            content: `Bảng điều khiển của **${name}**:`,
            components: getEmbedButtonRows(name),
            ephemeral: true
        });
        return;
    }

    if (interaction.commandName === 'embed_remove') {
        const name = interaction.options.getString('name').trim();
        if (!db.embeds[name]) {
            await interaction.reply({ content: 'Nó chưa từng tồn tại...', ephemeral: true });
            return;
        }

        delete db.embeds[name];
        saveData(db);
        await interaction.reply({ content: `🗑️ Đã bốc hơi ${name}!`, ephemeral: true });
    }
}

async function handleButtonInteraction(interaction) {
    const prefix = 'embed:';
    if (!interaction.customId.startsWith(prefix)) return;

    const [, action, ...nameParts] = interaction.customId.split(':');
    const embedName = nameParts.join(':');

    if (!db.embeds[embedName]) {
        await interaction.reply({ content: 'Khuôn Embed này không còn tồn tại.', ephemeral: true });
        return;
    }

    if (action === 'content') {
        await interaction.showModal(getEmbedContentModal(embedName));
        return;
    }

    if (action === 'author') {
        await interaction.reply({
            content: 'Mở form nhập Tên & Icon Author ở bước tiếp theo.',
            ephemeral: true
        });
        return;
    }

    if (action === 'footer') {
        await interaction.reply({ content: 'Mở form chân Embed ở bước tiếp theo.', ephemeral: true });
        return;
    }

    if (action === 'color') {
        await interaction.reply({ content: 'Mở form mã màu HEX ở bước tiếp theo.', ephemeral: true });
        return;
    }

    if (action === 'test') {
        const data = db.embeds[embedName];
        const testEmbed = new EmbedBuilder()
            .setTitle(data.title || 'Chưa có tiêu đề')
            .setDescription(data.description || 'Chưa có nội dung')
            .setColor(Math.floor(Math.random() * 0xffffff));

        await interaction.deferReply({ ephemeral: true });
        await interaction.channel.send({ embeds: [testEmbed] });
        await interaction.editReply('Đã gửi bản Embed thử nghiệm!');
    }
}

async function handleModalSubmit(interaction) {
    const prefix = 'embed-content:';
    if (!interaction.customId.startsWith(prefix)) return;

    const embedName = interaction.customId.slice(prefix.length);
    if (!db.embeds[embedName]) {
        await interaction.reply({ content: 'Khuôn Embed này không còn tồn tại.', ephemeral: true });
        return;
    }

    db.embeds[embedName].title = interaction.fields.getTextInputValue('embed-title');
    db.embeds[embedName].description = interaction.fields.getTextInputValue('embed-description');
    saveData(db);
    await interaction.reply({ content: '✅ Đã cập nhật ruột Embed!', ephemeral: true });
}

client.once('clientReady', async readyClient => {
    console.log(`Báo cáo, ${readyClient.user.tag} đã lên đồ!`);
    await readyClient.application.commands.set(buildCommands());
    console.log('Đã nạp bộ lệnh Slash và hệ thống quản trị Embed thành công!');
});

client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isChatInputCommand()) {
            await handleChatInputCommand(interaction);
        } else if (interaction.isButton()) {
            await handleButtonInteraction(interaction);
        } else if (interaction.isModalSubmit()) {
            await handleModalSubmit(interaction);
        }
    } catch (error) {
        console.error('Lỗi khi xử lý interaction:', error);
        const reply = {
            content: 'Đã xảy ra lỗi khi xử lý lệnh. Vui lòng thử lại sau.',
            ephemeral: true
        };

        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(reply).catch(console.error);
        } else {
            await interaction.reply(reply).catch(console.error);
        }
    }
});

async function sendTemporaryMessage(channel, content, userId) {
    const temporaryMessage = await channel.send({
        content,
        allowedMentions: { users: [userId] },
        deleteAfter: 5000
    });

    // Fallback cho trường hợp phiên bản discord.js không tự xử lý deleteAfter.
    setTimeout(() => {
        temporaryMessage.delete().catch(error => {
            // Mã 10008 nghĩa là tin nhắn đã được xóa rồi, không cần báo lỗi.
            if (error.code !== 10008) {
                console.error('Lỗi xóa tin nhắn tạm thời:', error);
            }
        });
    }, 5000);

    return temporaryMessage;
}

async function downloadAttachmentForLog(sourceAttachment) {
    const response = await fetch(sourceAttachment.url);
    if (!response.ok) {
        throw new Error(`Không tải được ảnh đính kèm: HTTP ${response.status}`);
    }

    return {
        attachment: Buffer.from(await response.arrayBuffer()),
        name: sourceAttachment.name || 'trigger-image'
    };
}

async function sendTriggerLog({ message, keyword, attachment }) {
    if (!db.logChannel) {
        console.warn('Chưa cấu hình db.logChannel, bỏ qua log trigger.');
        return;
    }

    const logChannel = await client.channels.fetch(db.logChannel);
    if (!logChannel || !logChannel.isTextBased()) {
        throw new Error(`Kênh log ${db.logChannel} không phải kênh text hợp lệ.`);
    }

    const logEmbed = new EmbedBuilder()
        .setTitle('Trigger Log')
        .addFields(
            {
                name: 'Tên User',
                value: message.author.toString(),
                inline: true
            },
            {
                name: 'Từ khóa trigger',
                value: `\`${keyword}\``,
                inline: true
            },
            {
                name: 'Kênh thực hiện',
                value: message.channel.toString(),
                inline: true
            }
        )
        .setImage(`attachment://${attachment.name}`)
        .setTimestamp();

    await logChannel.send({
        embeds: [logEmbed],
        files: [attachment]
    });
}

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    const keyword = message.content.trim().toLowerCase();
    const triggerData = db.triggers[keyword];
    if (!triggerData) return;

    const requiresImage = triggerData.requireImage ?? triggerData.require_image ?? false;
    const sourceAttachment = message.attachments.first();

    // Phải lấy được attachment trước khi xóa message gốc.
    if (!sourceAttachment) {
        await sendTemporaryMessage(
            message.channel,
            requiresImage
                ? `${message.author} Bạn nhỏ ơi bắt quả tang lấy link mà không kèm ảnh nha! Vui lòng gửi lại.`
                : `${message.author} Tin nhắn trigger phải kèm ảnh để bot lưu log.`,
            message.author.id
        );
        return;
    }

    // Tải ảnh thành Buffer trước khi xóa message, tránh URL CDN bị vô hiệu hóa.
    let attachment;
    try {
        attachment = await downloadAttachmentForLog(sourceAttachment);
    } catch (error) {
        console.error('Không thể lưu ảnh trigger trước khi xóa message:', error);
        await sendTemporaryMessage(
            message.channel,
            `${message.author} Bot chưa lấy được ảnh để lưu log. Vui lòng thử lại.`,
            message.author.id
        );
        return;
    }

    // Chỉ tiếp tục nếu xóa được message gốc.
    try {
        await message.delete();
    } catch (error) {
        console.error('Không thể xóa tin nhắn trigger:', error);
        return;
    }

    try {
        await message.author.send(triggerData.content);
    } catch (error) {
        await sendTemporaryMessage(
            message.channel,
            `${message.author} Mở DMs lên để nhận link báu vật nha!`,
            message.author.id
        );
        return;
    }

    try {
        await sendTriggerLog({ message, keyword, attachment });
    } catch (error) {
        console.error('Không thể gửi log trigger:', error);
    }
});

client.on('error', error => {
    console.error('Discord client error:', error);
});

client.login(process.env.DISCORD_TOKEN);
