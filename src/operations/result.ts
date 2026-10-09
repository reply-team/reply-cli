import {print} from '../utils/output';
import {Operation_error, type Ids} from '../utils/errors';
import type {Op_globals} from './options';

// Every operation prints JSON, as `reply api` does: indented by default, compact with --json.
const print_result = (data: unknown, g: Op_globals): void=>{
    print(data, {json: g.json, pretty: g.pretty});
};

// Attaches what an operation had learned to a failure on its way out, so a caller still gets,
// say, the id of a contact created before the add was refused.
const with_ids = (error: unknown, ids: Ids): unknown=>{
    if (error instanceof Operation_error)
    {
        error.ids = {...ids, ...error.ids};
    }
    return error;
};

export {print_result, with_ids};
