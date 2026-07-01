import { findServiceOrChannel, regionConfig } from 'config/regionConfig';

import { EErrorType } from '../error/types';
import { IRootStore } from '../root/declarations';

import { MyTrackerAdapter, YandexMetrikaAdapter } from './adapters';
import { IAnalyticsAdapter } from './adapters/types';
import { EAnalyticsEvent } from './config';
import { IAnalyticsStore } from './declaration';
import { TAnalyticsPage } from './types';

class AnalyticsStore implements IAnalyticsStore {
  private readonly _adapters: IAnalyticsAdapter[] = [];

  constructor(private readonly _rootStore: IRootStore) {
    const { analytics } = regionConfig;

    if (analytics.mytracker.enabled && analytics.mytracker.trackerId) {
      this._adapters.push(new MyTrackerAdapter(analytics.mytracker.trackerId));
    }

    if (analytics.yandexMetrika.enabled && analytics.yandexMetrika.counterId) {
      this._adapters.push(new YandexMetrikaAdapter(analytics.yandexMetrika.counterId));
    }
  }

  readonly init = (): void => {
    this._adapters.forEach((adapter) => adapter.init());
    this._sendEvent(EAnalyticsEvent.appOpen);
  };

  readonly sendPage = ({ path }: TAnalyticsPage): void => {
    try {
      const url = `${location.origin}${path}`;

      this._adapters.forEach((adapter) => adapter.sendPage(url));
      this._sendLocalEvent('page_view', { path });
    } catch (e: unknown) {
      this._rootStore.errorStore.error(e, {
        type: EErrorType.ANALYTICS,
        extra: 'sendPage error',
        path: path ?? '',
      });
    }
  };

  readonly sendSearchQuery = (query: string): void => {
    this._sendEvent(EAnalyticsEvent.searchQuery, { query });
  };

  readonly sendSearchEmpty = (query: string): void => {
    this._sendEvent(EAnalyticsEvent.searchEmpty, { query });
  };

  readonly sendServiceClick = (serviceId: string, categoryId?: string): void => {
    const service = findServiceOrChannel(serviceId);

    this._sendEvent(EAnalyticsEvent.serviceClick, {
      serviceId,
      serviceName: service?.name ?? '',
      categoryId,
    });
  };

  readonly sendServiceOpen = (serviceId: string): void => {
    const service = findServiceOrChannel(serviceId);

    this._sendEvent(EAnalyticsEvent.serviceOpen, {
      serviceId,
      serviceType: service?.type ?? '',
      link: service?.link ?? '',
    });
  };

  readonly sendCategoryClick = (categoryId: string): void => {
    const category = regionConfig.categories.find((c) => c.id === categoryId);

    this._sendEvent(EAnalyticsEvent.categoryClick, {
      categoryId,
      categoryName: category?.name ?? '',
    });
  };

  readonly sendChannelClick = (channelId: string): void => {
    const channel = regionConfig.channels.find((c) => c.id === channelId);

    this._sendEvent(EAnalyticsEvent.channelClick, {
      channelName: channel?.name ?? '',
      link: channel?.link ?? '',
    });
  };

  readonly sendSupportClick = (supportType: string, link: string): void => {
    this._sendEvent(EAnalyticsEvent.supportClick, { supportType, link });
  };

  private readonly _sendEvent = (
    event: EAnalyticsEvent,
    params?: Record<string, unknown>
  ): void => {
    try {
      this._adapters.forEach((adapter) => adapter.sendEvent(event, params));
      this._sendLocalEvent(event, params);
    } catch (e: unknown) {
      this._rootStore.errorStore.error(e, {
        type: EErrorType.ANALYTICS,
        extra: 'sendEvent error',
        event,
      });
    }
  };

  private readonly _sendLocalEvent = (event: string, params?: Record<string, unknown>): void => {
    try {
      if (typeof window === 'undefined') {
        return;
      }

      void fetch('/analytics/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event,
          params,
          path: window.location.pathname,
        }),
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      // Локальная статистика не должна мешать пользователю пользоваться мини-приложением.
    }
  };
}

export default AnalyticsStore;
