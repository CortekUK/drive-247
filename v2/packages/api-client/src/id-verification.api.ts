import type { AxiosInstance } from 'axios';
import type {
  ApiResponse,
  BlockedIdentityResponse,
  CreateBlockedIdentityPayload,
  CreateSessionPayload,
  CreateSessionResponse,
  IdVerificationResponse,
  IdVerificationSettingsResponse,
  ListBlockedIdentitiesQuery,
  ListBlockedIdentitiesResponse,
  ListEventsResponse,
  ListVerificationsQuery,
  ListVerificationsResponse,
  ManualReviewPayload,
  PublicSessionResponse,
  RetryVerificationPayload,
  SubmitCaptureResponse,
  SyncStepPayload,
  UpdateBlockedIdentityPayload,
  UpdateIdVerificationSettingsPayload,
  UploadFileField,
  UploadFileResponse,
} from '@drive247/shared-types';

/**
 * ID Verification API client.
 *
 * All methods return `AxiosResponse<ApiResponse<T>>` — frontend unwraps
 * `response.data.data` for the payload. Staff endpoints require JWT auth
 * (axios interceptor attaches the bearer token). The `public*` methods
 * target the mobile capture flow and authenticate via the QR token in
 * the URL path — no bearer token is sent.
 */
export function createIdVerificationApi(api: AxiosInstance) {
  return {
    // --- Staff: list / detail / events ---

    list: (query?: ListVerificationsQuery) =>
      api.get<ApiResponse<ListVerificationsResponse>>('/id-verification', {
        params: query,
      }),

    getById: (id: string) =>
      api.get<ApiResponse<IdVerificationResponse>>(`/id-verification/${id}`),

    listEvents: (id: string) =>
      api.get<ApiResponse<ListEventsResponse>>(
        `/id-verification/${id}/events`,
      ),

    // --- Staff: mutations ---

    createSession: (payload: CreateSessionPayload) =>
      api.post<ApiResponse<CreateSessionResponse>>(
        '/id-verification/sessions',
        payload,
      ),

    cancel: (id: string) =>
      api.post<ApiResponse<null>>(`/id-verification/${id}/cancel`),

    retry: (id: string, payload: RetryVerificationPayload) =>
      api.post<ApiResponse<CreateSessionResponse>>(
        `/id-verification/${id}/retry`,
        payload,
      ),

    review: (id: string, payload: ManualReviewPayload) =>
      api.post<ApiResponse<null>>(`/id-verification/${id}/review`, payload),

    // --- Staff: blocked identities ---

    listBlocks: (query?: ListBlockedIdentitiesQuery) =>
      api.get<ApiResponse<ListBlockedIdentitiesResponse>>(
        '/id-verification/blocks',
        { params: query },
      ),

    createBlock: (payload: CreateBlockedIdentityPayload) =>
      api.post<ApiResponse<BlockedIdentityResponse>>(
        '/id-verification/blocks',
        payload,
      ),

    updateBlock: (id: string, payload: UpdateBlockedIdentityPayload) =>
      api.patch<ApiResponse<BlockedIdentityResponse>>(
        `/id-verification/blocks/${id}`,
        payload,
      ),

    deleteBlock: (id: string) =>
      api.delete<ApiResponse<null>>(`/id-verification/blocks/${id}`),

    // --- Staff: settings ---

    getSettings: () =>
      api.get<ApiResponse<IdVerificationSettingsResponse>>(
        '/id-verification/settings',
      ),

    updateSettings: (payload: UpdateIdVerificationSettingsPayload) =>
      api.patch<ApiResponse<IdVerificationSettingsResponse>>(
        '/id-verification/settings',
        payload,
      ),

    // --- Public (QR-token auth) ---

    publicGetSession: (token: string) =>
      api.get<ApiResponse<PublicSessionResponse>>(
        `/public/id-verification/sessions/${encodeURIComponent(token)}`,
      ),

    publicSyncStep: (token: string, payload: SyncStepPayload) =>
      api.post<ApiResponse<null>>(
        `/public/id-verification/sessions/${encodeURIComponent(token)}/step`,
        payload,
      ),

    publicUploadFile: (
      token: string,
      field: UploadFileField,
      file: Blob,
    ) => {
      const form = new FormData();
      form.append('field', field);
      form.append('file', file);
      return api.post<ApiResponse<UploadFileResponse>>(
        `/public/id-verification/sessions/${encodeURIComponent(token)}/files`,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
    },

    publicSubmit: (token: string) =>
      api.post<ApiResponse<SubmitCaptureResponse>>(
        `/public/id-verification/sessions/${encodeURIComponent(token)}/submit`,
      ),
  };
}
