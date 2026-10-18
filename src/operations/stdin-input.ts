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

export {read_stdin_object};
export type {Stdin_object_opts};
