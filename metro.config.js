// Metro bundler configuration
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add .onnx, .wasm, and .db files as assets
config.resolver.assetExts.push('onnx', 'wasm', 'db');

// Ensure wasm is NOT in sourceExts
config.resolver.sourceExts = config.resolver.sourceExts.filter(ext => ext !== 'wasm');

// Enable bundle splitting and optimization
config.transformer = {
  ...config.transformer,
  getTransformOptions: async () => ({
    transform: {
      experimentalImportSupport: false,
      inlineRequires: true, // Enable inline requires for smaller bundle size
    },
  }),
};

module.exports = config;
