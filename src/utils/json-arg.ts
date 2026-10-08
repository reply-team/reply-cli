import fs from 'fs';
import {UsageError} from './errors';

type Json_arg_opts = {
    flag: string;                   // e.g. '--body', named in the messages
    what: string;                   // e.g. 'body', in "Could not read body file"
    code: string;                   // the UsageError code
    read_stdin?: () => string;      // injectable for tests
};

const read_all_stdin = (): string=>{
    try {
        return fs.readFileSync(0, 'utf8');
    } catch {
        return '';
    }
};

// A JSON value given on the command line: inline, @<file>, or '-' for stdin.
const read_json_arg = (raw: string, opts: Json_arg_opts): unknown=>{
    let text: string;
    if (raw === '-')
    {
        text = (opts.read_stdin ?? read_all_stdin)();
    }
    else if (raw.startsWith('@'))
    {
        try {
            text = fs.readFileSync(raw.slice(1), 'utf8');
        } catch (e) {
            throw new UsageError(`Could not read ${opts.what} file '${raw.slice(1)}'.`, {
                code: opts.code, hint: (e as Error).message,
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
        throw new UsageError(`${opts.flag} must be valid JSON (inline, @file, or - for stdin).`, {code: opts.code});
    }
};

export {read_json_arg, read_all_stdin};
export type {Json_arg_opts};
