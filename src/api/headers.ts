// Reply.io request headers, mirroring the backend's ReplyKnownHeaders. They pin
// the team/workspace context and, for organization API keys, identify the user
// the request acts on behalf of. Casing matches the backend constants verbatim.
const HEADER_TEAM_ID = 'X-TEAM-ID';
const HEADER_USER_ID = 'X-USER-ID';
const HEADER_USER_EMAIL = 'X-User-Email';

export {HEADER_TEAM_ID, HEADER_USER_ID, HEADER_USER_EMAIL};
