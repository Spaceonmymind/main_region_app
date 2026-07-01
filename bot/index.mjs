import { Bot, Keyboard } from '@maxhub/max-bot-api';

import { buildStatsReport, trackBotEvent, trackMiniAppEvent } from './analytics-store.mjs';
import { startHttpServer } from './http-server.mjs';

const token = process.env.BOT_TOKEN?.trim();
const miniAppDeeplink = process.env.MINI_APP_DEEPLINK?.trim();
const legacyMiniAppUrl = process.env.MINI_APP_URL?.trim();
const adminUserIds = new Set(
  (process.env.ADMIN_USER_IDS || '')
    .split(/[,\s]+/)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0)
);

if (!token) {
  throw new Error(
    'Не задан BOT_TOKEN. Скопируйте .env.example в .env и добавьте токен бота MAX.'
  );
}

const bot = new Bot(token);

const welcomeText = [
  '👋 Добро пожаловать в «Сервисы Курганской области»!',
  '',
  'Здесь собраны полезные региональные и федеральные сервисы: ЖКХ, транспорт, здоровье, образование, социальная поддержка и культура.',
  '',
  'Нажмите кнопку «Открыть сервисы», выберите нужную категорию или воспользуйтесь поиском.',
].join('\n');

const helpText = [
  'Я помогу открыть мини-приложение «Сервисы Курганской области».',
  '',
  'Нажмите кнопку ниже, затем выберите категорию или найдите нужный сервис через поиск.',
].join('\n');

const createReplyOptions = () => {
  const legacyMiniAppDeeplink = legacyMiniAppUrl?.startsWith('https://max.ru/')
    ? legacyMiniAppUrl
    : undefined;
  const miniAppOpenUrl = miniAppDeeplink || legacyMiniAppDeeplink;

  if (
    !miniAppOpenUrl ||
    miniAppOpenUrl.includes('<имя_бота>') ||
    miniAppOpenUrl.includes('<botName>')
  ) {
    return {};
  }

  return {
    attachments: [
      Keyboard.inlineKeyboard([
        [Keyboard.button.link('Открыть сервисы', miniAppOpenUrl)],
      ]),
    ],
  };
};

const sendWelcome = (ctx) => ctx.reply(welcomeText, createReplyOptions());

const getUserId = (ctx) => ctx.user?.user_id;
const getChatId = (ctx) => ctx.chatId;

const isAdmin = (ctx) => {
  const userId = getUserId(ctx);

  return Boolean(userId && adminUserIds.has(userId));
};

bot.on('bot_started', async (ctx) => {
  await trackBotEvent('bot_started', {
    userId: getUserId(ctx),
    chatId: getChatId(ctx),
  });
  await sendWelcome(ctx);
});

bot.command('start', async (ctx) => {
  await trackBotEvent('start_command', {
    userId: getUserId(ctx),
    chatId: getChatId(ctx),
  });
  await sendWelcome(ctx);
});

bot.command('my_id', (ctx) => {
  const userId = getUserId(ctx);

  return ctx.reply(
    userId
      ? `Ваш MAX user_id: ${userId}`
      : 'Не получилось определить user_id. Попробуйте написать команду в личный чат с ботом.'
  );
});

bot.command(['admin_stats', 'stats'], async (ctx) => {
  if (adminUserIds.size === 0) {
    const userId = getUserId(ctx);

    return ctx.reply(
      [
        'Админы статистики пока не настроены.',
        '',
        `Ваш MAX user_id: ${userId ?? 'не определён'}`,
        'Добавьте его на сервере в .env:',
        `ADMIN_USER_IDS=${userId ?? '<ваш_user_id>'}`,
        '',
        'После этого перезапустите сервис бота.',
      ].join('\n')
    );
  }

  if (!isAdmin(ctx)) {
    return ctx.reply('Эта команда доступна только администратору статистики.');
  }

  return ctx.reply(await buildStatsReport());
});

bot.on('message_created', async (ctx) => {
  await trackBotEvent('bot_message', {
    userId: getUserId(ctx),
    chatId: getChatId(ctx),
  });

  return ctx.reply(helpText, createReplyOptions());
});

bot.start();
startHttpServer({
  onAnalyticsEvent: trackMiniAppEvent,
  onWebhookEvent: () => trackBotEvent('webhook_event'),
});

console.log('Бот «Сервисы Курганской области» запущен');
