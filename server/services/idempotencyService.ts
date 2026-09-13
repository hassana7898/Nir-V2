import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { sync_mutations } from '../db/schema';
import crypto from 'crypto';

export interface IdempotentOperationParams {
  operationId: string;
  userId: string | null;
  resourceType: string;
  operationType: string;
  resourceId?: string;
  payload: any;
  execute: (tx: any) => Promise<any>;
}

export const executeIdempotentOperation = async (params: IdempotentOperationParams) => {
  const { operationId, userId, resourceType, operationType, resourceId, payload, execute } = params;
  
  // Create deterministic hash of payload
  const requestFingerprint = crypto.createHash('sha256').update(JSON.stringify(payload || {})).digest('hex');

  return db.transaction(async (tx: any) => {
    // Check for existing operation
    const existing = await tx.select().from(sync_mutations).where(eq(sync_mutations.id, operationId)).limit(1);
    
    if (existing.length > 0) {
      const prev = existing[0];
      if (prev.requestFingerprint === requestFingerprint) {
        // Return original result safely
        return { duplicate: true, result: prev.originalResult };
      } else {
        // Collision detected
        const error = new Error('شناسه عملیات تکراری است اما محتوا متفاوت است.');
        (error as any).code = 'IDEMPOTENCY_KEY_REUSED';
        throw error;
      }
    }

    // Execute business logic
    const result = await execute(tx);

    // Save idempotency record
    await tx.insert(sync_mutations).values({
      id: operationId,
      entityType: resourceType,
      action: operationType,
      payload,
      userId,
      resourceId: resourceId || null,
      requestFingerprint,
      status: 'success',
      originalResult: result,
      createdAt: new Date(),
    });

    return { duplicate: false, result };
  });
};
