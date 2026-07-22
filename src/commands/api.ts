import fs from 'fs';
import {Command} from 'commander';
import {build_context, type Cli_context} from '../context';
import {request_raw} from '../utils/client';
import {team_error_guidance} from '../teams';
import {authed} from './authed';
import {UsageError} from '../utils/errors';
import {print, warn, type Print_opts} from '../utils/output';

type Global_opts = {
    apiKey?: string;
    profile?: string;
    teamId?: string;
    userId?: string;
    userEmail?: string;
    json?: boolean;
    pretty?: boolean;
};

const read_globals = (cmd: Command): Global_opts=>{
    const o = cmd.optsWithGlobals();
    return {
        apiKey: o.apiKey, profile: o.profile,
        teamId: o.teamId, userId: o.userId, userEmail: o.userEmail,
        json: o.json, pretty: o.pretty,
    };
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

// Raw passthrough to a v3 endpoint. Prints {code, data} for any status; exits 1
// on >=400. On a team/user-resolution conflict, adds tailored guidance to stderr
// — this is the workload surface where such guidance belongs.
const handle_api = async(
    path: string, opts: {method?: string; body?: string}, ctx: Cli_context, g: Global_opts,
): Promise<void>=>{
    const body = read_body_arg(opts.body);
    const method = resolve_method(opts.method, body !== undefined);
    const {token, headers} = await authed(ctx, g);
    // Literal: the request URL is exactly api_base + the path the caller typed.
    const {status, data} = await request_raw(ctx.api_base, token, method, path, body, {headers});
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
        + '  echo \'<json>\' | reply api /v3/contacts --body -   # body from stdin')
    .action(async function(this: Command, path: string) {
        const g = read_globals(this);
        const o = this.opts();
        await handle_api(path, {method: o.method, body: o.body}, build_context({profile: g.profile}), g);
    });

export {api_command, handle_api, read_body_arg};
