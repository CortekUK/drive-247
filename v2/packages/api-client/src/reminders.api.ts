import type { AxiosInstance } from 'axios';
import type {
  ApiResponse,
  ReminderListQuery,
  ReminderListResponse,
  ReminderResponse,
  ReminderConfigResponse,
  UpdateReminderConfigPayload,
} from '@drive247/shared-types';

export function createRemindersApi(api: AxiosInstance) {
  return {
    list: (query?: ReminderListQuery) =>
      api.get<ApiResponse<ReminderListResponse>>('/reminders', {
        params: query,
      }),

    resolve: (id: string) =>
      api.patch<ApiResponse<ReminderResponse>>(`/reminders/${id}/resolve`),

    getConfig: (configKey: string) =>
      api.get<ApiResponse<ReminderConfigResponse>>(
        `/tenant-settings/reminders/${configKey}`,
      ),

    updateConfig: (configKey: string, payload: UpdateReminderConfigPayload) =>
      api.patch<ApiResponse<ReminderConfigResponse>>(
        `/tenant-settings/reminders/${configKey}`,
        payload,
      ),
  };
}
