/** An HTTP response is distinct from an unknown transport/response outcome.
 * Keep this type separate from the client so controlled client bindings can
 * preserve the same classification without exporting extra runtime helpers. */
export class MaterialServiceHttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'MaterialServiceHttpError';
  }
}
