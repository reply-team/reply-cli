// Error taxonomy driving the CLI's exit-code contract:
//   0 ok · 1 API-or-runtime failure · 2 usage error.
// On --json, the top-level handler prints `error.to_json()` as a single line.

type Error_json = {
    status?: number;
    code?: string;
    title?: string;
    detail?: string;
    hint?: string;
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

    to_json(): {error: Error_json}
    {
        return {error: compact({
            status: (this as {status?: number}).status,
            code: this.code,
            title: this.title,
            detail: this.detail,
            hint: this.hint,
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

export {CliError, UsageError, RuntimeError, Api_error, format_hint};
export type {Error_json, Api_error_body};
