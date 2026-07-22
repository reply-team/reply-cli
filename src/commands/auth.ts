import readline from 'readline';
import {Command} from 'commander';
import {PROGRAM_NAME, get_env, env_var} from '../config';
import {build_context, type Cli_context} from '../context';
import {create_client} from '../utils/client';
import {resolve_credential} from '../auth/resolve';
import {resolve_request_identity} from '../auth/request-identity';
import {run_login} from '../auth/oauth-flow';
import {describe_status} from '../auth/status';
import {UsageError} from '../utils/errors';
import {success, info, warn, print, pc, type Print_opts} from '../utils/output';
import type {Api_key_record, Credential_record, Principal} from '../credentials/types';

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

// Resolve the team/acting-user headers for a request from the global flags,
// env, and the profile's pinned team. `credential_type` only affects the
// OAuth advisory note; the headers themselves are never gated on it.
const resolve_identity = (g: Global_opts, ctx: Cli_context, credential_type: 'oauth' | 'api_key')=>
    resolve_request_identity({
        team_id_flag: g.teamId,
        user_id_flag: g.userId,
        user_email_flag: g.userEmail,
        env: process.env,
        profile_team_id: ctx.team_id,
        credential_type,
    });

const print_opts = (g: Global_opts): Print_opts=>({json: g.json, pretty: g.pretty});
const wants_json = (g: Global_opts): boolean=>Boolean(g.json || g.pretty);

// Only surface the profile in human output when it's not the implicit default,
// so the common (no-profile) user never sees profile noise.
const profile_note = (name: string): string=>name === 'default' ? '' : ` (profile: ${name})`;

// v3 /whoami returns exactly {userId, username, teamId} (WhoamiResponse);
// read those three, guarding types so a malformed body degrades to empty.
const normalize_principal = (raw: Record<string, unknown>): Principal=>{
    const num = (v: unknown): number | undefined=>typeof v === 'number' ? v : undefined;
    const str = (v: unknown): string | undefined=>typeof v === 'string' ? v : undefined;
    return {
        id: num(raw.userId),
        username: str(raw.username),
        team_id: num(raw.teamId),
    };
};

const principal_label = (p: Principal): string=>{
    const who = p.username ?? (p.id !== undefined ? `#${p.id}` : 'unknown');
    const meta: string[] = [];
    // Only append the user id as extra when the username already carries the
    // display name — otherwise `who` is already `#id` and it would be redundant.
    if (p.username && p.id !== undefined)
    {
        meta.push(`user ${p.id}`);
    }
    if (p.team_id !== undefined)
    {
        meta.push(`team ${p.team_id}`);
    }
    return meta.length ? `${who} (${meta.join(', ')})` : who;
};

const fetch_whoami = async(
    api_base: string, token: string, headers?: Record<string, string>,
): Promise<Record<string, unknown>>=>{
    const raw = await create_client(api_base, token, headers).get<Record<string, unknown>>('/v3/whoami');
    return raw ?? {};
};

// The credential is already valid here; persist it before the identity lookup
// so a transient /whoami failure can't discard it. Enriching the stored record
// with the principal is best-effort.
const enrich_identity = async(
    ctx: Cli_context,
    token: string,
    headers: Record<string, string>,
    record: Credential_record,
): Promise<Principal | undefined>=>{
    try {
        const user = normalize_principal(await fetch_whoami(ctx.api_base, token, headers));
        record.user = user;
        await ctx.store.set(ctx.key, record);
        return user;
    } catch (e) {
        warn(`Signed in, but could not fetch your identity: ${(e as Error).message}`);
        return undefined;
    }
};

const read_token_from_stdin = async(): Promise<string>=>{
    if (process.stdin.isTTY)
    {
        const rl = readline.createInterface({input: process.stdin, output: process.stderr, terminal: true});
        const line = await new Promise<string>(resolve=>{
            rl.question('Paste your API key, then press Enter: ', resolve);
            // The prompt is already written; swallow the echo of typed characters
            // so the key never appears on screen (the piped path never echoes).
            (rl as unknown as {_writeToOutput: (s: string) => void})._writeToOutput = ()=>{};
        });
        rl.close();
        process.stderr.write('\n');
        return line.trim();
    }
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin)
    {
        chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8').trim();
};

const handle_login = async(
    ctx: Cli_context, g: Global_opts, login: typeof run_login = run_login,
): Promise<void>=>{
    // Validate identity flags before opening the browser, so a bad combo fails fast.
    const identity = resolve_identity(g, ctx, 'oauth');
    identity.warnings.forEach(w=>warn(w));
    const record = await login({authority: ctx.authority});
    // Persist first — a good login must survive a transient /whoami failure
    // (else the user pays another browser round-trip).
    await ctx.store.set(ctx.key, record);
    const user = await enrich_identity(ctx, record.access_token, identity.headers, record);
    if (wants_json(g))
    {
        print({logged_in: true, method: 'oauth', profile: ctx.profile, user}, print_opts(g));
        return;
    }
    success(`Logged in${user ? ` as ${principal_label(user)}` : ''}${profile_note(ctx.profile)}.`);
};

const handle_login_token = async(
    ctx: Cli_context, g: Global_opts, read_token: () => Promise<string> = read_token_from_stdin,
): Promise<void>=>{
    // Validate identity flags before consuming stdin.
    const identity = resolve_identity(g, ctx, 'api_key');
    const key = await read_token();
    if (!key)
    {
        throw new UsageError('No API key was provided on stdin.', {
            code: 'usage.stdin',
            hint: `Try: echo <key> | ${PROGRAM_NAME} auth login --with-token`,
        });
    }
    const raw = await fetch_whoami(ctx.api_base, key, identity.headers);
    const user = normalize_principal(raw);
    const record: Api_key_record = {type: 'api_key', key, user};
    await ctx.store.set(ctx.key, record);
    if (wants_json(g))
    {
        print({logged_in: true, method: 'api_key', profile: ctx.profile, user}, print_opts(g));
        return;
    }
    success(`Stored API key for ${principal_label(user)}${profile_note(ctx.profile)}.`);
};

const handle_logout = async(ctx: Cli_context, g: Global_opts): Promise<void>=>{
    const removed = await ctx.store.remove(ctx.key);
    if (wants_json(g))
    {
        print({logged_out: removed}, print_opts(g));
        return;
    }
    if (removed)
    {
        success('Logged out.');
        return;
    }
    info('No stored credential to remove.');
};

const handle_status = async(ctx: Cli_context, g: Global_opts): Promise<void>=>{
    const api_key_env = get_env('API_KEY');
    const ephemeral = Boolean(g.apiKey || api_key_env);
    const record = ephemeral ? undefined : await ctx.store.get(ctx.key);
    const status = describe_status({
        profile: ctx.profile,
        api_key_flag: g.apiKey,
        api_key_env,
        record,
        now: Date.now(),
    });
    const cred_type: 'oauth' | 'api_key' = ephemeral ? 'api_key' : (record?.type ?? 'api_key');
    const {headers} = resolve_identity(g, ctx, cred_type);
    const team_header = headers['X-TEAM-ID'];
    const acting_user = headers['X-USER-ID'];
    const acting_email = headers['X-User-Email'];
    if (!status.authenticated)
    {
        process.exitCode = 1;
    }
    if (wants_json(g))
    {
        print({
            ...status,
            ...(team_header ? {team_id: Number(team_header)} : {}),
            ...(acting_user ? {acting_user_id: Number(acting_user)} : {}),
            ...(acting_email ? {acting_email} : {}),
        }, print_opts(g));
        return;
    }
    if (!status.authenticated)
    {
        info(`Not authenticated${profile_note(status.profile)}.`);
        info(`Run \`${PROGRAM_NAME} auth login\` or set ${env_var('API_KEY')}.`);
        return;
    }
    success('Authenticated.');
    const lines: string[] = [];
    if (status.profile !== 'default')
    {
        lines.push(`  Profile: ${status.profile}`);
    }
    lines.push(`  Source:  ${status.source}`);
    lines.push(`  Method:  ${status.method}`);
    if (status.user)
    {
        lines.push(`  User:    ${principal_label(status.user)}`);
    }
    if (team_header)
    {
        lines.push(`  Team:    ${team_header}`);
    }
    if (acting_email)
    {
        lines.push(`  Acting as: ${acting_email}`);
    }
    else if (acting_user)
    {
        lines.push(`  Acting as: user ${acting_user}`);
    }
    if (status.method === 'oauth')
    {
        lines.push(`  Expires: ${status.expires_at}${status.expired ? pc.red(' (expired)') : ''}`);
    }
    console.log(lines.join('\n'));
};

const handle_whoami = async(ctx: Cli_context, g: Global_opts): Promise<void>=>{
    const resolved = await resolve_credential(
        {api_key: g.apiKey},
        {key: ctx.key, store: ctx.store, env: process.env, refresh: ctx.refresh});
    const identity = resolve_identity(g, ctx, resolved.type);
    identity.warnings.forEach(w=>warn(w));
    const raw = await fetch_whoami(ctx.api_base, resolved.token, identity.headers);
    if (wants_json(g))
    {
        print(raw, print_opts(g));
        return;
    }
    const principal = normalize_principal(raw);
    success(`Credential is valid (${resolved.type}, source: ${resolved.source})${profile_note(ctx.profile)}.`);
    console.log(`  ${principal_label(principal)}`);
};

const auth_command = new Command('auth').description('Authenticate and inspect identity');

auth_command
    .command('login')
    .description('Log in via OAuth (browser), or --with-token to store an API key from stdin')
    .option('--with-token', 'Read an API key from stdin instead of running the OAuth flow')
    .addHelpText('after',
        `\nExamples:\n  ${PROGRAM_NAME} auth login\n  echo <key> | ${PROGRAM_NAME} auth login --with-token`)
    .action(async function(this: Command) {
        const g = read_globals(this);
        const ctx = build_context({profile: g.profile});
        if (this.opts().withToken)
        {
            await handle_login_token(ctx, g);
            return;
        }
        await handle_login(ctx, g);
    });

auth_command
    .command('logout')
    .description('Remove the stored credential')
    .action(async function(this: Command) {
        const g = read_globals(this);
        await handle_logout(build_context({profile: g.profile}), g);
    });

auth_command
    .command('status')
    .description('Show the active credential source, method, user and OAuth expiry (no secrets)')
    .addHelpText('after',
        `\nExamples:\n  ${PROGRAM_NAME} auth status\n  ${PROGRAM_NAME} auth status --json\n\nRuns offline — no API call.`)
    .action(async function(this: Command) {
        const g = read_globals(this);
        await handle_status(build_context({profile: g.profile}), g);
    });

auth_command
    .command('whoami')
    .description('Validate the active credential against the API and print the principal')
    .addHelpText('after', `\nExamples:\n  ${PROGRAM_NAME} auth whoami\n  ${PROGRAM_NAME} auth whoami --json`)
    .action(async function(this: Command) {
        const g = read_globals(this);
        await handle_whoami(build_context({profile: g.profile}), g);
    });

export {
    auth_command,
    normalize_principal,
    principal_label,
    handle_status,
    handle_whoami,
    handle_login,
    handle_login_token,
};
