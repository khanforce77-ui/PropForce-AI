/**
 * Core types for the AI orchestration layer.
 *
 * Security model: the model only ever supplies tool *arguments*. Everything that decides scope
 * (tenant, conversation, acting principal, permissions) comes from {@link ToolContext}, which the
 * orchestrator builds from trusted server state. Tool schemas reject those fields if the model
 * tries to pass them.
 */

/** Permissions the AI service principal may hold. Default deny: tools need one of these. */
export const AI_PERMISSIONS = [
  'property:read',
  'lead:write',
  'requirement:write',
  'client_history:read',
  'match:read',
  'availability:read',
  'viewing:request',
  'task:write',
  'fees:read',
  'agent:notify',
  'handover:request',
] as const;
export type AiPermission = (typeof AI_PERMISSIONS)[number];

/** Fixed, narrow permission set of the `ai-agent` principal (architecture §5). */
export const AI_AGENT_PERMISSIONS: ReadonlySet<AiPermission> = new Set(AI_PERMISSIONS);

export type ToolSensitivity = 'read' | 'write-low' | 'sensitive' | 'always-allowed';

export interface ToolContext {
  /** Trusted, from the resolved WhatsApp account / conversation. Never from the model. */
  readonly tenantId: string;
  readonly conversationId: string;
  readonly contactId: string;
  /** Unique id of this AI run, for audit correlation. */
  readonly runId: string;
  /**
   * Permissions of the conversation's assigned agent, mapped to AI permission names by the
   * caller. The AI never exceeds them (it acts with the intersection of its own set and this).
   * `null` means the conversation has no assigned agent yet; only tools that do not need an
   * agent ceiling (see `requiresAssignedAgent`) are then available.
   */
  readonly assignedAgentPermissions: ReadonlySet<AiPermission> | null;
  /** Agent has enabled auto-confirm for viewing requests (pre-authorization, FR-H). */
  readonly viewingAutoConfirm: boolean;
}

export type ToolErrorCode =
  | 'TOOL_NOT_ALLOWED'
  | 'RESERVED_ARGUMENT'
  | 'VALIDATION_FAILED'
  | 'PERMISSION_DENIED'
  | 'RATE_LIMITED'
  | 'SPEND_CAP_REACHED'
  | 'HANDLER_ERROR';

export type ToolResult =
  | { readonly ok: true; readonly data: unknown; readonly approvalRequired?: boolean }
  | { readonly ok: false; readonly code: ToolErrorCode; readonly message: string };

/** Audit row for every tool call attempt, allowed or refused (maps to `AiToolCall`). */
export interface ToolAuditRecord {
  readonly runId: string;
  readonly tenantId: string;
  readonly conversationId: string;
  readonly tool: string;
  /** Arguments after validation (or the raw keys only, when validation failed). */
  readonly args: unknown;
  readonly outcome: 'ok' | 'approval_required' | 'refused' | 'error';
  readonly code?: ToolErrorCode;
  readonly latencyMs: number;
  readonly at: Date;
}

export interface AuditSink {
  recordToolCall(record: ToolAuditRecord): Promise<void>;
}

/** Facts returned by tools in this turn. The grounding validator checks replies against them. */
export interface PropertyFact {
  readonly propertyId: string;
  readonly reference: string;
  readonly priceAed?: number;
  readonly bedrooms?: number;
  readonly areaSqft?: number;
  readonly community?: string;
  readonly status?: string;
}
