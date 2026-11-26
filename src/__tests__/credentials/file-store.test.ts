import {describe, it, expect, beforeAll, beforeEach, afterEach, vi} from 'vitest';
import {spawnSync} from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {FileCredentialStore} from '../../credentials/file-store';
import {RuntimeError} from '../../utils/errors';
import type {Credential_record} from '../../credentials/types';

const POSIX = process.platform !== 'win32';

const OAUTH: Credential_record = {
    type: 'oauth',
    access_token: 'at',
    refresh_token: 'rt',
    expires_at: 1_700_000_000_000,
    user: {username: 'oleg@reply.io', id: 1},
};
const API_KEY: Credential_record = {type: 'api_key', key: 'sk_test', user: {username: 'ann@reply.io'}};

let dir: string;
let file: string;
let store: FileCredentialStore;

beforeEach(()=>{
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-store-'));
    file = path.join(dir, 'nested', 'credentials.json');
    store = new FileCredentialStore(file);
});

afterEach(()=>{
    fs.rmSync(dir, {recursive: true, force: true});
});

describe('credentials/FileCredentialStore', ()=>{
    it('returns undefined for a host before anything is stored', async()=>{
        expect(await store.get('oauth.dev.replyapp.io')).toBeUndefined();
        expect(await store.keys()).toEqual([]);
    });

    it('round-trips a record for a host', async()=>{
        await store.set('oauth.dev.replyapp.io', OAUTH);
        expect(await store.get('oauth.dev.replyapp.io')).toEqual(OAUTH);
    });

    it('keeps records per-host isolated', async()=>{
        await store.set('oauth.dev.replyapp.io', OAUTH);
        await store.set('api.reply.io', API_KEY);
        expect(await store.get('oauth.dev.replyapp.io')).toEqual(OAUTH);
        expect(await store.get('api.reply.io')).toEqual(API_KEY);
        expect((await store.keys()).sort()).toEqual(['api.reply.io', 'oauth.dev.replyapp.io']);
    });

    it('overwrites an existing host record', async()=>{
        await store.set('h', OAUTH);
        await store.set('h', API_KEY);
        expect(await store.get('h')).toEqual(API_KEY);
    });

    it('remove deletes a host and reports whether it existed', async()=>{
        await store.set('h', API_KEY);
        expect(await store.remove('h')).toBe(true);
        expect(await store.get('h')).toBeUndefined();
        expect(await store.remove('h')).toBe(false);
    });

    it('does not disturb other hosts on remove', async()=>{
        await store.set('a', OAUTH);
        await store.set('b', API_KEY);
        await store.remove('a');
        expect(await store.get('b')).toEqual(API_KEY);
    });

    it.skipIf(!POSIX)('writes the file with 0600 permissions', async()=>{
        await store.set('h', API_KEY);
        const mode = fs.statSync(file).mode & 0o777;
        expect(mode).toBe(0o600);
    });

    it.skipIf(!POSIX)('creates the parent config dir with 0700 permissions', async()=>{
        await store.set('h', API_KEY);
        const mode = fs.statSync(path.dirname(file)).mode & 0o777;
        expect(mode).toBe(0o700);
    });

    it.skipIf(!POSIX)('keeps 0600 after a rewrite', async()=>{
        await store.set('h', API_KEY);
        await store.set('h2', OAUTH);
        const mode = fs.statSync(file).mode & 0o777;
        expect(mode).toBe(0o600);
    });

    it('treats an empty file as no credentials', async()=>{
        fs.mkdirSync(path.dirname(file), {recursive: true});
        fs.writeFileSync(file, '');
        expect(await store.keys()).toEqual([]);
    });

    it('throws a RuntimeError on a corrupt store file', async()=>{
        fs.mkdirSync(path.dirname(file), {recursive: true});
        fs.writeFileSync(file, '{ this is not json');
        await expect(store.get('h')).rejects.toBeInstanceOf(RuntimeError);
        await expect(store.get('h')).rejects.toMatchObject({code: 'store.corrupt', detail: file});
    });

    it('throws a RuntimeError when the file holds a non-object', async()=>{
        fs.mkdirSync(path.dirname(file), {recursive: true});
        fs.writeFileSync(file, '["nope"]');
        await expect(store.keys()).rejects.toBeInstanceOf(RuntimeError);
    });

    // Breaks if a write gives up while Windows still refuses its read or its rename because another
    // program has the file open, which an antivirus scan or a backup can keep up for seconds: a token
    // the server already rotated would be lost with it. Or if the read and the rename each wait a
    // budget of their own, so a refresh can outlast the lock's stale age; or if a refusal that doesn't
    // end hangs the write or leaves its temp file behind; or if a read is retried off Windows, where a
    // refusal is a permission no retry fixes; or if a plain read waits too: a refresh's re-read comes
    // before its request, and would push it past the stale age. Or if two writes share a temp file:
    // two writers with one pid (each in a pid namespace of its own) would rename each other's.
    it('retries a write\'s read (on Windows) and its rename refused for seconds, from a temp file of its own, within one budget of about 5 s per write', async()=>{
        await store.set('h', API_KEY);
        const real = {
            read: fs.readFileSync, rename: fs.renameSync,
            platform: Object.getOwnPropertyDescriptor(process, 'platform') as PropertyDescriptor,
        };
        let refused = {read_until: 0, read_code: 'EBUSY', rename_until: 0};
        const temps: string[] = [];
        const spies = [
            vi.spyOn(fs, 'readFileSync').mockImplementation(((target: fs.PathOrFileDescriptor, ...rest: unknown[])=>{
                if (String(target) === file && Date.now() < refused.read_until)
                {
                    throw Object.assign(new Error(`${refused.read_code}: refused, open '${target}'`), {code: refused.read_code});
                }
                return (real.read as (...a: unknown[]) => unknown)(target, ...rest);
            }) as typeof fs.readFileSync),
            vi.spyOn(fs, 'renameSync').mockImplementation((from, to)=>{
                if (String(to) === file)
                {
                    temps.push(String(from));
                    if (Date.now() < refused.rename_until)
                    {
                        throw Object.assign(new Error(`EPERM: operation not permitted, rename '${from}'`), {code: 'EPERM'});
                    }
                }
                real.rename(from, to);
            }),
        ];
        type Case = {
            name: string;
            platform?: NodeJS.Platform;
            op?: 'get' | 'keys';
            read?: {code: string; for_ms: number};
            rename_for_ms?: number;
            ends: string;
            within_ms: [number, number];
        };
        const CASES: Case[] = [
            {name: 'a rename refused for 2 s', rename_for_ms: 2_000, ends: 'stored', within_ms: [2_000, 3_000]},
            {
                name: 'on Windows, a read refused for 1 s, then the rename until 2 s', platform: 'win32',
                read: {code: 'EBUSY', for_ms: 1_000}, rename_for_ms: 2_000, ends: 'stored', within_ms: [2_000, 3_000],
            },
            {
                name: 'on Windows, a read refused for 3 s, then the rename for good', platform: 'win32',
                read: {code: 'EBUSY', for_ms: 3_000}, rename_for_ms: Infinity, ends: 'EPERM', within_ms: [4_500, 6_000],
            },
            {
                name: 'on Windows, a read refused for good', platform: 'win32',
                read: {code: 'EBUSY', for_ms: Infinity}, ends: 'store.read', within_ms: [4_500, 6_000],
            },
            {name: 'a rename refused for good', rename_for_ms: Infinity, ends: 'EPERM', within_ms: [4_500, 6_000]},
            {
                name: 'on Linux, a read refused', platform: 'linux',
                read: {code: 'EACCES', for_ms: Infinity}, ends: 'store.read', within_ms: [0, 0],
            },
            {
                name: 'on Windows, a plain get with the read refused for good', platform: 'win32', op: 'get',
                read: {code: 'EBUSY', for_ms: Infinity}, ends: 'store.read', within_ms: [0, 0],
            },
            {
                name: 'on Windows, a plain keys with the read refused for good', platform: 'win32', op: 'keys',
                read: {code: 'EBUSY', for_ms: Infinity}, ends: 'store.read', within_ms: [0, 0],
            },
        ];
        const got: Record<string, {ends: string; ms: number}> = {};
        vi.useFakeTimers();
        try {
            for (const [i, c] of CASES.entries())
            {
                const started = Date.now();
                refused = {
                    read_until: started + (c.read?.for_ms ?? 0), read_code: c.read?.code ?? 'EBUSY',
                    rename_until: started + (c.rename_for_ms ?? 0),
                };
                Object.defineProperty(process, 'platform', {...real.platform, value: c.platform ?? real.platform.value});
                try {
                    const op = c.op === 'get' ? store.get('h') : c.op === 'keys' ? store.keys() : store.set(`k${i}`, OAUTH);
                    const ends = op.then(()=>(c.op ? 'read' : 'stored'), (e: {code?: string})=>String(e.code));
                    await vi.runAllTimersAsync();
                    got[c.name] = {ends: await ends, ms: Date.now() - started};
                } finally {
                    Object.defineProperty(process, 'platform', real.platform);
                }
            }
        } finally {
            vi.useRealTimers();
            spies.forEach(s=>s.mockRestore());
        }
        expect(Object.fromEntries(CASES.map(c=>[c.name, got[c.name].ends])))
            .toEqual(Object.fromEntries(CASES.map(c=>[c.name, c.ends])));
        for (const c of CASES)
        {
            expect(got[c.name].ms, c.name).toBeGreaterThanOrEqual(c.within_ms[0]);
            expect(got[c.name].ms, c.name).toBeLessThanOrEqual(c.within_ms[1]);
        }
        expect(await store.keys()).toEqual(['h', 'k0', 'k1']);
        expect(fs.readdirSync(path.dirname(file)).filter(name=>name.endsWith('.tmp'))).toEqual([]);
        // The four writes that reached a rename: one temp file each, kept through its retries.
        expect(new Set(temps).size).toBe(4);
        expect(temps.length).toBeGreaterThan(4);
    });
});

describe('credentials/FileCredentialStore — the lock beside the file', ()=>{
    const HOST = os.hostname();
    // This process's pid namespace as the store names it, read from a lock the store writes: where
    // /proc is hidden, that name is the store's own making.
    let PID_NS: string | undefined;
    beforeAll(async()=>{
        const probe = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reply-ns-')), 'credentials.json');
        try {
            await new FileCredentialStore(probe).with_lock(async()=>{
                PID_NS = JSON.parse(fs.readFileSync(`${probe}.lock`, 'utf8')).ns;
            });
        } finally {
            fs.rmSync(path.dirname(probe), {recursive: true, force: true});
        }
    });
    const lock = ()=>`${file}.lock`;
    // Another process's lock as it sits on disk, by default from this host and pid namespace. A
    // live holder is this test's parent process.
    const hold_lock = (holder: {pid: number; host?: string; ns?: string; id?: string; taken_at: number; peer?: string}): string=>{
        fs.mkdirSync(path.dirname(file), {recursive: true});
        const text = JSON.stringify({host: HOST, ns: PID_NS, ...holder});
        fs.writeFileSync(lock(), text);
        return text;
    };
    const gone_pid = (): number=>spawnSync(process.execPath, ['-e', '']).pid as number;
    const settles_within = (p: Promise<unknown>, ms: number): Promise<boolean>=>Promise.race([
        p.then(()=>true, ()=>true),
        new Promise<boolean>(resolve=>setTimeout(()=>resolve(false), ms)),
    ]);
    // Runs `after` after every call this module makes to the fs functions named, whether it throws or not.
    const after_each_call = (names: (keyof typeof fs)[], after: (name: string, args: unknown[]) => void)=>
        names.map(name=>{
            const original = fs[name] as (...a: unknown[]) => unknown;
            return vi.spyOn(fs, name as 'statSync').mockImplementation(((...args: unknown[])=>{
                try {
                    return original(...args);
                } finally {
                    after(name, args);
                }
            }) as never);
        });

    // Breaks if a login or a logout writes in the middle of another process's refresh, and one of
    // the two writes is lost; or if failing to delete the lock file fails a write that happened.
    // Or if two guards read the same: breaking a stale guard has to tell it from a live one.
    it('waits for a live lock before a set or a remove, then writes and lets it go, even when letting go fails', async()=>{
        await store.set('keep', API_KEY);
        hold_lock({pid: process.ppid, taken_at: Date.now()});
        const write = fs.writeFileSync;
        const guards: string[] = [];
        const guard_spy = vi.spyOn(fs, 'writeFileSync').mockImplementation(((target: fs.PathOrFileDescriptor, data: unknown, ...rest: unknown[])=>{
            if (String(target) === `${lock()}.guard`)
            {
                guards.push(String(data));
            }
            return (write as (...a: unknown[]) => void)(target, data, ...rest);
        }) as typeof fs.writeFileSync);
        try {
            const writes = Promise.all([store.set('h', OAUTH), store.remove('keep')]);
            expect(await settles_within(writes, 300)).toBe(false);
            expect(await store.keys()).toEqual(['keep']);
            fs.rmSync(lock());
            expect(await writes).toEqual([undefined, true]);
        } finally {
            guard_spy.mockRestore();
        }
        expect(await store.keys()).toEqual(['h']);
        expect(fs.existsSync(lock())).toBe(false);
        expect(guards).toHaveLength(2);
        expect(new Set(guards).size).toBe(2);

        // Windows refuses to delete a file another program holds open, an antivirus say.
        const busy = (target: unknown): void=>{
            if (String(target) === lock())
            {
                throw Object.assign(new Error(`EBUSY: resource busy or locked, unlink '${lock()}'`), {code: 'EBUSY'});
            }
        };
        const unlink = fs.unlinkSync;
        const rm = fs.rmSync;
        const spies = [
            vi.spyOn(fs, 'unlinkSync').mockImplementation(target=>{ busy(target); unlink(target); }),
            vi.spyOn(fs, 'rmSync').mockImplementation((target, opts)=>{ busy(target); rm(target, opts); }),
        ];
        try {
            await store.set('h2', API_KEY);
        } finally {
            spies.forEach(s=>s.mockRestore());
        }
        expect(await store.get('h2')).toEqual(API_KEY);
        // The lock left behind is this process's own, so its next write takes it over at once.
        await store.set('h3', API_KEY);
        expect(await store.keys()).toEqual(['h', 'h2', 'h3']);
        expect(fs.existsSync(lock())).toBe(false);
    });

    // Breaks if a lock left by a killed process blocks every later write; or if several processes
    // that find one stale lock each remove what is there by then, so two of them hold the lock.
    it('takes over a lock whose holder is gone, and never one a peer took over meanwhile', async()=>{
        hold_lock({pid: gone_pid(), taken_at: Date.now()});
        const s = new FileCredentialStore(file, {lock: {wait_ms: 2_000}});
        await s.set('h', API_KEY);
        expect(await s.get('h')).toEqual(API_KEY);
        expect(fs.existsSync(lock())).toBe(false);

        // Peer A takes the stale lock over just after this process judged it stale. Peer C creates a
        // lock of its own whenever the lock path is free. Only A may end up holding it.
        const stale = hold_lock({pid: gone_pid(), taken_at: Date.now()});
        const peer_a = JSON.stringify({pid: process.ppid, host: HOST, taken_at: Date.now(), peer: 'a'});
        const real = {read: fs.readFileSync, write: fs.writeFileSync, unlink: fs.unlinkSync, exists: fs.existsSync};
        let a_took_over = false;
        let c_took = false;
        const c_creates_when_free = (): void=>{
            if (a_took_over && !c_took && !real.exists(lock()))
            {
                try {
                    real.write(lock(), JSON.stringify({pid: process.ppid, host: HOST, taken_at: Date.now(), peer: 'c'}), {flag: 'wx'});
                    c_took = true;
                } catch {
                    // Someone else's lock is there.
                }
            }
        };
        const spies = [
            ...after_each_call(['renameSync', 'linkSync', 'unlinkSync', 'rmSync', 'writeFileSync', 'statSync'], c_creates_when_free),
            vi.spyOn(fs, 'readFileSync').mockImplementation(((...args: unknown[])=>{
                const out = (real.read as (...a: unknown[]) => unknown)(...args);
                if (!a_took_over && String(args[0]) === lock() && String(out) === stale)
                {
                    real.unlink(lock());
                    real.write(lock(), peer_a, {flag: 'wx'});
                    a_took_over = true;
                }
                c_creates_when_free();
                return out;
            }) as never),
        ];
        try {
            await expect(new FileCredentialStore(file, {lock: {wait_ms: 300}}).set('h', OAUTH))
                .rejects.toMatchObject({code: 'store.locked'});
        } finally {
            spies.forEach(spy=>spy.mockRestore());
        }
        expect({a_took_over, c_took, lock: fs.readFileSync(lock(), 'utf8')}).toEqual({a_took_over: true, c_took: false, lock: peer_a});
        expect(await s.get('h')).toEqual(API_KEY);
    });

    // The store as loaded by a process on `platform` that can't read its pid namespace, as in a
    // sandbox that hides /proc.
    const load_without_ns = async(platform: NodeJS.Platform): Promise<typeof FileCredentialStore>=>{
        const real = {platform: Object.getOwnPropertyDescriptor(process, 'platform') as PropertyDescriptor, readlink: fs.readlinkSync};
        const spy = vi.spyOn(fs, 'readlinkSync').mockImplementation(((target: fs.PathLike, ...rest: unknown[])=>{
            if (String(target) === '/proc/self/ns/pid')
            {
                throw Object.assign(new Error(`ENOENT: no such file or directory, readlink '${target}'`), {code: 'ENOENT'});
            }
            return (real.readlink as (...a: unknown[]) => unknown)(target, ...rest);
        }) as typeof fs.readlinkSync);
        Object.defineProperty(process, 'platform', {...real.platform, value: platform});
        try {
            vi.resetModules();
            return (await import('../../credentials/file-store')).FileCredentialStore;
        } finally {
            spy.mockRestore();
            Object.defineProperty(process, 'platform', real.platform);
        }
    };

    // Breaks if a pid from another host or another pid namespace is read as this one's: a holder
    // alive there would be taken over at once. Sandboxes that give every command its own pid
    // namespace give them all the same pid, so a lock with this process's pid that it didn't leave
    // itself is a live peer's. On Linux, two processes that can't read their namespaces can't tell
    // whether they share one, so neither trusts the other's pid; elsewhere no process has one, and
    // a dead holder's lock is taken over at once. Or if a holder that hangs keeps the lock for good.
    it('judges a lock from another host or pid namespace, or from a Linux process that can\'t read its own, by its age alone, and takes over one held longer than a refresh can run', async()=>{
        const peers = [
            {pid: gone_pid(), host: `not-${HOST}`, taken_at: Date.now()},
            {pid: gone_pid(), ns: `${PID_NS ?? 'pid:[1]'}-elsewhere`, taken_at: Date.now()},
            {pid: process.pid, id: 'not-left-here', taken_at: Date.now()},
        ];
        const outcomes: string[] = [];
        for (const peer of peers)
        {
            hold_lock(peer);
            outcomes.push(await new FileCredentialStore(file, {lock: {wait_ms: 300}}).set('h', API_KEY)
                .then(()=>'taken over', (e: {code?: string})=>String(e.code)));
            fs.rmSync(file, {force: true});
        }
        expect(outcomes).toEqual(['store.locked', 'store.locked', 'store.locked']);

        const blind: Record<string, string> = {};
        for (const platform of ['linux', 'win32'] as const)
        {
            fs.rmSync(lock(), {force: true});
            const [Peer, Mine] = [await load_without_ns(platform), await load_without_ns(platform)];
            let peer_lock: {ns?: string; id?: string} = {};
            await new Peer(file).with_lock(async()=>{
                peer_lock = JSON.parse(fs.readFileSync(lock(), 'utf8'));
            });
            hold_lock({pid: gone_pid(), ns: peer_lock.ns, id: peer_lock.id, taken_at: Date.now()});
            blind[platform] = await new Mine(file, {lock: {wait_ms: 300}}).set('h', API_KEY)
                .then(()=>'taken over', (e: {code?: string})=>String(e.code));
            fs.rmSync(file, {force: true});
        }
        expect(blind).toEqual({linux: 'store.locked', win32: 'taken over'});

        hold_lock({pid: process.ppid, taken_at: Date.now() - 5_000});
        const s = new FileCredentialStore(file, {lock: {wait_ms: 2_000, stale_ms: 1_000}});
        await s.set('h', API_KEY);
        expect(await s.get('h')).toEqual(API_KEY);
        expect(fs.existsSync(lock())).toBe(false);
    });

    // Breaks if a wait for a held lock has no end; or if, on Windows, a config dir that can't be
    // written waits out the whole wait as if another process held the lock; or if a lock let go
    // between a refused create and its read is taken for such a dir.
    it('fails store.locked when a live lock outlasts the wait, and store.lock soon when nothing holds it', async()=>{
        hold_lock({pid: process.ppid, taken_at: Date.now()});
        const s = new FileCredentialStore(file, {lock: {wait_ms: 200}});
        await expect(s.set('h', API_KEY)).rejects.toMatchObject({code: 'store.locked', exit_code: 1});
        expect(fs.existsSync(file)).toBe(false);
        expect(fs.existsSync(lock())).toBe(true);

        fs.rmSync(lock());
        const platform = Object.getOwnPropertyDescriptor(process, 'platform') as PropertyDescriptor;
        const write = fs.writeFileSync;
        Object.defineProperty(process, 'platform', {...platform, value: 'win32'});
        const spy = vi.spyOn(fs, 'writeFileSync').mockImplementation(((target: fs.PathOrFileDescriptor, ...rest: unknown[])=>{
            if (String(target) === lock())
            {
                throw Object.assign(new Error(`EPERM: operation not permitted, open '${lock()}'`), {code: 'EPERM'});
            }
            return (write as (...a: unknown[]) => void)(target, ...rest);
        }) as typeof fs.writeFileSync);
        const started = Date.now();
        try {
            await expect(new FileCredentialStore(file, {lock: {wait_ms: 3_000}}).set('h', API_KEY))
                .rejects.toMatchObject({code: 'store.lock', exit_code: 1});
        } finally {
            spy.mockRestore();
            Object.defineProperty(process, 'platform', platform);
        }
        expect(Date.now() - started).toBeLessThan(2_500);
        expect(fs.existsSync(file)).toBe(false);

        // Every create finds a lock, and every read finds it already let go: busy, not broken.
        const read = fs.readFileSync;
        const spies = [
            vi.spyOn(fs, 'writeFileSync').mockImplementation(((target: fs.PathOrFileDescriptor, ...rest: unknown[])=>{
                if (String(target) === lock())
                {
                    throw Object.assign(new Error(`EEXIST: file already exists, open '${lock()}'`), {code: 'EEXIST'});
                }
                return (write as (...a: unknown[]) => void)(target, ...rest);
            }) as typeof fs.writeFileSync),
            vi.spyOn(fs, 'readFileSync').mockImplementation(((target: fs.PathOrFileDescriptor, ...rest: unknown[])=>{
                if (String(target) === lock())
                {
                    throw Object.assign(new Error(`ENOENT: no such file or directory, open '${lock()}'`), {code: 'ENOENT'});
                }
                return (read as (...a: unknown[]) => unknown)(target, ...rest);
            }) as typeof fs.readFileSync),
        ];
        try {
            await expect(new FileCredentialStore(file, {lock: {wait_ms: 1_500}}).set('h', API_KEY))
                .rejects.toMatchObject({code: 'store.locked', exit_code: 1});
        } finally {
            spies.forEach(spy=>spy.mockRestore());
        }
    }, 10_000);
});
