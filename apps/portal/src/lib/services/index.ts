/**
 * Services barrel export
 *
 * Services are orchestrators that handle side effects and external interactions.
 * Unlike utilities (pure functions), services can:
 * - Make database queries
 * - Call external APIs
 * - Invoke edge functions
 * - Send notifications
 * - Manage state changes
 */

export * from "./email-service";
export * from "./sms-service";
export * from "./notification-service";
