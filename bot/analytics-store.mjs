import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const DEFAULT_STATS_PATH = resolve(process.cwd(), 'data', 'analytics.json');
const REGION_CONFIG_PATH = resolve(process.cwd(), 'static', 'region.json');
const TOP_LIMIT = 10;

const EMPTY_STATS = {
  createdAt: null,
  updatedAt: null,
  counters: {
    botStarts: 0,
    startCommands: 0,
    botMessages: 0,
    webhookEvents: 0,
    appOpens: 0,
    pageViews: 0,
    categoryClicks: 0,
    serviceClicks: 0,
    serviceOpens: 0,
    searchQueries: 0,
    searchEmpty: 0,
    supportClicks: 0,
    channelClicks: 0,
  },
  users: {},
  chats: {},
  days: {},
  categories: {},
  services: {},
  searches: {},
};

let writeQueue = Promise.resolve();

const nowIso = () => new Date().toISOString();

const today = () => nowIso().slice(0, 10);

const cloneEmptyStats = () => JSON.parse(JSON.stringify(EMPTY_STATS));

const increment = (object, key, by = 1) => {
  object[key] = (Number(object[key]) || 0) + by;
};

const normalizeId = (value) => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed || undefined;
};

const readJson = async (path, fallback) => {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return fallback;
    }

    throw error;
  }
};

const readStats = async () => {
  const stats = await readJson(DEFAULT_STATS_PATH, cloneEmptyStats());

  return {
    ...cloneEmptyStats(),
    ...stats,
    counters: { ...EMPTY_STATS.counters, ...(stats.counters || {}) },
    users: stats.users || {},
    chats: stats.chats || {},
    days: stats.days || {},
    categories: stats.categories || {},
    services: stats.services || {},
    searches: stats.searches || {},
  };
};

const writeStats = async (stats) => {
  await mkdir(dirname(DEFAULT_STATS_PATH), { recursive: true });
  await writeFile(DEFAULT_STATS_PATH, `${JSON.stringify(stats, null, 2)}\n`);
};

const updateStats = (updater) => {
  writeQueue = writeQueue
    .catch((error) => {
      console.error('Ошибка предыдущей записи статистики:', error);
    })
    .then(async () => {
      const stats = await readStats();
      const timestamp = nowIso();

      stats.createdAt ||= timestamp;
      stats.updatedAt = timestamp;

      updater(stats, timestamp);

      await writeStats(stats);
    });

  return writeQueue;
};

const touchUser = (stats, userId, timestamp) => {
  if (!userId) {
    return;
  }

  const key = String(userId);
  const user = stats.users[key] || { events: 0, firstAt: timestamp, lastAt: timestamp };

  user.events += 1;
  user.lastAt = timestamp;
  stats.users[key] = user;
};

const touchChat = (stats, chatId, timestamp) => {
  if (!chatId) {
    return;
  }

  const key = String(chatId);
  const chat = stats.chats[key] || { events: 0, firstAt: timestamp, lastAt: timestamp };

  chat.events += 1;
  chat.lastAt = timestamp;
  stats.chats[key] = chat;
};

const touchDay = (stats, eventName) => {
  const day = today();
  const dayStats = stats.days[day] || {};

  increment(dayStats, eventName);
  stats.days[day] = dayStats;
};

export const trackBotEvent = async (eventName, { userId, chatId } = {}) =>
  updateStats((stats, timestamp) => {
    const counterByEvent = {
      bot_started: 'botStarts',
      start_command: 'startCommands',
      bot_message: 'botMessages',
      webhook_event: 'webhookEvents',
    };

    const counter = counterByEvent[eventName];

    if (counter) {
      increment(stats.counters, counter);
    }

    touchUser(stats, userId, timestamp);
    touchChat(stats, chatId, timestamp);
    touchDay(stats, eventName);
  });

export const trackMiniAppEvent = async ({ event, params = {}, path }) =>
  updateStats((stats, timestamp) => {
    const eventName = normalizeId(event);

    if (!eventName) {
      return;
    }

    const counterByEvent = {
      app_open: 'appOpens',
      page_view: 'pageViews',
      category_click: 'categoryClicks',
      service_click: 'serviceClicks',
      service_open: 'serviceOpens',
      search_query: 'searchQueries',
      search_empty: 'searchEmpty',
      support_click: 'supportClicks',
      channel_click: 'channelClicks',
    };

    const counter = counterByEvent[eventName];

    if (counter) {
      increment(stats.counters, counter);
    }

    if (eventName === 'category_click') {
      const categoryId = normalizeId(params.categoryId);

      if (categoryId) {
        const category = stats.categories[categoryId] || { clicks: 0, lastAt: timestamp };

        category.clicks += 1;
        category.lastAt = timestamp;
        stats.categories[categoryId] = category;
      }
    }

    if (eventName === 'service_click' || eventName === 'service_open') {
      const serviceId = normalizeId(params.serviceId);

      if (serviceId) {
        const service = stats.services[serviceId] || {
          clicks: 0,
          opens: 0,
          lastAt: timestamp,
        };

        if (eventName === 'service_click') {
          service.clicks += 1;
        }

        if (eventName === 'service_open') {
          service.opens += 1;
        }

        service.lastAt = timestamp;
        stats.services[serviceId] = service;
      }
    }

    if (eventName === 'search_query' || eventName === 'search_empty') {
      const query = normalizeId(params.query)?.toLowerCase();

      if (query) {
        const search = stats.searches[query] || { count: 0, empty: 0, lastAt: timestamp };

        if (eventName === 'search_query') {
          search.count += 1;
        } else {
          search.empty += 1;
        }

        search.lastAt = timestamp;
        stats.searches[query] = search;
      }
    }

    touchDay(stats, eventName);

    if (path) {
      touchDay(stats, `path:${String(path).slice(0, 80)}`);
    }
  });

const readRegionConfig = async () => {
  const config = await readJson(REGION_CONFIG_PATH, { categories: [], services: [], channels: [] });

  const categoryNames = new Map(config.categories.map((category) => [category.id, category.name]));
  const serviceNames = new Map(
    [...config.services, ...config.channels].map((service) => [service.id, service.name])
  );

  return { categoryNames, serviceNames };
};

const formatTop = (items, formatter) => {
  if (items.length === 0) {
    return '— пока нет данных';
  }

  return items
    .slice(0, TOP_LIMIT)
    .map((item, index) => `${index + 1}. ${formatter(item)}`)
    .join('\n');
};

export const buildStatsReport = async () => {
  const [stats, region] = await Promise.all([readStats(), readRegionConfig()]);
  const uniqueUsers = Object.keys(stats.users).length;
  const uniqueChats = Object.keys(stats.chats).length;
  const topServices = Object.entries(stats.services).sort(([, a], [, b]) => {
    const aTotal = (a.opens || 0) + (a.clicks || 0);
    const bTotal = (b.opens || 0) + (b.clicks || 0);

    return bTotal - aTotal;
  });
  const topCategories = Object.entries(stats.categories).sort(
    ([, a], [, b]) => (b.clicks || 0) - (a.clicks || 0)
  );
  const topSearches = Object.entries(stats.searches).sort(
    ([, a], [, b]) => (b.count || 0) + (b.empty || 0) - ((a.count || 0) + (a.empty || 0))
  );

  return [
    '📊 Статистика бота и мини-приложения',
    '',
    `Период: ${stats.createdAt ? `${stats.createdAt.slice(0, 10)} — ${stats.updatedAt.slice(0, 10)}` : 'пока нет данных'}`,
    `Уникальных пользователей бота: ${uniqueUsers}`,
    `Чатов с ботом: ${uniqueChats}`,
    '',
    'Общее:',
    `• запусков бота: ${stats.counters.botStarts}`,
    `• команд /start: ${stats.counters.startCommands}`,
    `• сообщений боту: ${stats.counters.botMessages}`,
    `• открытий мини-приложения: ${stats.counters.appOpens}`,
    `• просмотров страниц: ${stats.counters.pageViews}`,
    `• кликов по категориям: ${stats.counters.categoryClicks}`,
    `• переходов к карточкам услуг: ${stats.counters.serviceClicks}`,
    `• нажатий «Открыть» у услуг: ${stats.counters.serviceOpens}`,
    `• поисковых запросов: ${stats.counters.searchQueries}`,
    `• поисков без результата: ${stats.counters.searchEmpty}`,
    '',
    'Топ услуг:',
    formatTop(topServices, ([id, value]) => {
      const name = region.serviceNames.get(id) || id;

      return `${name} — открытий: ${value.opens || 0}, просмотров карточки: ${value.clicks || 0}`;
    }),
    '',
    'Топ категорий:',
    formatTop(topCategories, ([id, value]) => {
      const name = region.categoryNames.get(id) || id;

      return `${name} — ${value.clicks || 0}`;
    }),
    '',
    'Топ поисковых запросов:',
    formatTop(topSearches, ([query, value]) => {
      return `${query} — ${value.count || 0}, без результата: ${value.empty || 0}`;
    }),
  ].join('\n');
};
