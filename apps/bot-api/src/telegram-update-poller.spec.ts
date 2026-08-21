import { describe, expect, it, vi } from 'vitest';

import { readUpdateId, TelegramUpdatePoller } from './telegram-update-poller.js';

describe('TelegramUpdatePoller', () => {
  it('advances offset only after a successful handle', async () => {
    const getUpdates = vi
      .fn()
      .mockResolvedValueOnce([{ update_id: 10 }])
      .mockResolvedValueOnce([]);
    const handleUpdate = vi.fn().mockResolvedValue(undefined);
    const poller = new TelegramUpdatePoller(getUpdates, handleUpdate, 0, 0, true);

    poller.start();
    await vi.waitFor(() => expect(getUpdates).toHaveBeenCalledTimes(2));
    await poller.stop();

    expect(handleUpdate).toHaveBeenCalledTimes(1);
    expect(getUpdates.mock.calls[1]?.[0]).toBe(11);
  });

  it('does not skip a failed update', async () => {
    const getUpdates = vi
      .fn()
      .mockResolvedValueOnce([{ update_id: 10 }, { update_id: 11 }])
      .mockResolvedValueOnce([]);
    const handleUpdate = vi.fn().mockRejectedValueOnce(new Error('TELEGRAM_UPDATE_FAILED'));
    const poller = new TelegramUpdatePoller(getUpdates, handleUpdate, 0, 0, true);

    poller.start();
    await vi.waitFor(() => expect(getUpdates).toHaveBeenCalledTimes(2));
    await poller.stop();

    expect(handleUpdate).toHaveBeenCalledTimes(1);
    expect(getUpdates.mock.calls[1]?.[0]).toBe(0);
  });

  it('retries getUpdates after a transport error', async () => {
    const getUpdates = vi
      .fn()
      .mockRejectedValueOnce(new Error('TELEGRAM_HTTP_500'))
      .mockResolvedValueOnce([]);
    const handleUpdate = vi.fn();
    const poller = new TelegramUpdatePoller(getUpdates, handleUpdate, 0, 0, true);

    poller.start();
    await vi.waitFor(() => expect(getUpdates).toHaveBeenCalledTimes(2));
    await poller.stop();

    expect(handleUpdate).not.toHaveBeenCalled();
  });

  it('reads a numeric update_id', () => {
    expect(readUpdateId({ update_id: 4 })).toBe(4);
    expect(readUpdateId({})).toBeUndefined();
  });
});
