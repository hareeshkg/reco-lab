export class AppError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}

export function safeLog(code: string) {
  console.error(
    JSON.stringify({ event: /^[A-Z_]+$/.test(code) ? code : "INTERNAL_ERROR" }),
  );
}
