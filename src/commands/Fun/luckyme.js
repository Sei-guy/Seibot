import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { createEmbed, successEmbed } from '../../utils/embeds.js';
import { getFromDb, setInDb } from '../../utils/database.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';

const COOLDOWN_SECONDS = 10; // bump for prod — 10s is a testing value
const WIN_NUMBERS = [7, 42];
const JACKPOT_REWARD = 10000;

export default {
  data: new SlashCommandBuilder()
    .setName('luckyme')
    .setDescription('Try your luck for a jackpot reward')
    .setDMPermission(false),
  category: 'Fun',

  async execute(interaction) {
    const userId = interaction.user.id;

    try {
      const deferSuccess = await InteractionHelper.safeDefer(interaction);
      if (!deferSuccess) {
        logger.warn('Luckyme interaction defer failed', {
          userId,
          guildId: interaction.guildId,
          commandName: 'luckyme',
        });
        return;
      }

      const now = Math.floor(Date.now() / 1000);
      const cooldownKey = `luckyme_cd_${userId}`;
      const lastRoll = await getFromDb(cooldownKey, null);

      if (lastRoll) {
        const remaining = (Number(lastRoll) + COOLDOWN_SECONDS) - now;
        if (remaining > 0) {
          const hours = Math.floor(remaining / 3600);
          const minutes = Math.floor((remaining % 3600) / 60);
          return await InteractionHelper.safeEditReply(interaction, {
            embeds: [
              createEmbed({
                title: '⏳ Lucky Roll Cooldown',
                description: `Try again in **${hours}** hours and **${minutes}** minutes.`,
                color: 'primary',
              }),
            ],
          });
        }
      }

      await setInDb(cooldownKey, now);

      const roll = Math.floor(Math.random() * 50) + 1;
      const isJackpot = WIN_NUMBERS.includes(roll);

      if (isJackpot) {
        const bankKey = `luckyme_bank_${userId}`;
        const currentBank = await getFromDb(bankKey, 0);
        const newBank = currentBank + JACKPOT_REWARD;
        await setInDb(bankKey, newBank);

        return await InteractionHelper.safeEditReply(interaction, {
          embeds: [
            successEmbed(
              '🎉 JACKPOT!',
              `🎲 You rolled: **${roll}**\n\n💸 Reward: **$${JACKPOT_REWARD.toLocaleString()}** added to your bank\n🏦 New Bank Total: **$${newBank.toLocaleString()}**`,
            ),
          ],
        });
      }

      return await InteractionHelper.safeEditReply(interaction, {
        embeds: [
          createEmbed({
            title: '❌ Better Luck Next Time',
            description: `🎲 You rolled: **${roll}**\n\n🏆 Winning Numbers: **${WIN_NUMBERS.join('** and **')}**`,
            color: 'primary',
          }),
        ],
      });
    } catch (error) {
      logger.error('Luckyme command execution failed', {
        error: error.message,
        stack: error.stack,
        userId,
        guildId: interaction.guildId,
        commandName: 'luckyme',
      });
      await handleInteractionError(interaction, error, {
        commandName: 'luckyme',
        source: 'luckyme_command',
      });
    }
  },
};
