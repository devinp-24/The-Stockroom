// Metro needs to be told about code living outside the project root before
// it will bundle it. `shared/` sits one level up, next to stockroom-website.
//
// The alias matches the one in stockroom-app/vite.config.js so an import of
// '@stockroom/shared' reads identically on both clients.

const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '..');
const sharedRoot = path.resolve(repoRoot, 'shared');

const config = getDefaultConfig(projectRoot);

// Watch the shared package so edits to it trigger a fast refresh.
config.watchFolders = [sharedRoot];

// Keep module resolution anchored to this app's own node_modules — without
// this, watching a folder outside the root makes Metro hunt upwards and it
// can pick up a stray copy of React.
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];

config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  '@stockroom/shared': sharedRoot,
};

module.exports = config;
