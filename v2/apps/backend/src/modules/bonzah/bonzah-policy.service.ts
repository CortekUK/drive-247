import {
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SQL, and, asc, eq } from 'drizzle-orm';
import { bonzahInsurancePolicies } from '@drive247/database';
import type {
  BonzahMode,
  BonzahPolicyResponse,
  BonzahPolicyStatus,
  DownloadPdfResponse,
} from '@drive247/shared-types';
import { DATABASE } from '../../database/database.module';
import type { Database } from '../../database/db';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { BonzahApiClient } from '../../integrations/bonzah/bonzah-api.client';
import { BonzahCredentialsService } from '../../integrations/bonzah/bonzah-credentials.service';
import { BONZAH_AUTH_HEADER, BONZAH_PATHS } from '../../integrations/bonzah/constants';
import { BonzahApiError } from '../../integrations/bonzah/errors';
import type { ListPoliciesDto } from './dto/list-policies.dto';

type PolicyRow = typeof bonzahInsurancePolicies.$inferSelect;

/**
 * Read-side operations on Bonzah policies: listing, single-policy lookup,
 * and PDF proxy download. All DB access is tenant-scoped.
 *
 * PDF download flow: backend fetches the binary from Bonzah with the cached
 * auth token — the token never leaves this server. Frontend receives
 * `{ contentBase64, contentType, fileName }` and triggers the browser
 * download from the base64.
 */
@Injectable()
export class BonzahPolicyService {
  constructor(
    @Inject(DATABASE) private db: Database,
    private readonly ctx: TenantContextService,
    private readonly apiClient: BonzahApiClient,
    private readonly credentialsService: BonzahCredentialsService,
  ) {}

  async list(query: ListPoliciesDto): Promise<BonzahPolicyResponse[]> {
    const tenantId = this.ctx.requireTenantId();
    const conditions: SQL[] = [
      eq(bonzahInsurancePolicies.tenantId, tenantId),
    ];
    if (query.rentalId)
      conditions.push(eq(bonzahInsurancePolicies.rentalId, query.rentalId));
    if (query.chainId)
      conditions.push(eq(bonzahInsurancePolicies.chainId, query.chainId));
    if (query.status)
      conditions.push(eq(bonzahInsurancePolicies.status, query.status));

    const rows = await this.db
      .select()
      .from(bonzahInsurancePolicies)
      .where(and(...conditions))
      .orderBy(
        asc(bonzahInsurancePolicies.chainId),
        asc(bonzahInsurancePolicies.chainSequence),
      );

    return rows.map(shape);
  }

  async getById(id: string): Promise<BonzahPolicyResponse> {
    const tenantId = this.ctx.requireTenantId();
    const [row] = await this.db
      .select()
      .from(bonzahInsurancePolicies)
      .where(
        and(
          eq(bonzahInsurancePolicies.id, id),
          eq(bonzahInsurancePolicies.tenantId, tenantId),
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException('Bonzah policy not found');
    return shape(row);
  }

  /**
   * Proxy a Bonzah PDF through our backend so the auth token is never
   * exposed to the client. Returns base64 content + content type.
   *
   * Bonzah's PDF endpoint sits OUTSIDE the /Bonzah/ namespace — it's at
   * /policy/data with the token passed either as a query param or the
   * standard header.
   */
  async downloadPdf(
    policyId: string,
    dataId: number,
  ): Promise<DownloadPdfResponse> {
    const tenantId = this.ctx.requireTenantId();

    // Load the policy to confirm tenant ownership + get the bonzah policy_id
    const [row] = await this.db
      .select({
        bonzahPolicyId: bonzahInsurancePolicies.policyId,
        mode: bonzahInsurancePolicies.mode,
      })
      .from(bonzahInsurancePolicies)
      .where(
        and(
          eq(bonzahInsurancePolicies.id, policyId),
          eq(bonzahInsurancePolicies.tenantId, tenantId),
        ),
      )
      .limit(1);
    if (!row || !row.bonzahPolicyId) {
      throw new NotFoundException(
        'Policy not found or has not yet been issued by Bonzah',
      );
    }

    const creds = await this.credentialsService.loadForTenant(tenantId);

    // Acquire/refresh token via the client's public authenticate path
    const token = await this.apiClient.authenticate(creds);

    // Bonzah's PDF endpoint expects policy_id in the URL path (V1 pattern).
    // Their own API docs describe query params only, but the real endpoint
    // requires the path-style URL — 400s if policy_id is sent as a query param.
    const url =
      `${creds.apiUrl}${BONZAH_PATHS.POLICY_DATA}` +
      `/${encodeURIComponent(row.bonzahPolicyId)}` +
      `?data_id=${encodeURIComponent(String(dataId))}` +
      `&download=1` +
      `&token=${encodeURIComponent(token)}`;

    const res = await fetch(url, {
      method: 'GET',
      headers: { [BONZAH_AUTH_HEADER]: token },
    });
    if (!res.ok) {
      throw new BonzahApiError(
        `Bonzah PDF download failed with HTTP ${res.status}`,
        { status: res.status },
      );
    }

    const contentType = res.headers.get('content-type') ?? 'application/pdf';
    const buffer = Buffer.from(await res.arrayBuffer());
    return {
      contentBase64: buffer.toString('base64'),
      contentType,
      fileName: `bonzah-policy-${row.bonzahPolicyId}-${dataId}.pdf`,
    };
  }
}

function shape(row: PolicyRow): BonzahPolicyResponse {
  return {
    id: row.id,
    tenantId: row.tenantId,
    rentalId: row.rentalId,
    customerId: row.customerId,
    chainId: row.chainId,
    chainSequence: row.chainSequence,
    policyType: row.policyType as 'original' | 'extension',
    mode: row.mode as BonzahMode,
    quoteId: row.quoteId,
    quoteNo: row.quoteNo,
    paymentId: row.paymentId,
    policyNo: row.policyNo,
    policyId: row.policyId,
    coverage: row.coverage as BonzahPolicyResponse['coverage'],
    tripStartDate: row.tripStartDate,
    tripEndDate: row.tripEndDate,
    pickupState: row.pickupState,
    premiumAmount: row.premiumAmount,
    status: row.status as BonzahPolicyStatus,
    policyIssuedAt: row.policyIssuedAt
      ? row.policyIssuedAt.toISOString()
      : null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
