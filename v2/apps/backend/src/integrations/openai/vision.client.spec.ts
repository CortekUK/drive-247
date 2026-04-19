import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../config/env.config', () => ({
  getEnv: () => ({ OPENAI_API_KEY: 'sk-test' }),
}));

import { VisionClient } from './vision.client';

function mockChatResponse(content: unknown) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(content) } }],
    }),
    { status: 200 },
  );
}

describe('VisionClient.extractDocumentData', () => {
  let client: VisionClient;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;

  beforeEach(() => {
    client = new VisionClient();
    fetchSpy = vi.spyOn(global, 'fetch');
  });

  it('parses a valid Vision response', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockChatResponse({
        first_name: 'Ada',
        last_name: 'Lovelace',
        date_of_birth: '1815-12-10',
        document_number: 'L1234567',
        document_country: 'GB',
        document_expiry_date: '2030-01-01',
        document_type: 'driving_license',
        confidence: 0.93,
      }),
    );

    const result = await client.extractDocumentData({
      frontImageUrl: 'https://signed/front.jpg',
      backImageUrl: 'https://signed/back.jpg',
      requiredDocumentType: 'driving_license',
    });

    expect(result).toMatchObject({
      firstName: 'Ada',
      lastName: 'Lovelace',
      dateOfBirth: '1815-12-10',
      documentNumber: 'L1234567',
      documentCountry: 'GB',
      documentExpiryDate: '2030-01-01',
      documentDetectedType: 'driving_license',
      confidence: 0.93,
    });
  });

  it('returns nulls for missing fields without crashing', async () => {
    fetchSpy.mockResolvedValueOnce(mockChatResponse({ confidence: 0.4 }));

    const result = await client.extractDocumentData({
      frontImageUrl: 'https://signed/front.jpg',
      requiredDocumentType: 'passport',
    });

    expect(result).toMatchObject({
      firstName: null,
      lastName: null,
      documentNumber: null,
      confidence: 0.4,
    });
  });

  it('rejects non-ISO date formats (returns null for that field)', async () => {
    fetchSpy.mockResolvedValueOnce(
      mockChatResponse({
        date_of_birth: '12/10/1815', // not ISO
        document_expiry_date: '2030-01-01',
        confidence: 0.8,
      }),
    );

    const result = await client.extractDocumentData({
      frontImageUrl: 'https://signed/front.jpg',
      requiredDocumentType: 'driving_license',
    });

    expect(result?.dateOfBirth).toBeNull();
    expect(result?.documentExpiryDate).toBe('2030-01-01');
  });

  it('clamps confidence into [0, 1]', async () => {
    fetchSpy.mockResolvedValueOnce(mockChatResponse({ confidence: 1.7 }));
    const hi = await client.extractDocumentData({
      frontImageUrl: 'x',
      requiredDocumentType: 'id_card',
    });
    expect(hi?.confidence).toBe(1);

    fetchSpy.mockResolvedValueOnce(mockChatResponse({ confidence: -0.3 }));
    const lo = await client.extractDocumentData({
      frontImageUrl: 'x',
      requiredDocumentType: 'id_card',
    });
    expect(lo?.confidence).toBe(0);
  });

  it('returns null on HTTP failure (fails closed)', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('boom', { status: 500 }));
    const result = await client.extractDocumentData({
      frontImageUrl: 'x',
      requiredDocumentType: 'id_card',
    });
    expect(result).toBeNull();
  });

  it('returns null when the JSON content is malformed', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ choices: [{ message: { content: '{not json' } }] }),
        { status: 200 },
      ),
    );
    const result = await client.extractDocumentData({
      frontImageUrl: 'x',
      requiredDocumentType: 'id_card',
    });
    expect(result).toBeNull();
  });
});
