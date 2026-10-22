import {UsageError} from '../utils/errors';
import {read_all_stdin} from '../utils/json-arg';
import {is_object} from './call';

type Stdin_object_opts = {
    flag: string;               // e.g. '--fields', named in the messages
    what: string;               // e.g. 'fields', as in "No fields were given."
    fields: readonly string[];  // the names the object may carry
    code: string;               // the UsageError code
    hint: string;               // how to pipe it in
};

// A person's text is read from stdin only, never from the argument list, which may be logged where
// it must not go; so the flag takes only '-'. No message here repeats any of the text: an unknown
// field is named, never its value.
const read_stdin_object = (source: string | undefined, o: Stdin_object_opts, read_stdin?: () => string): Record<string, unknown>=>{
    const shape = `{${o.fields.join(', ')}}`;
    if (source !== '-')
    {
        throw new UsageError(source === undefined ? `No ${o.what} given.` : `${o.flag} takes only -: the ${o.what} is read from stdin.`, {
            code: o.code, hint: o.hint,
        });
    }
    let value: unknown;
    try {
        value = JSON.parse((read_stdin ?? read_all_stdin)());
    } catch {
        throw new UsageError(`The ${o.what} on stdin must be JSON: ${shape}.`, {code: o.code});
    }
    if (!is_object(value))
    {
        throw new UsageError(`The ${o.what} must be a JSON object: ${shape}.`, {code: o.code});
    }
    const unknown_field = Object.keys(value).find(k=>!o.fields.includes(k));
    if (unknown_field !== undefined)
    {
        throw new UsageError(`The ${o.what} has an unknown field '${unknown_field}'.`, {code: o.code, hint: `Fields: ${o.fields.join(', ')}.`});
    }
    return value;
};

// The person and their text, each read from stdin by its own flag. When both flags take '-', stdin
// holds one object with each input under its flag's name, {"contact": {…}, "message": {…}}; it is
// read once, and each flag is handed its member as the text it would have read alone. When at most
// one does, that one reads stdin as ever. No message here repeats any of it: an unknown member is
// named, never its value.
const stdin_inputs = <K extends string>(
    sources: Record<K, string | undefined>, o: {code: string; hint: string}, read_stdin?: () => string,
): Record<K, () => string>=>{
    const read = read_stdin ?? read_all_stdin;
    const names = Object.keys(sources) as K[];
    const piped = names.filter(n=>sources[n] === '-');
    if (piped.length < 2)
    {
        return Object.fromEntries(names.map(n=>[n, read])) as Record<K, () => string>;
    }
    const flags = piped.map(n=>`--${n} -`).join(' and ');
    const shape = `{${piped.map(n=>`"${n}": {…}`).join(', ')}}`;
    let value: unknown;
    try {
        value = JSON.parse(read());
    } catch {
        throw new UsageError(`With ${flags} both, stdin must be JSON: ${shape}.`, {code: o.code, hint: o.hint});
    }
    if (!is_object(value))
    {
        throw new UsageError(`With ${flags} both, stdin must be one JSON object: ${shape}.`, {code: o.code, hint: o.hint});
    }
    const input = value;
    const unknown_field = Object.keys(input).find(k=>!(piped as string[]).includes(k));
    if (unknown_field !== undefined)
    {
        throw new UsageError(`Stdin has an unknown field '${unknown_field}'.`, {code: o.code, hint: `Fields: ${piped.join(', ')}.`});
    }
    const missing = piped.find(n=>input[n] === undefined);
    if (missing !== undefined)
    {
        throw new UsageError(`Stdin has no ${missing}: with ${flags} both, it holds ${shape}.`, {code: o.code, hint: o.hint});
    }
    return Object.fromEntries(names.map(n=>[n, sources[n] === '-' ? ()=>JSON.stringify(input[n]) : read])) as Record<K, () => string>;
};

export {read_stdin_object, stdin_inputs};
export type {Stdin_object_opts};
