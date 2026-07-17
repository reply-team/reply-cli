import http from 'http';
import {spawn} from 'child_process';
import {URL} from 'url';
import {RuntimeError} from '../utils/errors';
import {info} from '../utils/output';
import {create_pkce, create_state} from './pkce';
import {
    build_token_exchange_body,
    build_refresh_body,
    to_oauth_record,
    type Token_response,
} from './token';
import type {Oauth_record} from '../credentials/types';

// Public PKCE client registered in IdentityServer (REPLY-51291 / REPLY-50627).
const CLIENT_ID = 'Reply.Cli';
const SCOPE = 'openid profile email reply-web-api offline_access';
const DEFAULT_TIMEOUT_MS = 300_000;   // 5 minutes to complete the browser step

const build_authorize_url = (p: {
    authority: string;
    client_id: string;
    redirect_uri: string;
    scope: string;
    challenge: string;
    state: string;
}): string=>{
    const url = new URL('/connect/authorize', p.authority);
    url.search = new URLSearchParams({
        response_type: 'code',
        client_id: p.client_id,
        redirect_uri: p.redirect_uri,
        scope: p.scope,
        code_challenge: p.challenge,
        code_challenge_method: 'S256',
        state: p.state,
    }).toString();
    return url.toString();
};

const html_escape = (s: string): string=>s.replace(/[&<>"']/g, c=>
    ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c] as string));

// Escapes both args so any reflected value (e.g. the `error` query param) can
// never inject markup into the loopback page.
const success_page = (title: string, body: string): string=>
    `<!doctype html><meta charset="utf-8"><title>${html_escape(title)}</title>`
    + `<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;text-align:center">`
    + `<h1>${html_escape(title)}</h1><p>${html_escape(body)}</p></body>`;

// The opener + args for a platform. On Windows we use rundll32's
// FileProtocolHandler rather than `cmd /c start`, because `start` treats an
// unquoted `&` (which every OAuth URL has) as a command separator — rundll32
// takes the whole URL as a single argument, so it stays intact.
const browser_open_command = (
    platform: NodeJS.Platform,
    url: string,
): {command: string; args: string[]}=>{
    if (platform === 'darwin')
    {
        return {command: 'open', args: [url]};
    }
    if (platform === 'win32')
    {
        return {command: 'rundll32', args: ['url.dll,FileProtocolHandler', url]};
    }
    return {command: 'xdg-open', args: [url]};
};

// Best-effort browser launch. A headless/missing-opener box emits 'error'
// asynchronously; that is ignored on purpose because the caller always prints
// the URL for manual opening as a fallback.
const open_browser = (url: string): void=>{
    const {command, args} = browser_open_command(process.platform, url);
    const child = spawn(command, args, {stdio: 'ignore', detached: true});
    child.on('error', ()=>{ /* manual-URL fallback covers a failed launch */ });
    child.unref();
};

// Start a loopback listener on 127.0.0.1:<random port>, drive the browser to
// the authorize endpoint, and resolve with the captured authorization code.
const capture_code = (p: {
    authority: string;
    client_id: string;
    scope: string;
    challenge: string;
    state: string;
    open: (url: string) => void;
    timeout_ms: number;
}): Promise<{code: string; redirect_uri: string}>=>
    new Promise((resolve, reject)=>{
        let redirect_uri = '';
        let settled = false;
        const done = (fn: () => void): void=>{
            if (settled)
            {
                return;
            }
            settled = true;
            clearTimeout(timer);
            server.close();
            fn();
        };

        const server = http.createServer((req, res)=>{
            const url = new URL(req.url ?? '/', 'http://127.0.0.1');
            if (url.pathname !== '/callback')
            {
                res.writeHead(404, {'Content-Type': 'text/plain'});
                res.end('Not found');
                return;
            }
            const code = url.searchParams.get('code');
            const state = url.searchParams.get('state');
            const err = url.searchParams.get('error');
            if (err)
            {
                res.writeHead(400, {'Content-Type': 'text/html'});
                res.end(success_page('Login failed', `The authorization server returned: ${err}`));
                done(()=>reject(new RuntimeError(`Authorization failed: ${err}`, {code: 'oauth.authorize'})));
                return;
            }
            if (!code || state !== p.state)
            {
                res.writeHead(400, {'Content-Type': 'text/html'});
                res.end(success_page('Login failed', 'State mismatch or missing authorization code.'));
                done(()=>reject(new RuntimeError(
                    'OAuth state mismatch — aborting to avoid a possible CSRF.',
                    {code: 'oauth.state'})));
                return;
            }
            res.writeHead(200, {'Content-Type': 'text/html'});
            res.end(success_page('Login complete', 'You can close this tab and return to the terminal.'));
            done(()=>resolve({code, redirect_uri}));
        });

        const timer = setTimeout(()=>{
            done(()=>reject(new RuntimeError('Timed out waiting for the browser login.', {
                code: 'oauth.timeout',
                hint: 'Re-run the login and complete it in the browser.',
            })));
        }, p.timeout_ms);
        if (typeof timer.unref === 'function')
        {
            timer.unref();
        }

        server.on('error', e=>done(()=>reject(new RuntimeError('Could not start the loopback listener.', {
            code: 'oauth.loopback', detail: (e as Error).message,
        }))));

        // Port 0 = let the OS pick a free port; use the 127.0.0.1 IP literal in
        // the redirect (RFC 8252 §8.3) — the IS loopback validator accepts any
        // port on the portless registration.
        server.listen(0, '127.0.0.1', ()=>{
            const addr = server.address();
            const port = typeof addr === 'object' && addr ? addr.port : 0;
            redirect_uri = `http://127.0.0.1:${port}/callback`;
            const authorize_url = build_authorize_url({
                authority: p.authority, client_id: p.client_id, redirect_uri,
                scope: p.scope, challenge: p.challenge, state: p.state,
            });
            info('Opening your browser to complete sign-in…');
            info(`If it doesn't open, visit:\n  ${authorize_url}`);
            p.open(authorize_url);
        });
    });

const parse_token_error = (text: string): string=>{
    try {
        const j = JSON.parse(text) as {error?: string; error_description?: string};
        return j.error_description || j.error || text;
    } catch {
        return text;
    }
};

const post_token = async(authority: string, body: URLSearchParams): Promise<Token_response>=>{
    const res = await fetch(`${authority}/connect/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
        },
        body: body.toString(),
    });
    const text = await res.text();
    if (!res.ok)
    {
        throw new RuntimeError('OAuth token request failed.', {
            code: 'oauth.token',
            detail: `HTTP ${res.status}: ${parse_token_error(text)}`,
        });
    }
    return JSON.parse(text) as Token_response;
};

const exchange_code = async(p: {
    authority: string;
    client_id: string;
    redirect_uri: string;
    code: string;
    verifier: string;
    now?: number;
}): Promise<Oauth_record>=>{
    const now = p.now ?? Date.now();
    const resp = await post_token(p.authority, build_token_exchange_body({
        code: p.code, verifier: p.verifier, redirect_uri: p.redirect_uri, client_id: p.client_id,
    }));
    return to_oauth_record(resp, now);
};

const refresh_stored = async(p: {
    authority: string;
    record: Oauth_record;
    client_id?: string;
    now?: number;
}): Promise<Oauth_record>=>{
    if (!p.record.refresh_token)
    {
        throw new RuntimeError('No refresh token available.', {code: 'oauth.refresh'});
    }
    const now = p.now ?? Date.now();
    const resp = await post_token(p.authority, build_refresh_body({
        refresh_token: p.record.refresh_token, client_id: p.client_id ?? CLIENT_ID,
    }));
    return to_oauth_record(resp, now, p.record);
};

// Full authorization-code + PKCE loopback login. `open` is injectable so the
// loopback can be exercised without a real browser/IdP in tests.
const run_login = async(opts: {
    authority: string;
    client_id?: string;
    scope?: string;
    open?: (url: string) => void;
    now?: number;
    timeout_ms?: number;
}): Promise<Oauth_record>=>{
    const client_id = opts.client_id ?? CLIENT_ID;
    const scope = opts.scope ?? SCOPE;
    const {verifier, challenge} = create_pkce();
    const state = create_state();
    const {code, redirect_uri} = await capture_code({
        authority: opts.authority,
        client_id, scope, challenge, state,
        open: opts.open ?? open_browser,
        timeout_ms: opts.timeout_ms ?? DEFAULT_TIMEOUT_MS,
    });
    return exchange_code({authority: opts.authority, client_id, redirect_uri, code, verifier, now: opts.now});
};

export {
    CLIENT_ID, SCOPE,
    build_authorize_url, run_login, exchange_code, refresh_stored, browser_open_command,
};
