const assert = require('assert').strict;
const path = require('path');
const { createRequire } = require('module');
const { transformFileSync } = require('@babel/core');

const root = path.resolve(__dirname, '../../src');
const babelPlugin = require.resolve('@babel/plugin-transform-modules-commonjs');
const modules = new Map();

function loadSource(reference) {
    const filename = path.resolve(root, reference + (path.extname(reference) ? '' : '.js'));
    assert(filename.startsWith(root + path.sep), 'Test imports must stay inside src.');
    if (modules.has(filename)) return modules.get(filename).exports;
    const localRequire = createRequire(filename);
    if (path.extname(filename) === '.json') return localRequire(filename);
    const compiled = transformFileSync(filename, { babelrc: false, configFile: false, plugins: [babelPlugin] });
    const target = { exports: {} };
    modules.set(filename, target);
    try {
        const importModule = name => name.startsWith('.')
            ? loadSource(path.relative(root, path.resolve(path.dirname(filename), name)))
            : localRequire(name);
        new Function('require', 'module', 'exports', compiled.code)(importModule, target, target.exports);
        return target.exports;
    } catch (error) {
        modules.delete(filename);
        throw error;
    }
}

module.exports = { loadSource };
