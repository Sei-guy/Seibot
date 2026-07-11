import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, successEmbed, warningEmbed } from '../../utils/embeds.js';
import { getFromDb, setInDb } from '../../utils/database.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';

const COOLDOWN_SECONDS = 8; // test value from the original CC — raise for prod
const BOX_COST = 5000;
const CLAIM_EXPIRY_MS = 60 * 1000;

const TIERS = {
  Common: [
    { name: '64rd Bizon Mag (x10)', roleId: '1483812098789212210' },
    { name: '30rd SG5-K Mag (x10)', roleId: '1483812419733291098' },
    { name: '25rd USG-45 Mag (x10)', roleId: '1483812533226700810' },
    { name: '20rd Drum Vaiga Mag (x10)', roleId: '1483812741583212555' },
    { name: '30rd Vikhr Mag (x10)', roleId: '1483421823076139088' },
    { name: '60rd Standard Mag (x10)', roleId: '1483421607451037826' },
    { name: '75rd KA-M Drum Mag (x10)', roleId: '1481620538148388988' },
    { name: '30rd KA-101 Mag (x10)', roleId: '1483812824860852367' },
    { name: '45rd KA-74 Mag (x10)', roleId: '1483812926841294878' },
    { name: '20rd DMR Mag (x10)', roleId: '1483813071964344391' },
    { name: '20rd LAR Mag (x10)', roleId: '1483813132567580733' },
    { name: '10rd VSD Mag (x10)', roleId: '1483813206932586497' },
    { name: '10rd VS-89 Mag (x10)', roleId: '1483813373001863248' },
  ],
  Uncommon: [
    { name: 'Large Tent (x2)', roleId: '1483813886191730708' },
    { name: 'Car Tent (x2)', roleId: '1483813807322173581' },
    { name: 'NVG (x1)', roleId: '1483813499984678923' },
    { name: 'Plate Carrier (x2)', roleId: '1483813576987901953' },
    { name: 'Candycane (x2)', roleId: '1483814005821669377' },
    { name: 'Claymore (x5)', roleId: '1483813729530413106' },
  ],
  Rare: [
    { name: 'CR-527 (x1)', roleId: '1484090021093970000' },
    { name: 'Gold Deagle (x2)', roleId: '1484090139407028224' },
    { name: 'M16 (x1)', roleId: '1484090339190116373' },
    { name: 'KA-101 (x1)', roleId: '1484090405367578667' },
    { name: 'KA-74 (x1)', roleId: '1484090462703845467' },
    { name: 'LE-MAS (x1)', roleId: '1484090551149269029' },
    { name: 'AS VAL (x1)', roleId: '1484090601321267291' },
    { name: 'SKS (x1)', roleId: '1484090643969216552' },
    { name: 'Vikhr (x2)', roleId: '1484090683001409557' },
    { name: 'R12 (x2)', roleId: '1484090807660056576' },
    { name: 'Vaiga (x2)', roleId: '1484090968834834432' },
  ],
  Epic: [
    { name: 'VS-89 (x1)', roleId: '1484091007187550379' },
    { name: 'DMR (x1)', roleId: '1484091127928983572' },
    { name: 'VSD (x1)', roleId: '1484091167422550077' },
    { name: 'LAR (x1)', roleId: '1484091229355511878' },
    { name: 'AUR (x1)', roleId: '1484091270727991306' },
    { name: 'KA-M (x1)', roleId: '1484091313099116665' },
    { name: 'M4 (x1)', roleId: '1484091357889826909' },
    { name: 'M79 (x1)', roleId: '1484091409186164836' },
    { name: 'Tundra (x1)', roleId: '1484091451775389718' },
    { name: 'Punch Card (x1)', roleId: '1483813967041269872' },
    { name: 'POX Vial (x2)', roleId: '1484091067166097440' },
  ],
};

function rollTier() {
  const roll = Math.floor(Math.random() * 100) + 1;
  if (roll <= 50) return 'Common';
  if (roll <= 80) return 'Uncommon';
  if (roll <= 95) return 'Rare';
  return 'Epic';
}

function pickItem(tier) {
  const items = TIERS[tier];
  return items[Math.floor(Math.random() * items.length)];
}

async function expireClaim(client, guildId, channelId, userId, roleId, itemName) {
  try {
    const guild = await client.guilds.fetch(guildId);
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member && member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId);
    }

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel) {
      await channel.send({
        embeds: [
          warningEmbed(
            '⏳ Purchase Expired',
            `<@${userId}> You can no longer purchase:\n\n**${itemName}**`,
          ),
        ],
      });
    }
  } catch (error) {
    logger.error('Mysterybox claim expiry failed', { error: error.message, userId, guildId });
  }
}

export default {
  data: new SlashCommandBuilder()
    .setName('mysterybox')
    .setDescription(`Spend $${BOX_COST.toLocaleString()} for a chance at a random item`)
    .setDMPermission(false),
  category: 'Fun',

  async execute(interaction) {
    const userId = interaction.user.id;
    const guildId = interaction.guildId;
    const channelId = interaction.channelId;

    try {
      const deferSuccess = await InteractionHelper.safeDefer(interaction);
      if (!deferSuccess) {
        logger.warn('Mysterybox interaction defer failed', { userId, guildId, commandName: 'mysterybox' });
        return;
      }

      const now = Math.floor(Date.now() / 1000);
      const cooldownKey = `mysterybox_lastroll_${userId}`;
      const lastRoll = await getFromDb(cooldownKey, 0);
      const remaining = COOLDOWN_SECONDS - (now - lastRoll);

      if (remaining > 0) {
        const hours = Math.floor(remaining / 3600);
        const minutes = Math.floor((remaining % 3600) / 60);
        return await InteractionHelper.safeEditReply(interaction, {
          content: `⏳ You can roll again in **${hours > 0 ? `${hours}h ` : ''}${minutes > 0 ? `${minutes}m` : ''}**`,
        });
      }

      const bankKey = `luckyme_bank_${userId}`; // shares the same pot as /luckyme jackpots
      const balance = await getFromDb(bankKey, 0);

      if (balance < BOX_COST) {
        return await InteractionHelper.safeEditReply(interaction, {
          embeds: [
            warningEmbed(
              '❌ Insufficient Funds',
              `💸 Required Balance: **$${BOX_COST.toLocaleString()}**\n💰 Current Balance: **$${balance.toLocaleString()}**`,
            ),
          ],
        });
      }

      const newBalance = balance - BOX_COST;
      await setInDb(bankKey, newBalance);

      const tier = rollTier();
      const choice = pickItem(tier);

      const member = await interaction.guild.members.fetch(userId);
      const tierRoleIds = TIERS[tier].map((item) => item.roleId);
      const rolesToRemove = tierRoleIds.filter((id) => member.roles.cache.has(id));
      if (rolesToRemove.length > 0) {
        await member.roles.remove(rolesToRemove);
      }
      await member.roles.add(choice.roleId);

      await setInDb(cooldownKey, now);

      await InteractionHelper.safeEditReply(interaction, {
        embeds: [
          successEmbed(
            '🎯 Mystery Box Roll',
            `🎲 Tier Rolled: **${tier}**\n📦 Item Rolled: **${choice.name}**\n\n💸 Cost: **$${BOX_COST.toLocaleString()}**\n💰 New Balance: **$${newBalance.toLocaleString()}**\n\n⏳ Purchase your items before rolling again!`,
          ),
        ],
      });

      setTimeout(() => {
        expireClaim(interaction.client, guildId, channelId, userId, choice.roleId, choice.name);
      }, CLAIM_EXPIRY_MS);
    } catch (error) {
      logger.error('Mysterybox command execution failed', {
        error: error.message,
        stack: error.stack,
        userId,
        guildId,
        commandName: 'mysterybox',
      });
      await handleInteractionError(interaction, error, {
        commandName: 'mysterybox',
        source: 'mysterybox_command',
      });
    }
  },
};
