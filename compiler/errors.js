/**
 * DivLang compile errors.
 *
 * Every error the tokenizer, parser or compiler reports for a problem in
 * the source is a DivError. Besides the readable message it carries the
 * location as data, so a host (an editor highlighting the offending line)
 * doesn't have to parse it back out of the text.
 */

export class DivError extends Error
{
  // stage: 'lexer' | 'parser' | 'compiler'
  // line/col: 1-based position the error refers to, or null when unknown.
  constructor(message, { stage, line = null, col = null } = {})
  {
    const hasLocation = Number.isInteger(line) && Number.isInteger(col);
    super(hasLocation ? `${message} at ${line}:${col}` : message);
    this.name = 'DivError';
    this.stage = stage;
    this.line = hasLocation ? line : null;
    this.col = hasLocation ? col : null;
    // The message without the " at L:C" suffix, for hosts that show the
    // location separately.
    this.reason = message;
  }
}
