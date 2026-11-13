export class UserError extends Error {}
export class BusyError extends Error {}
export class TelegramError extends Error {
  code: number;
  ambiguous: boolean;
  retryAfter: number;
  constructor(code: number, ambiguous = false, retryAfter = 0) {
    super('telegram_request_failed');
    this.code = code;
    this.ambiguous = ambiguous;
    this.retryAfter = retryAfter;
  }
}
