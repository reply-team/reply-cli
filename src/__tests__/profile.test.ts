import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {resolve_profile, current_profile_name, list_profiles, set_current_profile, add_profile, set_profile, rename_profile_def, delete_profile_def, unset_profile_field, describe_profile, PROD} from '../profile';
import {UsageError, RuntimeError} from '../utils/errors';

let dir: string;

const env_for = (over: Record<string, string> = {})=>({REPLY_CONFIG_DIR: dir, ...over});

const write_config = (obj: unknown)=>
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(obj), 'utf8');

beforeEach(()=>{
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reply-profile-'));
});
afterEach(()=>{
    fs.rmSync(dir, {recursive: true, force: true});
});

describe('profile — no environment abstraction, only a default + user profiles', ()=>{
    it('resolves the built-in default to prod when nothing is set and no config exists', ()=>{
        const p = resolve_profile(undefined, env_for());
        expect(p).toEqual({name: 'default', authority: PROD.authority, api_base: PROD.api_base});
        expect(p.api_base).toBe('https://api.reply.io/v3');
        expect(p.authority).toBe('https://oauth.reply.io');
    });

    it('selects a user-defined profile via --profile', ()=>{
        write_config({profiles: {dev: {authority: 'https://oauth.dev.replyapp.io', api_base: 'https://api.dev.reply.io/v3'}}});
        const p = resolve_profile('dev', env_for());
        expect(p).toMatchObject({name: 'dev', authority: 'https://oauth.dev.replyapp.io', api_base: 'https://api.dev.reply.io/v3'});
    });

    it('uses REPLY_PROFILE when no flag is given', ()=>{
        write_config({profiles: {dev: {authority: 'https://a', api_base: 'https://b'}}});
        expect(resolve_profile(undefined, env_for({REPLY_PROFILE: 'dev'})).name).toBe('dev');
    });

    it('lets the --profile flag beat REPLY_PROFILE', ()=>{
        write_config({profiles: {
            dev: {authority: 'https://dev-a', api_base: 'https://dev-b'},
            stg: {authority: 'https://stg-a', api_base: 'https://stg-b'},
        }});
        expect(resolve_profile('stg', env_for({REPLY_PROFILE: 'dev'})).name).toBe('stg');
    });

    it('throws a UsageError for an unknown profile', ()=>{
        expect(()=>resolve_profile('nope', env_for())).toThrow(UsageError);
    });

    it('lets a user config override the default profile', ()=>{
        write_config({profiles: {default: {authority: 'https://my-auth', api_base: 'https://my-api'}}});
        expect(resolve_profile(undefined, env_for())).toMatchObject({name: 'default', authority: 'https://my-auth'});
    });

    it('strips trailing slashes from profile URLs', ()=>{
        write_config({profiles: {dev: {authority: 'https://a/', api_base: 'https://b/v3/'}}});
        const p = resolve_profile('dev', env_for());
        expect(p.authority).toBe('https://a');
        expect(p.api_base).toBe('https://b/v3');
    });

    it('inherits missing URLs from the embedded default (prod)', ()=>{
        write_config({profiles: {'alice@reply.io': {}}});
        const p = resolve_profile('alice@reply.io', env_for());
        expect(p).toEqual({name: 'alice@reply.io', authority: PROD.authority, api_base: PROD.api_base});
    });

    it('inherits per-field: overrides api_base but keeps the prod authority', ()=>{
        write_config({profiles: {stg: {api_base: 'https://api.stage.reply.io/v3'}}});
        const p = resolve_profile('stg', env_for());
        expect(p.authority).toBe(PROD.authority);
        expect(p.api_base).toBe('https://api.stage.reply.io/v3');
    });

    it('throws a RuntimeError on a corrupt config file', ()=>{
        fs.writeFileSync(path.join(dir, 'config.json'), '{ not json', 'utf8');
        expect(()=>resolve_profile('dev', env_for())).toThrow(RuntimeError);
    });
});

describe('profile — current (persisted) profile', ()=>{
    const two = {
        dev: {authority: 'https://dev-a', api_base: 'https://dev-b'},
        stg: {authority: 'https://stg-a', api_base: 'https://stg-b'},
    };

    it('resolve_profile falls back to the persisted current profile', ()=>{
        write_config({current_profile: 'dev', profiles: two});
        expect(resolve_profile(undefined, env_for()).name).toBe('dev');
    });

    it('the --profile flag beats the persisted current', ()=>{
        write_config({current_profile: 'dev', profiles: two});
        expect(resolve_profile('stg', env_for()).name).toBe('stg');
    });

    it('REPLY_PROFILE env beats the persisted current', ()=>{
        write_config({current_profile: 'dev', profiles: two});
        expect(resolve_profile(undefined, env_for({REPLY_PROFILE: 'stg'})).name).toBe('stg');
    });

    it('current_profile_name is default when unset, else the persisted value', ()=>{
        expect(current_profile_name(env_for())).toBe('default');
        write_config({current_profile: 'dev', profiles: two});
        expect(current_profile_name(env_for())).toBe('dev');
    });

    it('list_profiles reports default + user profiles and the current one', ()=>{
        write_config({current_profile: 'dev', profiles: two});
        const l = list_profiles(env_for());
        expect(l.current).toBe('dev');
        expect([...l.available].sort()).toEqual(['default', 'dev', 'stg']);
    });

    it('set_current_profile persists the choice and preserves user profiles', ()=>{
        write_config({profiles: two});
        set_current_profile('dev', env_for());
        expect(current_profile_name(env_for())).toBe('dev');
        expect(resolve_profile('stg', env_for()).authority).toBe('https://stg-a');
    });

    it('set_current_profile allows the built-in default even with no config', ()=>{
        set_current_profile('default', env_for());
        expect(current_profile_name(env_for())).toBe('default');
    });

    it('set_current_profile rejects an unknown profile', ()=>{
        expect(()=>set_current_profile('nope', env_for())).toThrow(UsageError);
    });
});

describe('profile — add (create, URLs optional)', ()=>{
    it('creates a URL-less profile that inherits prod', ()=>{
        add_profile('alice@reply.io', {}, env_for());
        expect(resolve_profile('alice@reply.io', env_for())).toEqual({
            name: 'alice@reply.io', authority: PROD.authority, api_base: PROD.api_base,
        });
    });

    it('creates a profile with explicit URLs', ()=>{
        add_profile('dev', {authority: 'https://oauth.dev.replyapp.io', api_base: 'https://api.dev.reply.io/v3'}, env_for());
        expect(resolve_profile('dev', env_for())).toMatchObject({
            authority: 'https://oauth.dev.replyapp.io', api_base: 'https://api.dev.reply.io/v3',
        });
    });

    it('preserves other profiles and lets set_current select the new one', ()=>{
        add_profile('alice@reply.io', {}, env_for());
        add_profile('bob@reply.io', {}, env_for());
        set_current_profile('bob@reply.io', env_for());
        const l = list_profiles(env_for());
        expect([...l.available].sort()).toEqual(['alice@reply.io', 'bob@reply.io', 'default']);
        expect(l.current).toBe('bob@reply.io');
    });

    it('rejects adding the built-in default and empty names', ()=>{
        expect(()=>add_profile('default', {}, env_for())).toThrow(UsageError);
        expect(()=>add_profile('   ', {}, env_for())).toThrow(UsageError);
    });
});

describe('profile — team_id property (account-specific, not inherited)', ()=>{
    it('surfaces a profile team_id from config', ()=>{
        write_config({profiles: {dev: {authority: 'https://a', api_base: 'https://b', team_id: 1045}}});
        expect(resolve_profile('dev', env_for()).team_id).toBe(1045);
    });

    it('has no team_id by default and does not inherit one', ()=>{
        write_config({profiles: {'alice@reply.io': {}}});
        expect(resolve_profile('alice@reply.io', env_for()).team_id).toBeUndefined();
        expect(resolve_profile(undefined, env_for()).team_id).toBeUndefined();
    });

    it('tolerates a numeric-string team_id in hand-edited config', ()=>{
        write_config({profiles: {dev: {team_id: '1045'}}});
        expect(resolve_profile('dev', env_for()).team_id).toBe(1045);
    });

    it('creates a profile with a team_id via add_profile', ()=>{
        add_profile('alice@reply.io', {team_id: 1045}, env_for());
        expect(resolve_profile('alice@reply.io', env_for()).team_id).toBe(1045);
    });
});

describe('profile — set (edit an existing profile, merge-safe)', ()=>{
    it('sets team_id on an existing profile without touching its URLs', ()=>{
        add_profile('dev', {authority: 'https://a', api_base: 'https://b'}, env_for());
        set_profile('dev', {team_id: 7}, env_for());
        const p = resolve_profile('dev', env_for());
        expect(p.team_id).toBe(7);
        expect(p.authority).toBe('https://a');
        expect(p.api_base).toBe('https://b');
    });

    it('can pin a team on the built-in default (no named profile needed)', ()=>{
        set_profile('default', {team_id: 99}, env_for());
        const p = resolve_profile(undefined, env_for());
        expect(p.team_id).toBe(99);
        expect(p.authority).toBe(PROD.authority);
        expect(p.api_base).toBe(PROD.api_base);
    });

    it('rejects editing an unknown named profile', ()=>{
        expect(()=>set_profile('nope', {team_id: 1}, env_for())).toThrow(UsageError);
    });
});

describe('profile — rename_profile_def (config-only)', ()=>{
    it('renames a profile def and preserves siblings', ()=>{
        add_profile('alice@reply.io', {team_id: 5}, env_for());
        add_profile('bob@reply.io', {}, env_for());
        rename_profile_def('alice@reply.io', 'ally@reply.io', env_for());
        const l = list_profiles(env_for());
        expect([...l.available].sort()).toEqual(['ally@reply.io', 'bob@reply.io', 'default']);
        expect(resolve_profile('ally@reply.io', env_for()).team_id).toBe(5);
        expect(()=>resolve_profile('alice@reply.io', env_for())).toThrow(UsageError);
    });

    it('repoints current_profile when the renamed profile was current', ()=>{
        add_profile('dev', {authority: 'https://a', api_base: 'https://b'}, env_for());
        set_current_profile('dev', env_for());
        rename_profile_def('dev', 'staging', env_for());
        expect(current_profile_name(env_for())).toBe('staging');
    });

    it('leaves current_profile alone when a non-current profile is renamed', ()=>{
        add_profile('dev', {}, env_for());
        add_profile('qa', {}, env_for());
        set_current_profile('dev', env_for());
        rename_profile_def('qa', 'qa2', env_for());
        expect(current_profile_name(env_for())).toBe('dev');
    });

    it('rejects renaming the built-in default', ()=>{
        expect(()=>rename_profile_def('default', 'x', env_for())).toThrow(UsageError);
    });

    it('rejects an unknown source profile', ()=>{
        expect(()=>rename_profile_def('nope', 'x', env_for())).toThrow(UsageError);
    });

    it('rejects an empty, default, or same-as-old target', ()=>{
        add_profile('dev', {}, env_for());
        expect(()=>rename_profile_def('dev', '   ', env_for())).toThrow(UsageError);
        expect(()=>rename_profile_def('dev', 'default', env_for())).toThrow(UsageError);
        expect(()=>rename_profile_def('dev', 'dev', env_for())).toThrow(UsageError);
    });

    it('rejects a target that already exists', ()=>{
        add_profile('dev', {}, env_for());
        add_profile('qa', {}, env_for());
        expect(()=>rename_profile_def('dev', 'qa', env_for())).toThrow(UsageError);
    });
});

describe('profile — delete_profile_def (config-only)', ()=>{
    it('removes a profile def and preserves siblings', ()=>{
        add_profile('dev', {}, env_for());
        add_profile('qa', {}, env_for());
        const {was_current} = delete_profile_def('dev', env_for());
        expect(was_current).toBe(false);
        expect([...list_profiles(env_for()).available].sort()).toEqual(['default', 'qa']);
    });

    it('resets current to default when the deleted profile was current', ()=>{
        add_profile('dev', {}, env_for());
        set_current_profile('dev', env_for());
        const {was_current} = delete_profile_def('dev', env_for());
        expect(was_current).toBe(true);
        expect(current_profile_name(env_for())).toBe('default');
    });

    it('rejects deleting the built-in default and unknown profiles', ()=>{
        expect(()=>delete_profile_def('default', env_for())).toThrow(UsageError);
        expect(()=>delete_profile_def('nope', env_for())).toThrow(UsageError);
    });
});

describe('profile — unset_profile_field', ()=>{
    it('clears team_id, dropping the pin', ()=>{
        add_profile('dev', {authority: 'https://a', api_base: 'https://b', team_id: 5}, env_for());
        const {changed} = unset_profile_field('dev', 'team_id', env_for());
        expect(changed).toBe(true);
        expect(resolve_profile('dev', env_for()).team_id).toBeUndefined();
        expect(resolve_profile('dev', env_for()).authority).toBe('https://a');
    });

    it('clears a URL, reverting it to the inherited prod default', ()=>{
        add_profile('dev', {authority: 'https://a', api_base: 'https://b'}, env_for());
        unset_profile_field('dev', 'api_base', env_for());
        expect(resolve_profile('dev', env_for()).api_base).toBe(PROD.api_base);
        expect(resolve_profile('dev', env_for()).authority).toBe('https://a');
    });

    it('is an idempotent no-op when the field is already unset', ()=>{
        add_profile('dev', {}, env_for());
        expect(unset_profile_field('dev', 'team_id', env_for()).changed).toBe(false);
    });

    it('works on the built-in default (clears an override)', ()=>{
        set_profile('default', {team_id: 99}, env_for());
        expect(unset_profile_field('default', 'team_id', env_for()).changed).toBe(true);
        expect(resolve_profile(undefined, env_for()).team_id).toBeUndefined();
    });

    it('rejects an unknown profile', ()=>{
        expect(()=>unset_profile_field('nope', 'team_id', env_for())).toThrow(UsageError);
    });
});

describe('profile — describe_profile', ()=>{
    it('marks inherited URLs and reports team_id + current', ()=>{
        add_profile('dev', {api_base: 'https://api.dev.reply.io/v3', team_id: 7}, env_for());
        set_current_profile('dev', env_for());
        const d = describe_profile('dev', env_for());
        expect(d.name).toBe('dev');
        expect(d.api_base).toBe('https://api.dev.reply.io/v3');
        expect(d.authority).toBe(PROD.authority);
        expect(d.inherited).toEqual({authority: true, api_base: false});
        expect(d.team_id).toBe(7);
        expect(d.is_current).toBe(true);
    });

    it('describes the built-in default as fully inherited', ()=>{
        const d = describe_profile('default', env_for());
        expect(d.inherited).toEqual({authority: true, api_base: true});
        expect(d.is_current).toBe(true);
        expect(d.team_id).toBeUndefined();
    });

    it('throws for an unknown profile', ()=>{
        expect(()=>describe_profile('nope', env_for())).toThrow(UsageError);
    });
});
