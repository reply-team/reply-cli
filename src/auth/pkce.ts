import crypto from 'crypto';

type Pkce = {
    verifier: string;
    challenge: string;
    method: 'S256';
};

const random_url_safe = (bytes = 32): string=>
    crypto.randomBytes(bytes).toString('base64url');

// RFC 7636 PKCE pair: a random verifier and its S256 challenge.
const create_pkce = (): Pkce=>{
    const verifier = random_url_safe(32);
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    return {verifier, challenge, method: 'S256'};
};

// Opaque anti-CSRF value echoed back on the authorize redirect.
const create_state = (): string=>random_url_safe(32);

export {create_pkce, create_state};
export type {Pkce};
