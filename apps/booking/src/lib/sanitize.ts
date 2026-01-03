/**
 * Input Sanitization Utilities
 * 
 * Provides sanitization functions to protect against XSS and injection attacks.
 * Uses built-in browser APIs for security without external dependencies.
 */

/**
 * Sanitize text input by removing potentially harmful HTML/script content
 * Uses the browser's built-in HTML parsing to strip tags safely
 */
export function sanitizeText(input: string): string {
    if (!input || typeof input !== 'string') return '';

    // Create a temporary element to leverage browser's HTML parsing
    const div = typeof document !== 'undefined'
        ? document.createElement('div')
        : null;

    if (div) {
        div.textContent = input; // This escapes HTML entities
        return div.innerHTML;
    }

    // Fallback for SSR - basic HTML entity encoding
    return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
}

/**
 * Sanitize and validate name input
 * Only allows letters, spaces, hyphens, and apostrophes
 */
export function sanitizeName(input: string): string {
    if (!input || typeof input !== 'string') return '';

    // Remove any HTML first
    const textOnly = sanitizeText(input.trim());

    // Only keep valid name characters
    return textOnly.replace(/[^a-zA-Z\s\-']/g, '').trim();
}

/**
 * Sanitize email input
 * Normalizes and validates email format
 */
export function sanitizeEmail(input: string): string {
    if (!input || typeof input !== 'string') return '';

    // Remove whitespace and convert to lowercase
    const normalized = input.trim().toLowerCase();

    // Basic email pattern - further validation should happen at form level
    const emailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

    if (!emailPattern.test(normalized)) {
        return '';
    }

    return normalized;
}

/**
 * Sanitize phone number input
 * Keeps only digits, plus sign, spaces, hyphens, and parentheses
 */
export function sanitizePhone(input: string): string {
    if (!input || typeof input !== 'string') return '';

    // Remove any HTML first
    const textOnly = sanitizeText(input.trim());

    // Only keep valid phone characters
    return textOnly.replace(/[^\d\s\-+()]/g, '').trim();
}

/**
 * Sanitize location/address input
 * Allows alphanumeric, spaces, common punctuation for addresses
 */
export function sanitizeLocation(input: string): string {
    if (!input || typeof input !== 'string') return '';

    // Remove any HTML first
    const textOnly = sanitizeText(input.trim());

    // Keep valid address characters (letters, numbers, common punctuation)
    // Allows: letters, numbers, spaces, commas, periods, hyphens, apostrophes, slashes, #
    return textOnly.replace(/[^a-zA-Z0-9\s,.\-'/#]/g, '').trim();
}

/**
 * Sanitize general text area input (like special requests)
 * More permissive but still protects against XSS
 */
export function sanitizeTextArea(input: string): string {
    if (!input || typeof input !== 'string') return '';

    // Remove any HTML/script content
    const sanitized = sanitizeText(input.trim());

    // Limit length to prevent abuse
    const maxLength = 1000;
    return sanitized.slice(0, maxLength);
}

/**
 * Validate that input doesn't contain suspicious patterns
 * Returns true if input appears safe, false if potentially malicious
 */
export function isInputSafe(input: string): boolean {
    if (!input || typeof input !== 'string') return true;

    // Check for common injection patterns
    const suspiciousPatterns = [
        /<script/i,
        /javascript:/i,
        /on\w+\s*=/i, // onclick=, onerror=, etc.
        /data:/i,
        /<iframe/i,
        /<object/i,
        /<embed/i,
        /vbscript:/i,
        /<svg/i,
        /<math/i,
    ];

    return !suspiciousPatterns.some(pattern => pattern.test(input));
}

/**
 * Escape HTML entities in a string
 * Use this when displaying user input in HTML
 */
export function escapeHtml(input: string): string {
    if (!input || typeof input !== 'string') return '';

    return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}
