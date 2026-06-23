import { Bot, Keyboard } from '@maxhub/max-bot-api';

import { startHttpServer } from './http-server.mjs';

const token = process.env.BOT_TOKEN?.trim();
const miniAppUrl = process.env.MINI_APP_URL?.trim();

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
  if (!miniAppUrl || miniAppUrl.includes('<имя_бота>')) {
    return {};
  }

  return {
    attachments: [
      Keyboard.inlineKeyboard([
        [Keyboard.button.link('Открыть сервисы', miniAppUrl)],
      ]),
    ],
  };
};

const sendWelcome = (ctx) => ctx.reply(welcomeText, createReplyOptions());

bot.on('bot_started', sendWelcome);
bot.command('start', sendWelcome);

bot.on('message_created', (ctx) =>
  ctx.reply(helpText, createReplyOptions())
);

bot.start();
startHttpServer();

console.log('Бот «Сервисы Курганской области» запущен');
