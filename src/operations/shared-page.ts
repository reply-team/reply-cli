// The addresses of Reply's hosted mailbox page, all built from the one address Reply's v1 shared-page
// route answers. Every form here carries the account user's hosted token: it does not expire, and it lets
// whoever holds it manage all of that user's mailboxes, deletion included. So none of them is ever
// written anywhere but the one stdout field that hands it over.

const HOSTED_PROVIDERS = ['gmail', 'office365'] as const;
type Hosted_provider = typeof HOSTED_PROVIDERS[number];

const SHARED_PAGE_WARNING = 'this address does not expire and lets its holder manage all of this user\'s mailboxes, deletion included';

// Reply answers the hosted index, `{origin}/hosted/eac/index/{token}`.
const INDEX_PATH = /^(.*)\/hosted\/eac\/index\/([^/]+)\/?$/i;

type Shared_page = {
    index: string;      // the address as Reply gave it
    token: string;
    base: string;       // the origin, with any path the app is served under
};

// The parts of the address Reply answered, or null when it is not in that form. Nothing of the
// address goes into an error, so a caller says only that it could not be read.
const read_shared_page = (url: string): Shared_page | null=>{
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    const m = INDEX_PATH.exec(parsed.pathname);
    if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || m === null)
    {
        return null;
    }
    let token: string;
    try {
        token = decodeURIComponent(m[2]);
    } catch {
        return null;
    }
    return token === '' ? null : {index: url, token, base: `${parsed.origin}${m[1]}`};
};

// The page to open: the provider's own connect when one is named, else the index of every mailbox. A
// provider's connect for a reconnect says so: without it the hosted page counts the sign-in as a new
// mailbox, and a user with no free mailbox slot is sent to that error instead of reconnecting. The index
// needs nothing: it adds the flag itself when the person reconnects a mailbox already on it.
const shared_page_link = (page: Shared_page, provider: Hosted_provider | undefined, kind: 'connect' | 'reconnect'): string=>{
    const token = encodeURIComponent(page.token);
    const reconnect = kind === 'reconnect' ? '&reconnect=true' : '';
    switch (provider)
    {
        case 'gmail':
            return `${page.base}/hosted/eac/ConnectWithGMail?uidToken=${token}${reconnect}`;
        case 'office365':
            return `${page.base}/hosted/eac/ConnectWithOffice?uidToken=${token}&isExchange=false${reconnect}`;
        default:
            return page.index;
    }
};

export {HOSTED_PROVIDERS, SHARED_PAGE_WARNING, read_shared_page, shared_page_link};
export type {Hosted_provider, Shared_page};
