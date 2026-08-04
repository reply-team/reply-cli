import fs from 'fs';
import {Command} from 'commander';
import {build_context, type Cli_context} from '../context';
import {request_raw, type Raw_response} from '../utils/client';
import {team_error_guidance} from '../teams';
import {authed} from './authed';
import {UsageError} from '../utils/errors';
import {print, warn, REDACTED, type Print_opts} from '../utils/output';

type Global_opts = {
    apiKey?: string;
    profile?: string;
    teamId?: string;
    userId?: string;
    userEmail?: string;
    json?: boolean;
    pretty?: boolean;
    verbose?: boolean;
};

const read_globals = (cmd: Command): Global_opts=>{
    const o = cmd.optsWithGlobals();
    return {
        apiKey: o.apiKey, profile: o.profile,
        teamId: o.teamId, userId: o.userId, userEmail: o.userEmail,
        json: o.json, pretty: o.pretty, verbose: o.verbose,
    };
};

// curl -v-style request/response trace to stderr (keeps stdout the clean
// {code, data}). Authorization is already redacted by request_raw; redact any
// cookie header defensively.
const print_trace = (r: Raw_response): void=>{
    const lines = [`> ${r.request.method} ${r.request.url}`];
    for (const [k, v] of Object.entries(r.request.headers))
    {
        lines.push(`> ${k}: ${v}`);
    }
    if (r.request.body)
    {
        lines.push('>', `> ${r.request.body}`);
    }
    lines.push(`< ${r.status}`);
    for (const [k, v] of Object.entries(r.response_headers))
    {
        lines.push(`< ${k}: ${/cookie/i.test(k) ? REDACTED : v}`);
    }
    console.error(lines.join('\n'));
};

const print_opts = (g: Global_opts): Print_opts=>({json: g.json, pretty: g.pretty});

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const read_all_stdin = (): string=>{
    try {
        return fs.readFileSync(0, 'utf8');
    } catch {
        return '';
    }
};

// Parse the --body argument: inline JSON, @<file>, or '-' for stdin. Injectable
// stdin reader keeps it unit-testable.
const read_body_arg = (raw: string | undefined, read_stdin: () => string = read_all_stdin): unknown=>{
    if (raw === undefined)
    {
        return undefined;
    }
    let text: string;
    if (raw === '-')
    {
        text = read_stdin();
    }
    else if (raw.startsWith('@'))
    {
        try {
            text = fs.readFileSync(raw.slice(1), 'utf8');
        } catch (e) {
            throw new UsageError(`Could not read body file '${raw.slice(1)}'.`, {
                code: 'usage.api', hint: (e as Error).message,
            });
        }
    }
    else
    {
        text = raw;
    }
    try {
        return JSON.parse(text);
    } catch {
        throw new UsageError('--body must be valid JSON (inline, @file, or - for stdin).', {code: 'usage.api'});
    }
};

const resolve_method = (flag: string | undefined, has_body: boolean): string=>{
    if (flag === undefined)
    {
        return has_body ? 'POST' : 'GET';
    }
    const m = flag.trim().toUpperCase();
    if (!ALLOWED_METHODS.includes(m))
    {
        throw new UsageError(`--method must be one of ${ALLOWED_METHODS.join(', ')}.`, {
            code: 'usage.api', hint: `Got: ${flag}`,
        });
    }
    return m;
};

// A drive-prefixed path is the signature of MSYS/Cygwin path conversion, not of
// anything a caller would type: Git Bash on Windows rewrites a leading-slash
// argument into a Windows path before the CLI is even started.
const MSYS_DRIVE = /^[A-Za-z]:[\\/]/;
// Recover the intended path out of a mangled one, so the fix can be quoted back
// verbatim instead of described. `C:/Program Files/Git/v3/whoami` -> `v3/whoami`.
// Both separators, because MSYS emits forward slashes but a path pasted from cmd
// arrives with backslashes.
const VERSION_SEGMENT = /[\\/](v\d+[\\/].*)$/;

// The request URL is built literally as api_base + path, so a path that is not a
// path silently produces a nonsense URL and a 404 — indistinguishable from an
// endpoint that genuinely does not exist. That is not hypothetical: an agent hit
// exactly this under Git Bash and told its user a documented feature was "not
// enabled on this account". Refuse instead, before spending a request, and exit 2
// (usage) so the failure cannot be mistaken for an upstream one.
const assert_api_path = (path: string): void=>{
    if (path.startsWith('/'))
    {
        return;
    }
    const recovered = path.match(VERSION_SEGMENT)?.[1].replace(/\\/g, '/');
    const intended = recovered ? `/${recovered}` : '/v3/whoami';
    const hint = MSYS_DRIVE.test(path)
        ? [
            'Your shell rewrote the argument before the CLI saw it: Git Bash / MSYS on',
            'Windows turns a leading-slash argument into a Windows path. Quoting does not',
            'help — quotes are removed before the conversion. Any of these does:',
            `  reply api /${intended}`,
            `  MSYS_NO_PATHCONV=1 reply api ${intended}`,
            '  ...or run the same command from PowerShell or cmd.',
        ].join('\n')
        : `Paths are taken verbatim from the docs and start with a slash, e.g. ${intended}.`;
    throw new UsageError(`The path must start with '/' — got '${path}'.`, {code: 'usage.api', hint});
};

// Raw passthrough to a v3 endpoint. Prints {code, data} for any status; exits 1
// on >=400. On a team/user-resolution conflict, adds tailored guidance to stderr
// — this is the workload surface where such guidance belongs.
const handle_api = async(
    path: string, opts: {method?: string; body?: string}, ctx: Cli_context, g: Global_opts,
): Promise<void>=>{
    assert_api_path(path);
    const body = read_body_arg(opts.body);
    const method = resolve_method(opts.method, body !== undefined);
    const {token, headers} = await authed(ctx, g);
    // Literal: the request URL is exactly api_base + the path the caller typed.
    const resp = await request_raw(ctx.api_base, token, method, path, body, {headers});
    const {status, data} = resp;
    if (g.verbose)
    {
        print_trace(resp);
    }
    print({code: status, data}, print_opts(g));
    if (status >= 400)
    {
        process.exitCode = 1;
        const guidance = team_error_guidance(status, data);
        if (guidance)
        {
            warn(guidance);
        }
    }
};

const api_command = new Command('api')
    .argument('<path>', 'v3 path as in the docs, e.g. /v3/whoami; query goes in the path')
    .option('--method <verb>', 'HTTP method (default GET; POST when --body is given)')
    .option('--body <json>', 'JSON body: inline, @file, or - for stdin')
    .description('Raw authenticated request to a v3 endpoint; prints {code, data}')
    .addHelpText('after',
        '\nDocs: https://docs.reply.io/api-reference/introduction\n'
        + '\nUse the path exactly as in the docs (starts with /v3); the query string\n'
        + 'goes in the path.\n'
        + '\nExamples:\n'
        + '  reply api /v3/whoami                        # your identity + team\n'
        + '  reply api /v3/sequences                     # list sequences\n'
        + '  reply api /v3/contacts --pretty             # list contacts (indented)\n'
        + '  reply api /v3/sequences/12345               # one sequence by id\n'
        + '  reply api /v3/contacts --body @contact.json # create a contact (POST; body per docs)\n'
        + '  echo \'<json>\' | reply api /v3/contacts --body -   # body from stdin\n'
        + '\nGit Bash / MSYS on Windows rewrites a leading-slash argument into a Windows\n'
        + 'path, and quoting does not help. Double the slash — reply api //v3/whoami —\n'
        + 'or set MSYS_NO_PATHCONV=1. PowerShell, macOS and Linux are unaffected.')
    .action(async function(this: Command, path: string) {
        const g = read_globals(this);
        const o = this.opts();
        await handle_api(path, {method: o.method, body: o.body}, build_context({profile: g.profile}), g);
    });

export {api_command, handle_api, read_body_arg, assert_api_path};
