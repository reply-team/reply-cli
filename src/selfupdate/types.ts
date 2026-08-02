// How this copy of the CLI got onto the machine. Only `npm-global` is one we
// can safely drive ourselves; every other kind is managed by something else,
// so `install` reports the command that fits it and spawns nothing.
type Install_kind = 'npm-global' | 'npm-local' | 'npx' | 'source' | 'unknown';

// Which published stream this build belongs to. Read from the package name,
// never guessed: sending a public-channel user to GitHub Packages points them
// at a registry they cannot read.
type Channel = 'public' | 'internal';

type Install_info = {
    kind: Install_kind;
    channel: Channel;
    package_name: string;
    version: string;
    // Real path of the directory holding dist/, resolved through symlinks.
    module_dir: string;
};

// One published release, as the CLI cares about it. `version` is the tag
// without its leading v — the tag is the version of record, because the
// repository's package.json is deliberately 0.0.0-development.
type Release = {
    version: string;
    tag: string;
    url: string;
    prerelease: boolean;
};

export type {Install_kind, Channel, Install_info, Release};
