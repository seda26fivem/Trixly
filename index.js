require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    PermissionFlagsBits, 
    ActionRowBuilder, 
    StringSelectMenuBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ChannelType, 
    EmbedBuilder, 
    REST, 
    Routes, 
    SlashCommandBuilder,
    AttachmentBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle 
} = require('discord.js');
const mongoose = require('mongoose');

// --- MONGODB DATABASE MODEL ---
const guildSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true },
    categoryId: { type: String, required: true },
    staffRoleId: { type: String, required: true },
    transcriptChannelId: { type: String, required: true }
});

const GuildConfig = mongoose.model('GuildConfig', guildSchema);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

const commands = [
    new SlashCommandBuilder()
        .setName('setup-tickets')
        .setDescription('Setup the advanced ticket system')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(option => 
            option.setName('category')
                .setDescription('The category where tickets will be created')
                .addChannelTypes(ChannelType.GuildCategory)
                .setRequired(true))
        .addRoleOption(option => 
            option.setName('staff_role')
                .setDescription('The staff role that can view and manage tickets')
                .setRequired(true))
        .addChannelOption(option => 
            option.setName('transcript_channel')
                .setDescription('The channel where closed ticket transcripts will be sent')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true))
];

client.once('ready', async () => {
    console.log(`🤖 ${client.user.tag} is online and ready for action!`);

    // Verbinden met MongoDB
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('📦 Connected to MongoDB successfully!');
    } catch (error) {
        console.error('❌ Failed to connect to MongoDB:', error);
    }
    
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        console.log('Registering slash commands...');
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log('Slash commands registered successfully!');
    } catch (error) {
        console.error('Failed to register commands:', error);
    }
});

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'setup-tickets') {
            const category = interaction.options.getChannel('category');
            const staffRole = interaction.options.getRole('staff_role');
            const transcriptChannel = interaction.options.getChannel('transcript_channel');

            // Opslaan in MongoDB (upsert: aanmaken als het niet bestaat, updaten als het al bestaat)
            await GuildConfig.findOneAndUpdate(
                { guildId: interaction.guildId },
                { 
                    categoryId: category.id,
                    staffRoleId: staffRole.id,
                    transcriptChannelId: transcriptChannel.id
                },
                { upsert: true, new: true }
            );

            const embed = new EmbedBuilder()
                .setTitle('🎫 Support Tickets')
                .setDescription('Please select a category below to open a support ticket.')
                .setColor(0x5865F2)
                .setFooter({ text: 'Tixly Ticket System' });

            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('ticket_select')
                    .setPlaceholder('Choose a topic...')
                    .addOptions([
                        {
                            label: 'General Support',
                            description: 'For general questions and inquiries',
                            value: 'support_general',
                            emoji: '💬'
                        },
                        {
                            label: 'Technical Issues',
                            description: 'For technical bugs or problems',
                            value: 'support_tech',
                            emoji: '⚙️'
                        },
                        {
                            label: 'Report / Complaint',
                            description: 'Submit a report or file a complaint',
                            value: 'support_report',
                            emoji: '⚠️'
                        }
                    ])
            );

            await interaction.reply({ content: 'Ticket panel successfully created!', ephemeral: true });
            await interaction.channel.send({ embeds: [embed], components: [row] });
        }
    }

    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'ticket_select') {
            const selectedValue = interaction.values[0];

            const modal = new ModalBuilder()
                .setCustomId(`modal_${selectedValue}`)
                .setTitle('Create Support Ticket');

            const reasonInput = new TextInputBuilder()
                .setCustomId('ticket_reason')
                .setLabel('Please describe your issue or question')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Type your details here...')
                .setRequired(true)
                .setMaxLength(1000);

            const firstActionRow = new ActionRowBuilder().addComponents(reasonInput);
            modal.addComponents(firstActionRow);

            await interaction.showModal(modal);
        }
    }

    if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('modal_')) {
            // Config ophalen uit MongoDB
            const config = await GuildConfig.findOne({ guildId: interaction.guildId });
            if (!config) {
                return interaction.reply({ content: 'The ticket system has not been set up on this server yet.', ephemeral: true });
            }

            const modalType = interaction.customId.replace('modal_', '');
            let subjectName = 'support';
            if (modalType === 'support_general') subjectName = 'general';
            if (modalType === 'support_tech') subjectName = 'technical';
            if (modalType === 'support_report') subjectName = 'report';

            const reasonText = interaction.fields.getTextInputValue('ticket_reason');

            const ticketChannel = await interaction.guild.channels.create({
                name: `ticket-${subjectName}-${interaction.user.username}`,
                type: ChannelType.GuildText,
                parent: config.categoryId,
                permissionOverwrites: [
                    {
                        id: interaction.guild.roles.everyone.id,
                        deny: [PermissionFlagsBits.ViewChannel]
                    },
                    {
                        id: interaction.user.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
                    },
                    {
                        id: config.staffRoleId,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
                    }
                ]
            });

            const actionRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('claim_ticket')
                    .setLabel('Claim Ticket')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji('🙋‍♂️'),
                new ButtonBuilder()
                    .setCustomId('close_ticket')
                    .setLabel('Close Ticket')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🔒')
            );

            const ticketEmbed = new EmbedBuilder()
                .setTitle(`Ticket: ${subjectName.toUpperCase()}`)
                .setDescription(`Welcome <@${interaction.user.id}>!\nThe support team (<@&${config.staffRoleId}>) will be with you shortly.`)
                .addFields(
                    { name: 'Reason / Description', value: reasonText }
                )
                .setColor(0x5865F2)
                .setTimestamp();

            await ticketChannel.send({
                content: `<@${interaction.user.id}> | <@&${config.staffRoleId}>`,
                embeds: [ticketEmbed],
                components: [actionRow]
            });

            await interaction.reply({ content: `Your ticket has been created: ${ticketChannel}`, ephemeral: true });
        }
    }

    if (interaction.isButton()) {
        if (interaction.customId === 'claim_ticket') {
            const config = await GuildConfig.findOne({ guildId: interaction.guildId });
            if (!config) return;

            if (!interaction.member.roles.cache.has(config.staffRoleId) && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ content: 'Only staff members can claim tickets!', ephemeral: true });
            }

            const message = interaction.message;
            const oldRow = message.components[0];
            
            const updatedRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('claim_ticket')
                    .setLabel(`Claimed by ${interaction.user.username}`)
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true),
                oldRow.components[1]
            );

            await message.edit({ components: [updatedRow] });
            await interaction.reply({ content: `✅ This ticket has been claimed by <@${interaction.user.id}>!` });
        }

        if (interaction.customId === 'close_ticket') {
            const config = await GuildConfig.findOne({ guildId: interaction.guildId });
            
            await interaction.reply({ content: '🔒 Generating transcript and closing ticket in 5 seconds...' });

            try {
                const messages = await interaction.channel.messages.fetch({ limit: 100 });
                
                const transcriptData = messages
                    .reverse()
                    .map(m => `[${new Date(m.createdTimestamp).toLocaleString()}] ${m.author.tag}: ${m.content}`)
                    .join('\n');

                const buffer = Buffer.from(transcriptData, 'utf-8');
                const attachment = new AttachmentBuilder(buffer, { name: `transcript-${interaction.channel.name}.txt` });

                if (config && config.transcriptChannelId) {
                    const transcriptChannel = interaction.guild.channels.cache.get(config.transcriptChannelId);
                    if (transcriptChannel) {
                        await transcriptChannel.send({
                            content: `📄 Transcript for closed ticket: **${interaction.channel.name}** (closed by ${interaction.user.tag})`,
                            files: [attachment]
                        });
                    }
                }
            } catch (error) {
                console.error('Error generating transcript:', error);
            }

            setTimeout(() => {
                interaction.channel.delete().catch(() => {});
            }, 5000);
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Bot is online!');
});

app.listen(port, () => {
  console.log(`Webserver draait op poort ${port}`);
});
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Bot is online!');
});

app.listen(port, () => {
  console.log(`Webserver luistert op poort ${port}`);
});