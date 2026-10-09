// Error taxonomy driving the CLI's exit-code contract:
//   0 ok · 1 API-or-runtime failure · 2 usage error · 3 outcome unknown (a write may have happened).
// On --json, the top-level handler prints `error.to_json()` as a single line.

type Ids = Record<string, number | null>;

type Error_json = {
    status?: number;
    code?: string;
    title?: string;
    detail?: string;
    hint?: string;
    reply_code?: string;
    ids?: Ids;
    retry_after?: number;
    details?: Record<string, unknown>;
};

const compact = (obj: Error_json): Error_json=>{
    const out: Error_json = {};
    for (const [k, v] of Object.entries(obj))
    {
        if (v !== undefined && v !== null)
        {
            (out as Record<string, unknown>)[k] = v;
        }
    }
    return out;
};

abstract class CliError extends Error {
    abstract readonly exit_code: number;
    code?: string;
    title?: string;
    detail?: string;
    hint?: string;
    reply_code?: string;
    ids?: Ids;
    retry_after?: number;
    details?: Record<string, unknown>;

    to_json(): {error: Error_json}
    {
        return {error: compact({
            status: (this as {status?: number}).status,
            code: this.code,
            title: this.title,
            detail: this.detail,
            hint: this.hint,
            reply_code: this.reply_code,
            ids: this.ids,
            retry_after: this.retry_after,
            details: this.details,
        })};
    }
}

// Bad invocation: unknown flag/env, missing argument, no credential to use.
class UsageError extends CliError {
    readonly exit_code = 2;

    constructor(message: string, opts: {code?: string; hint?: string} = {})
    {
        super(message);
        this.name = 'UsageError';
        this.title = message;
        this.code = opts.code;
        this.hint = opts.hint;
    }
}

// Non-HTTP runtime failure: corrupt credential store, network error,
// browser-launch failure, etc. Distinct from Api_error (which carries an
// HTTP status) but shares the exit-1 code.
class RuntimeError extends CliError {
    readonly exit_code = 1;

    constructor(message: string, opts: {code?: string; detail?: string; hint?: string} = {})
    {
        super(message);
        this.name = 'RuntimeError';
        this.title = message;
        this.code = opts.code;
        this.detail = opts.detail;
        this.hint = opts.hint;
    }
}

// v3 error body: {code: "contact.notFound", title, status, detail}.
type Api_error_body = {
    code?: string;
    title?: string;
    status?: number;
    detail?: string;
};

class Api_error extends CliError {
    readonly exit_code = 1;
    status: number;

    constructor(
        status: number,
        body: Api_error_body | string,
        opts: {hint?: string} = {},
    )
    {
        const parsed = typeof body === 'string' ? {detail: body} : body;
        const title = parsed.title || `HTTP ${status}`;
        const parts = [`Error: ${title}`];
        if (parsed.detail)
        {
            parts.push(`  Detail: ${parsed.detail}`);
        }
        parts.push(`  Status: ${status}`);
        if (parsed.code)
        {
            parts.push(`  Code: ${parsed.code}`);
        }
        if (opts.hint)
        {
            parts.push(`  Hint: ${opts.hint}`);
        }
        super(parts.join('\n'));
        this.name = 'Api_error';
        this.status = status;
        this.title = title;
        this.code = parsed.code;
        this.detail = parsed.detail;
        this.hint = opts.hint;
    }
}

type Operation_error_opts = {
    status?: number;
    reply_code?: string;
    detail?: string;
    hint?: string;
    ids?: Ids;
    retry_after?: number;
    details?: Record<string, unknown>;
};

// A Reply operation that ended without doing its main effect, on an answer that was definite.
class Operation_error extends CliError {
    readonly exit_code: number = 1;
    status?: number;

    constructor(code: string, title: string, opts: Operation_error_opts = {})
    {
        // The message is what prints without --json, so it carries the code and Reply's words too.
        super([title, ...(opts.detail ? [`  Detail: ${opts.detail}`] : []), `  Code: ${code}`].join('\n'));
        this.name = 'Operation_error';
        this.code = code;
        this.title = title;
        this.status = opts.status;
        this.reply_code = opts.reply_code;
        this.detail = opts.detail;
        this.hint = opts.hint;
        this.ids = opts.ids;
        this.retry_after = opts.retry_after;
        this.details = opts.details;
    }
}

// A write that may or may not have taken effect at Reply: it may have arrived, and no definite
// answer came back. It has an exit code of its own, so a caller never has to parse stderr to know.
class Unknown_outcome_error extends Operation_error {
    readonly exit_code: number = 3;

    constructor(title: string, opts: Operation_error_opts = {})
    {
        super('outcome.unknown', title, opts);
        this.name = 'Unknown_outcome_error';
    }
}

// Render a hint for the terminal. Api_error bakes its hint into the message, but
// UsageError and RuntimeError carry it as a field — and the top-level handler used
// to print only `message`, so 47 hints across the CLI were written and never seen,
// including the one that tells you how to switch team. Shape follows Api_error's
// `  Hint: ...` so both kinds of failure read the same; continuation lines keep
// their own indentation, which is what makes a quoted command stand out.
const format_hint = (hint: string): string=>hint
    .split('\n')
    .map((line, i)=>(i === 0 ? `  Hint: ${line}` : `  ${line}`))
    .join('\n');

export {CliError, UsageError, RuntimeError, Api_error, Operation_error, Unknown_outcome_error, format_hint};
export type {Error_json, Api_error_body, Ids, Operation_error_opts};
